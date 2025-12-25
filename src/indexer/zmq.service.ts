import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common'
import * as zmq from 'zeromq'
import { RpcService } from '../rpc/rpc.service'
import { PrismaService } from '../prisma/prisma.service'
import { IndexerService } from './indexer.service'
import { btcToSatoshisNumber } from '../utils/currency.utils'

@Injectable()
export class ZmqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ZmqService.name)
  private socket: zmq.Subscriber

  // 简单的缓存机制，防止重复处理
  // 使用双 Set 轮换机制清理过期数据 (30分钟轮换一次，最长保留60分钟)
  private currentCache = new Set<string>()
  private previousCache = new Set<string>()
  private cleanupInterval: NodeJS.Timeout

  constructor(
    private readonly rpcService: RpcService,
    private readonly prisma: PrismaService,
    private readonly indexerService: IndexerService
  ) {}

  async onModuleInit() {
    const useZmq = process.env.USE_ZMQ === 'true'
    if (!useZmq) {
      this.logger.log('ZMQ listener is disabled.')
      return
    }

    const zmqUrl = process.env.ZMQ_URL
    if (!zmqUrl) {
      this.logger.error('ZMQ_URL is not defined in .env')
      return
    }

    this.logger.log(`Initializing ZMQ listener on ${zmqUrl}...`)
    this.socket = new zmq.Subscriber()

    try {
      this.socket.connect(zmqUrl)
      this.logger.log('ZMQ socket connected.')

      // Subscribe to topics
      this.socket.subscribe('hashtx')
      this.socket.subscribe('hashblock')

      this.logger.log('Subscribed to "hashtx" and "hashblock" topics.')

      // 启动缓存清理定时器
      this.startCleanupInterval()

      // Start listening loop
      this.runLoop()
    } catch (error) {
      this.logger.error(`Failed to connect to ZMQ: ${error.message}`)
    }
  }

  private startCleanupInterval() {
    this.cleanupInterval = setInterval(
      () => {
        this.logger.debug(`Rotating transaction cache. Previous size: ${this.previousCache.size}, Current size: ${this.currentCache.size}`)
        this.previousCache = this.currentCache
        this.currentCache = new Set()
      },
      30 * 60 * 1000
    ) // 30 minutes
  }

  async runLoop() {
    for await (const [topic, message] of this.socket) {
      const topicName = topic.toString()
      const hexData = message.toString('hex')

      if (topicName === 'hashtx') {
        await this.handleTransaction(hexData)
      } else if (topicName === 'hashblock') {
        this.logger.log(`[Block] New Block: ${hexData}`)
        // Here you can process the new block hash
      }
    }
  }

  private async handleTransaction(txid: string) {
    // 1. 检查缓存：如果最近处理过，直接忽略（这是为了解决 ZMQ 在交易进入 Block 时会再次发送 hashtx 通知的重复问题）
    if (this.currentCache.has(txid) || this.previousCache.has(txid)) {
      return
    }

    // 2. 二次确认：通过 RPC 检查交易是否真的在 mempool 中
    // 因为当区块连接时，也会发送 hashtx，但此时交易已经不在 mempool 中了
    // 只有 getmempoolentry 返回成功的，才是真正的 "New Mempool Transaction"
    try {
      // 1. 确认在 mempool 中
      await this.rpcService.call('getmempoolentry', [txid])

      // 2. 获取详细交易数据
      const tx = await this.rpcService.call<any>('getrawtransaction', [txid, true])

      this.logger.log(`[Mempool] New Transaction: ${txid}`)

      // 3. 解析并打印交易详情
      if (tx) {
        const inputsCount = tx.vin.length
        const outputsCount = tx.vout.length

        // 计算总输出金额
        const totalOutput = tx.vout.reduce((sum: number, out: any) => sum + (out.value || 0), 0)

        this.logger.log(`    Details: Inputs: ${inputsCount}, Outputs: ${outputsCount}, Total Value: ${totalOutput}`)

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
              txid: txid, // 当前交易ID
              address: addresses.length > 0 ? addresses[0] : null, // 主要地址
              amount: value, // 正数
              voutIndex: out.n,
              spentTxid: null,
              spentIndex: null
            }
          })
          .filter((out: any) => out.address !== null)

        // 解析 Inputs
        // 使用 indexerService.findPreviousVout 获取详细信息 (地址和金额)
        const inputs = await Promise.all(
          tx.vin
            .map(async (inTx: any) => {
              let address = ''
              let amount = 0

              if (!inTx.coinbase) {
                const prevVout = await this.indexerService.findPreviousVout(inTx.txid, inTx.vout)
                if (prevVout) {
                  address = prevVout.address
                  amount = Number(prevVout.amount) // 转为 Number (注意精度)
                }
              }

              return {
                txid: txid, // 当前交易ID
                address: address,
                amount: -amount, // 负数，表示花费
                spentTxid: inTx.txid,
                spentIndex: inTx.vout,
                voutIndex: null
              }
            })
            .filter((inTx: any) => inTx.address !== '')
        )

        // 4. 保存到数据库
        try {
          await this.prisma.mempoolTransaction.upsert({
            where: { txid: txid },
            create: {
              txid: txid,
              hash: tx.hash,
              timestamp: new Date(), // 使用当前时间作为接收时间
              blockHeight: 0,
              size: tx.size,
              weight: tx.weight || 0,
              io: [...inputs, ...outputs]
            },
            update: {
              // 如果已存在，更新时间戳
              timestamp: new Date(),
              io: [...inputs, ...outputs]
            }
          })
          this.logger.log(`    Saved to MempoolTransaction table.`)
        } catch (dbError) {
          this.logger.error(`    Failed to save to DB: ${dbError.message}`)
        }

        // 打印输出地址 (接收方)
        outputs.forEach((out: any) => {
          if (out.address) {
            this.logger.log(`    -> Output #${out.voutIndex}: ${out.amount} sats => ${out.address}`)
          }
        })
      }

      // 添加到缓存
      this.currentCache.add(txid)

      // TODO: 这里可以添加业务逻辑，比如推送 WebSocket 通知等
    } catch (error) {
      // 如果 getmempoolentry 失败，说明不在 mempool 中（很可能是因为已经被打包进区块了）
      // 我们也把它加入缓存，防止后续重复检查（虽然理论上 Block 连接后不会再发 Mempool 通知，但防御性编程）
      this.currentCache.add(txid)

      // 不需要打印错误，这属于正常情况（过滤掉区块中的交易）
    }
  }

  onModuleDestroy() {
    if (this.socket) {
      this.socket.close()
      this.logger.log('ZMQ socket closed.')
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
  }
}
