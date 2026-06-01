import { Controller, Get, Logger } from '@nestjs/common'
import { NodeManagerService } from './node-manager.service'
import { CacheService } from '../common/services/cache.service'
import { RpcService } from '../rpc/rpc.service'
import type { NodeChainStatus, NetworkInfo, BlockchainInfo, MempoolInfo, MiningInfo, NetTotals } from './node-manager.interface'

/**
 * 节点管理控制器
 * 提供节点管理状态查询和核心节点链状态信息
 */
@Controller('nodes')
export class NodeManagerController {
  private readonly logger = new Logger(NodeManagerController.name)

  constructor(
    private readonly nodeManagerService: NodeManagerService,
    private readonly cacheService: CacheService,
    private readonly rpcService: RpcService
  ) {}

  // ─── 节点管理接口 ──────────────────────────────────────────────

  /**
   * 获取所有配置节点的状态信息
   * GET /api/nodes/status
   */
  @Get('status')
  getStatus() {
    return this.nodeManagerService.getNodesStatus()
  }

  /**
   * 手动触发一次健康检测
   * GET /api/nodes/health-check
   */
  @Get('health-check')
  async triggerHealthCheck() {
    await this.nodeManagerService.performHealthCheck()
    return {
      message: '健康检测完成',
      result: this.nodeManagerService.getNodesStatus()
    }
  }

  // ─── 核心节点链状态接口 ────────────────────────────────────────

  /**
   * 获取当前活跃节点的完整链状态（聚合接口）
   * GET /api/nodes/chain-status
   *
   * 缓存策略：30 秒（数据变化频率适中）
   */
  @Get('chain-status')
  async getChainStatus() {
    this.logger.log('Request received for /nodes/chain-status')

    return this.cacheService.getOrSet<NodeChainStatus>(
      'node-chain-status',
      async () => {
        const [uptime, network, blockchain, mempool, mining, netTotals] = await Promise.all([
          this.rpcService.call<number>('uptime'),
          this.rpcService.call<NetworkInfo>('getnetworkinfo'),
          this.rpcService.call<BlockchainInfo>('getblockchaininfo'),
          this.rpcService.call<MempoolInfo>('getmempoolinfo'),
          this.rpcService.call<MiningInfo>('getmininginfo'),
          this.rpcService.call<NetTotals>('getnettotals')
        ])

        return {
          uptime,
          network: {
            version: network.version,
            subversion: network.subversion,
            protocolversion: network.protocolversion,
            connections: network.connections,
            connections_in: network.connections_in,
            connections_out: network.connections_out,
            networkactive: network.networkactive,
            relayfee: network.relayfee,
            localrelay: network.localrelay,
            warnings: network.warnings || ''
          },
          blockchain: {
            chain: blockchain.chain,
            blocks: blockchain.blocks,
            headers: blockchain.headers,
            bestblockhash: blockchain.bestblockhash,
            difficulty: blockchain.difficulty,
            mediantime: blockchain.mediantime,
            verificationprogress: blockchain.verificationprogress,
            chainwork: blockchain.chainwork,
            size_on_disk: blockchain.size_on_disk,
            pruned: blockchain.pruned,
            warnings: blockchain.warnings || ''
          },
          mempool: {
            size: mempool.size,
            bytes: mempool.bytes,
            usage: mempool.usage,
            maxmempool: mempool.maxmempool,
            mempoolminfee: mempool.mempoolminfee
          },
          mining: {
            blocks: mining.blocks,
            difficulty: mining.difficulty,
            networkhashps: mining.networkhashps,
            chain: mining.chain
          },
          netTotals: {
            totalbytesrecv: netTotals.totalbytesrecv,
            totalbytessent: netTotals.totalbytessent,
            timemillis: netTotals.timemillis
          }
        }
      },
      30
    )
  }

  /**
   * 获取网络信息
   * GET /api/nodes/network-info
   *
   * 缓存策略：60 秒（连接数等变化较慢）
   */
  @Get('network-info')
  async getNetworkInfo() {
    this.logger.log('Request received for /nodes/network-info')
    return this.cacheService.getOrSet(
      'node-network-info',
      () => this.rpcService.call<NetworkInfo>('getnetworkinfo'),
      60
    )
  }

  /**
   * 获取区块链信息
   * GET /api/nodes/blockchain-info
   *
   * 缓存策略：15 秒（区块高度变化较快）
   */
  @Get('blockchain-info')
  async getBlockchainInfo() {
    this.logger.log('Request received for /nodes/blockchain-info')
    return this.cacheService.getOrSet(
      'node-blockchain-info',
      () => this.rpcService.call<BlockchainInfo>('getblockchaininfo'),
      15
    )
  }

  /**
   * 获取内存池信息
   * GET /api/nodes/mempool-info
   *
   * 缓存策略：10 秒（内存池变化频繁）
   */
  @Get('mempool-info')
  async getMempoolInfo() {
    this.logger.log('Request received for /nodes/mempool-info')
    return this.cacheService.getOrSet(
      'node-mempool-info',
      () => this.rpcService.call<MempoolInfo>('getmempoolinfo'),
      10
    )
  }

  /**
   * 获取挖矿信息
   * GET /api/nodes/mining-info
   *
   * 缓存策略：60 秒（算力和难度变化慢）
   */
  @Get('mining-info')
  async getMiningInfo() {
    this.logger.log('Request received for /nodes/mining-info')
    return this.cacheService.getOrSet(
      'node-mining-info',
      () => this.rpcService.call<MiningInfo>('getmininginfo'),
      60
    )
  }

  /**
   * 获取网络流量信息
   * GET /api/nodes/net-totals
   *
   * 缓存策略：30 秒
   */
  @Get('net-totals')
  async getNetTotals() {
    this.logger.log('Request received for /nodes/net-totals')
    return this.cacheService.getOrSet(
      'node-net-totals',
      () => this.rpcService.call<NetTotals>('getnettotals'),
      30
    )
  }

  /**
   * 获取节点运行时间
   * GET /api/nodes/uptime
   *
   * 缓存策略：30 秒
   */
  @Get('uptime')
  async getUptime() {
    this.logger.log('Request received for /nodes/uptime')
    const seconds = await this.cacheService.getOrSet(
      'node-uptime',
      () => this.rpcService.call<number>('uptime'),
      30
    )

    return {
      seconds,
      formatted: this.formatUptime(seconds)
    }
  }

  /**
   * 将运行秒数格式化为可读字符串
   */
  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)

    const parts: string[] = []
    if (days > 0) parts.push(`${days} 天`)
    if (hours > 0) parts.push(`${hours} 小时`)
    if (minutes > 0) parts.push(`${minutes} 分钟`)

    return parts.length > 0 ? parts.join(' ') : '不到 1 分钟'
  }
}
