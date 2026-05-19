import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron, CronExpression } from '@nestjs/schedule'
import axios from 'axios'
import { NodeConfig, NodeStatus, NodeStatusResponse } from './node-manager.interface'

/**
 * 节点管理服务
 *
 * 职责：
 * 1. 解析并管理多节点配置
 * 2. 定时健康检测，选举最优节点
 * 3. 故障时自动切换到可用节点
 * 4. 提供当前活跃节点信息
 */
@Injectable()
export class NodeManagerService implements OnModuleInit {
  private readonly logger = new Logger(NodeManagerService.name)

  /** 所有节点的运行时状态 */
  private nodes: NodeStatus[] = []

  /** 当前活跃节点索引 */
  private activeIndex = 0

  /** 切换冷却期（毫秒），防止切换风暴 */
  private readonly SWITCH_COOLDOWN_MS = 30_000

  /** 上次切换时间 */
  private lastSwitchTime = 0

  /** 节点切换时的回调列表（ZmqService 注册） */
  private readonly switchListeners: Array<(node: NodeConfig) => void> = []

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    this.loadNodeConfigs()
    // 启动时立即执行一次健康检测
    await this.performHealthCheck()
  }

  /**
   * 加载节点配置
   * 优先读取 RPC_NODES（JSON 数组），若未配置则回退到旧版单节点环境变量
   */
  private loadNodeConfigs() {
    const nodesJson = this.configService.get<string>('RPC_NODES')

    if (nodesJson) {
      try {
        const parsed: NodeConfig[] = JSON.parse(nodesJson)
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.nodes = parsed.map((config) => this.createNodeStatus(config))
          this.logger.log(`已加载 ${this.nodes.length} 个节点配置: ${parsed.map((n) => n.name).join(', ')}`)
          return
        }
      } catch (error) {
        this.logger.error(`解析 RPC_NODES 配置失败: ${error.message}，将回退到单节点配置`)
      }
    }

    // 回退：从旧版单节点环境变量读取
    const rpcUrl = this.configService.get<string>('RPC_URL')
    const rpcUser = this.configService.get<string>('RPC_USER')
    const rpcPassword = this.configService.get<string>('RPC_PASSWORD')
    const zmqUrl = this.configService.get<string>('ZMQ_URL') || ''

    if (!rpcUrl || !rpcUser || !rpcPassword) {
      this.logger.error('未找到任何有效的节点配置，请检查 RPC_NODES 或 RPC_URL/RPC_USER/RPC_PASSWORD')
      return
    }

    const fallbackConfig: NodeConfig = {
      name: 'default',
      rpcUrl,
      rpcUser,
      rpcPassword,
      zmqUrl
    }

    this.nodes = [this.createNodeStatus(fallbackConfig)]
    this.logger.log('使用单节点配置（兼容模式）')
  }

  /**
   * 创建节点初始运行时状态
   */
  private createNodeStatus(config: NodeConfig): NodeStatus {
    return {
      config,
      isHealthy: true, // 初始假设健康，等待首次检测
      isActive: false,
      latency: -1,
      lastCheckTime: null,
      failureCount: 0
    }
  }

  // ─── 定时健康检测 ────────────────────────────────────────────

  /**
   * 每小时执行一次全量健康检测
   */
  @Cron(CronExpression.EVERY_HOUR)
  async scheduledHealthCheck() {
    this.logger.log('开始定时健康检测...')
    await this.performHealthCheck()
  }

  /**
   * 执行健康检测：对所有节点测量延迟，选举最优节点
   */
  async performHealthCheck() {
    const checkPromises = this.nodes.map((node, index) => this.checkNodeHealth(index))
    await Promise.all(checkPromises)

    // 选举最优节点（延迟最低的健康节点）
    this.electBestNode()

    // 日志输出当前状态
    const active = this.getActiveNode()
    if (active) {
      this.logger.log(
        `健康检测完成。活跃节点: ${active.name} (延迟: ${this.nodes[this.activeIndex].latency}ms)`
      )
    } else {
      this.logger.error('所有节点均不可用！')
    }
  }

  /**
   * 检测单个节点的健康状态
   */
  private async checkNodeHealth(index: number): Promise<void> {
    const node = this.nodes[index]
    const { rpcUrl, rpcUser, rpcPassword } = node.config

    const startTime = Date.now()
    try {
      const response = await axios.post(
        rpcUrl,
        {
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'getblockcount',
          params: []
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${Buffer.from(`${rpcUser}:${rpcPassword}`).toString('base64')}`
          },
          timeout: 10_000 // 10 秒超时
        }
      )

      const latency = Date.now() - startTime

      if (response.data && response.data.result !== undefined && response.data.error === null) {
        node.isHealthy = true
        node.latency = latency
        node.failureCount = 0
      } else {
        node.isHealthy = false
        node.latency = -1
        node.failureCount++
      }
    } catch (error) {
      node.isHealthy = false
      node.latency = -1
      node.failureCount++
      this.logger.warn(`节点 [${node.config.name}] 健康检测失败: ${error.message}`)
    }

    node.lastCheckTime = new Date()
  }

  /**
   * 选举延迟最低的健康节点作为活跃节点
   */
  private electBestNode() {
    // 清除所有节点的 isActive 标记
    this.nodes.forEach((n) => (n.isActive = false))

    // 找到延迟最低的健康节点
    let bestIndex = -1
    let bestLatency = Infinity

    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i]
      if (node.isHealthy && node.latency >= 0 && node.latency < bestLatency) {
        bestLatency = node.latency
        bestIndex = i
      }
    }

    if (bestIndex === -1) {
      // 没有健康节点，保持当前节点（可能已经不可用了）
      this.logger.error('没有可用的健康节点，保持当前配置不变')
      if (this.nodes.length > 0) {
        this.nodes[this.activeIndex].isActive = true
      }
      return
    }

    const previousIndex = this.activeIndex

    // 如果最优节点发生变化，执行切换
    if (bestIndex !== this.activeIndex) {
      this.activeIndex = bestIndex
      this.nodes[this.activeIndex].isActive = true
      this.lastSwitchTime = Date.now()

      this.logger.log(
        `节点切换: [${this.nodes[previousIndex]?.config.name}] → [${this.nodes[this.activeIndex].config.name}]`
      )

      // 通知监听器（ZmqService 等）
      this.notifySwitchListeners()
    } else {
      this.nodes[this.activeIndex].isActive = true
    }
  }

  // ─── 故障切换 ────────────────────────────────────────────────

  /**
   * 报告当前活跃节点故障，触发切换
   * 由 RpcService 在请求失败时调用
   *
   * @returns 是否成功切换到了新节点
   */
  reportFailure(): boolean {
    // 冷却期检查
    if (Date.now() - this.lastSwitchTime < this.SWITCH_COOLDOWN_MS) {
      this.logger.warn('在切换冷却期内，跳过本次切换')
      return false
    }

    // 标记当前节点为不健康
    const currentNode = this.nodes[this.activeIndex]
    currentNode.isHealthy = false
    currentNode.failureCount++
    currentNode.latency = -1

    this.logger.warn(`节点 [${currentNode.config.name}] 被标记为不健康 (连续失败: ${currentNode.failureCount})`)

    // 尝试切换到下一个健康节点
    return this.switchToNextHealthyNode()
  }

  /**
   * 切换到下一个可用的健康节点
   */
  private switchToNextHealthyNode(): boolean {
    // 按延迟排序，找到第一个健康节点（排除当前节点）
    const candidates = this.nodes
      .map((node, index) => ({ node, index }))
      .filter(({ index }) => index !== this.activeIndex)
      .filter(({ node }) => node.isHealthy || node.failureCount < 3) // 允许偶尔失败的节点尝试
      .sort((a, b) => {
        // 健康节点优先
        if (a.node.isHealthy && !b.node.isHealthy) return -1
        if (!a.node.isHealthy && b.node.isHealthy) return 1
        // 延迟低的优先
        const aLatency = a.node.latency >= 0 ? a.node.latency : Infinity
        const bLatency = b.node.latency >= 0 ? b.node.latency : Infinity
        return aLatency - bLatency
      })

    if (candidates.length === 0) {
      this.logger.error('没有可切换的候选节点')
      return false
    }

    const previousIndex = this.activeIndex
    this.nodes[this.activeIndex].isActive = false
    this.activeIndex = candidates[0].index
    this.nodes[this.activeIndex].isActive = true
    this.lastSwitchTime = Date.now()

    this.logger.log(
      `故障切换: [${this.nodes[previousIndex].config.name}] → [${this.nodes[this.activeIndex].config.name}]`
    )

    // 通知监听器
    this.notifySwitchListeners()
    return true
  }

  // ─── 监听器管理 ──────────────────────────────────────────────

  /**
   * 注册节点切换监听器
   * ZmqService 在初始化时调用，用于在节点切换时重连 ZMQ
   */
  onNodeSwitch(listener: (node: NodeConfig) => void) {
    this.switchListeners.push(listener)
  }

  /**
   * 通知所有监听器
   */
  private notifySwitchListeners() {
    const activeConfig = this.getActiveNode()
    if (!activeConfig) return

    for (const listener of this.switchListeners) {
      try {
        listener(activeConfig)
      } catch (error) {
        this.logger.error(`节点切换监听器执行失败: ${error.message}`)
      }
    }
  }

  // ─── 公共方法 ────────────────────────────────────────────────

  /**
   * 获取当前活跃节点配置
   */
  getActiveNode(): NodeConfig | null {
    if (this.nodes.length === 0) return null
    return this.nodes[this.activeIndex].config
  }

  /**
   * 获取当前活跃节点的 RPC URL
   */
  getActiveRpcUrl(): string {
    return this.getActiveNode()?.rpcUrl || ''
  }

  /**
   * 获取当前活跃节点的 RPC 认证信息（Base64）
   */
  getActiveRpcAuth(): string {
    const node = this.getActiveNode()
    if (!node) return ''
    return Buffer.from(`${node.rpcUser}:${node.rpcPassword}`).toString('base64')
  }

  /**
   * 获取当前活跃节点的 ZMQ URL
   */
  getActiveZmqUrl(): string {
    return this.getActiveNode()?.zmqUrl || ''
  }

  /**
   * 获取所有节点状态（供前端 API 使用，已脱敏）
   */
  getNodesStatus(): NodeStatusResponse {
    const activeNode = this.getActiveNode()

    return {
      activeNode: activeNode?.name || 'none',
      lastCheckTime: this.nodes[0]?.lastCheckTime?.toISOString() || null,
      nodes: this.nodes.map((node) => ({
        name: node.config.name,
        rpcUrl: this.maskUrl(node.config.rpcUrl),
        zmqUrl: this.maskUrl(node.config.zmqUrl),
        isHealthy: node.isHealthy,
        isActive: node.isActive,
        latency: node.latency,
        lastCheckTime: node.lastCheckTime?.toISOString() || null,
        failureCount: node.failureCount
      }))
    }
  }

  /**
   * URL 脱敏处理：隐藏认证信息，只展示 host 部分
   */
  private maskUrl(url: string): string {
    try {
      const parsed = new URL(url)
      // 移除用户名密码
      parsed.username = ''
      parsed.password = ''
      return parsed.toString()
    } catch {
      // 如果 URL 格式非标准（例如 tcp://...），直接返回
      return url
    }
  }
}
