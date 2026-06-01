import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common'
import * as zmq from 'zeromq'
import { RpcService } from '../rpc/rpc.service'
import { PrismaService } from '../prisma/prisma.service'
import { IndexerService } from './indexer.service'
import { NodeManagerService } from '../node-manager/node-manager.service'
import { NodeConfig } from '../node-manager/node-manager.interface'
import { btcToSatoshisNumber } from '../utils/currency.utils'

@Injectable()
export class ZmqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ZmqService.name)
  private socket: zmq.Subscriber | null = null

  /** 当前连接的 ZMQ 地址 */
  private currentZmqUrl: string = ''

  /** 是否已启用 ZMQ */
  private isEnabled = false

  /** 是否正在重连中（防止并发重连） */
  private isReconnecting = false

  /** 监听循环的中止控制器 */
  private abortController: AbortController | null = null

  // 简单的缓存机制，防止重复处理
  // 使用双 Set 轮换机制清理过期数据 (30分钟轮换一次，最长保留60分钟)
  private currentCache = new Set<string>()
  private previousCache = new Set<string>()
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor(
    private readonly rpcService: RpcService,
    private readonly prisma: PrismaService,
    private readonly indexerService: IndexerService,
    private readonly nodeManager: NodeManagerService
  ) {}

  async onModuleInit() {
    this.isEnabled = process.env.USE_ZMQ === 'true'
    if (!this.isEnabled) {
      this.logger.log('ZMQ 监听已禁用')
      return
    }

    // 注册节点切换监听器，当活跃节点变化时自动重连 ZMQ
    this.nodeManager.onNodeSwitch((newNode: NodeConfig) => {
      this.handleNodeSwitch(newNode)
    })

    // 从 NodeManager 获取当前活跃节点的 ZMQ 地址
    const zmqUrl = this.nodeManager.getActiveZmqUrl()
    if (!zmqUrl) {
      this.logger.error('当前活跃节点未配置 ZMQ 地址')
      return
    }

    await this.connect(zmqUrl)
  }

  /**
   * 连接到指定的 ZMQ 地址
   */
  private async connect(zmqUrl: string) {
    this.logger.log(`正在连接 ZMQ: ${zmqUrl}...`)

    try {
      this.socket = new zmq.Subscriber()
      this.socket.connect(zmqUrl)
      this.currentZmqUrl = zmqUrl

      // 订阅主题
      this.socket.subscribe('hashtx')
      this.socket.subscribe('hashblock')

      this.logger.log(`ZMQ 已连接，已订阅 "hashtx" 和 "hashblock" 主题`)

      // 启动缓存清理定时器
      this.startCleanupInterval()

      // 启动监听循环
      this.runLoop()
    } catch (error) {
      this.logger.error(`ZMQ 连接失败: ${error.message}`)
    }
  }

  /**
   * 断开当前 ZMQ 连接
   */
  private async disconnect() {
    if (this.socket) {
      try {
        // 先取消订阅，再断开连接
        this.socket.close()
        this.logger.log(`已断开 ZMQ 连接: ${this.currentZmqUrl}`)
      } catch (error) {
        this.logger.warn(`断开 ZMQ 连接时出错: ${error.message}`)
      }
      this.socket = null
    }

    // 清理缓存定时器
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  /**
   * 处理节点切换事件
   * 当 NodeManagerService 切换活跃节点时，重连到新节点的 ZMQ
   */
  private async handleNodeSwitch(newNode: NodeConfig) {
    if (!this.isEnabled) return

    const newZmqUrl = newNode.zmqUrl
    if (!newZmqUrl) {
      this.logger.warn(`新节点 [${newNode.name}] 未配置 ZMQ 地址，ZMQ 监听将暂停`)
      await this.disconnect()
      return
    }

    // 如果 ZMQ 地址没有变化，无需重连
    if (newZmqUrl === this.currentZmqUrl) {
      this.logger.log(`节点切换但 ZMQ 地址未变，跳过重连`)
      return
    }

    await this.reconnect(newZmqUrl)
  }

  /**
   * 重连到新的 ZMQ 地址
   */
  async reconnect(newZmqUrl: string) {
    if (this.isReconnecting) {
      this.logger.warn('ZMQ 正在重连中，跳过本次请求')
      return
    }

    this.isReconnecting = true
    this.logger.log(`ZMQ 重连: ${this.currentZmqUrl} → ${newZmqUrl}`)

    try {
      // 断开旧连接
      await this.disconnect()

      // 短暂等待，确保资源释放
      await this.sleep(1000)

      // 连接新地址
      await this.connect(newZmqUrl)
    } catch (error) {
      this.logger.error(`ZMQ 重连失败: ${error.message}`)
    } finally {
      this.isReconnecting = false
    }
  }

  private startCleanupInterval() {
    this.cleanupInterval = setInterval(
      () => {
        this.logger.debug(`轮换交易缓存。上一轮: ${this.previousCache.size}, 当前: ${this.currentCache.size}`)
        this.previousCache = this.currentCache
        this.currentCache = new Set()
      },
      30 * 60 * 1000
    ) // 30 分钟
  }

  async runLoop() {
    if (!this.socket) return

    try {
      for await (const [topic, message] of this.socket) {
        const topicName = topic.toString()
        const hexData = message.toString('hex')

        if (topicName === 'hashtx') {
          await this.handleTransaction(hexData)
        } else if (topicName === 'hashblock') {
          this.logger.log(`[区块] 新区块: ${hexData}`)
        }
      }
    } catch (error) {
      // 当 socket 被关闭时，for-await 循环会抛出错误，这是正常的重连流程
      if (error.code === 'EAGAIN' || error.message?.includes('Socket is closed')) {
        this.logger.log('ZMQ 监听循环已终止（socket 已关闭）')
      } else {
        this.logger.error(`ZMQ 监听循环异常: ${error.message}`)
      }
    }
  }

  private async handleTransaction(txid: string) {
    // 1. 检查缓存：如果最近处理过，直接忽略（解决 ZMQ 在交易进入 Block 时重复发送 hashtx 通知的问题）
    if (this.currentCache.has(txid) || this.previousCache.has(txid)) {
      return
    }

    // 2. 二次确认：通过 RPC 检查交易是否真的在 mempool 中
    // 当区块连接时也会发送 hashtx，但此时交易已不在 mempool 中
    // 只有 getmempoolentry 返回成功的，才是真正的新内存池交易
    try {
      // 确认在 mempool 中
      await this.rpcService.call('getmempoolentry', [txid])

      // 获取详细交易数据
      const tx = await this.rpcService.call<any>('getrawtransaction', [txid, true])

      this.logger.log(`[内存池] 新交易: ${txid}`)

      // 解析并保存交易详情
      if (tx) {
        const inputsCount = tx.vin.length
        const outputsCount = tx.vout.length

        // 计算总输出金额
        const totalOutput = tx.vout.reduce((sum: number, out: any) => sum + (out.value || 0), 0)

        this.logger.log(`    详情: 输入: ${inputsCount}, 输出: ${outputsCount}, 总价值: ${totalOutput}`)

        // 解析 Outputs
        const outputs = tx.vout
          .map((out: any, index: number) => {
            const value = btcToSatoshisNumber(out.value)
            let addresses: string[] = []
            if (out.scriptPubKey) {
              if (out.scriptPubKey.addresses) {
                addresses = out.scriptPubKey.addresses
              } else if (out.scriptPubKey.address) {
                addresses = [out.scriptPubKey.address]
              }
            }
            return {
              txid: txid,
              address: addresses.length > 0 ? addresses[0] : null,
              amount: value,
              voutIndex: out.n,
              spentTxid: null,
              spentIndex: null
            }
          })
          .filter((out: any) => out.address !== null)

        // 解析 Inputs
        // 使用 indexerService.findPreviousVout 获取详细信息（地址和金额）
        const inputs = await Promise.all(
          tx.vin
            .map(async (inTx: any) => {
              let address = ''
              let amount = 0

              if (!inTx.coinbase) {
                const prevVout = await this.indexerService.findPreviousVout(inTx.txid, inTx.vout)
                if (prevVout) {
                  address = prevVout.address
                  amount = Number(prevVout.amount)
                }
              }

              return {
                txid: txid,
                address: address,
                amount: -amount,
                spentTxid: inTx.txid,
                spentIndex: inTx.vout,
                voutIndex: null
              }
            })
            .filter((inTx: any) => inTx.address !== '')
        )

        // 保存到数据库
        try {
          await this.prisma.mempoolTransaction.upsert({
            where: { txid: txid },
            create: {
              txid: txid,
              hash: tx.hash,
              timestamp: new Date(),
              blockHeight: -1,
              size: tx.size,
              weight: tx.weight || 0,
              io: [...inputs, ...outputs]
            },
            update: {
              timestamp: new Date(),
              io: [...inputs, ...outputs]
            }
          })
          this.logger.log(`    已保存到 MempoolTransaction 表`)
        } catch (dbError) {
          this.logger.error(`    保存到数据库失败: ${dbError.message}`)
        }

        // 打印输出地址（接收方）
        outputs.forEach((out: any) => {
          if (out.address) {
            this.logger.log(`    -> 输出 #${out.voutIndex}: ${out.amount} sats => ${out.address}`)
          }
        })
      }

      // 添加到缓存
      this.currentCache.add(txid)
    } catch (error) {
      // 如果 getmempoolentry 失败，说明不在 mempool 中（可能已被打包进区块）
      // 加入缓存防止后续重复检查
      this.currentCache.add(txid)
    }
  }

  /**
   * 辅助方法：延迟等待
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  onModuleDestroy() {
    if (this.socket) {
      this.socket.close()
      this.logger.log('ZMQ socket 已关闭')
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
  }
}
