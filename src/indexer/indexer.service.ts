import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { RpcService } from '../rpc/rpc.service'
import { Prisma } from '@prisma/client'
import { btcToSatoshis, btcToSatoshisNumber } from '../utils/currency.utils'
import { DapService } from '../dap/dap.service'

/**
 * 定义一个 Prisma 事务客户端的类型，用于在函数间传递。
 * 这排除了 $transaction 等顶级方法，使其与事务内的 'tx' 客户端兼容。
 */
type PrismaTransactionClient = Omit<PrismaService, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

@Injectable()
export class IndexerService implements OnModuleInit {
  private readonly logger = new Logger(IndexerService.name)
  private isSyncing = false // 锁，防止重复执行
  private isLogging = false // 锁，防止重复日志

  constructor(
    private readonly rpc: RpcService,
    private readonly prisma: PrismaService,
    private readonly dapService: DapService
  ) {}

  /**
   * 模块初始化时执行一次
   */
  async onModuleInit() {
    // this.logger.log('Indexer service initialized. Starting initial sync...');
    // await this.syncBlocks();
  }

  /**
   * 定时任务：每10秒检查一次新区块
   */
  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleCron() {
    // 检查是否开启了同步
    if (process.env.SKIP_SYNC === 'true') {
      if (!this.isLogging) this.logger.warn('Sync is disabled. Skipping cron job.')
      this.isLogging = true
      return
    }

    await this.syncBlocks()
  }

  /**
   * 主同步函数
   * [新增] 包含回滚检测逻辑
   */
  async syncBlocks() {
    if (this.isSyncing) {
      if (!this.isLogging) this.logger.warn('Sync is already in progress. Skipping.')
      this.isLogging = true
      return
    }
    this.isLogging = false
    this.isSyncing = true
    this.logger.log('Starting block sync process...')

    try {
      // 1. 获取我们数据库中的最新区块
      let localBlock = await this.prisma.block.findFirst({
        orderBy: { height: 'desc' }
      })
      let localHeight = -1
      if (localBlock) {
        localHeight = localBlock.height
      }

      // 2. 获取 RPC 节点的最新区块高度
      const rpcHeight = await this.rpc.call<number>('getblockcount')

      // --- [新增] 回滚检测 ---
      if (localBlock) {
        let rpcBlockHash = await this.rpc.call<string>('getblockhash', [localBlock.height])

        // 循环检测：如果哈希不匹配，就一直向后回滚
        while (localBlock.hash !== rpcBlockHash) {
          this.logger.warn(`REORG DETECTED at height ${localBlock.height}!`)
          this.logger.warn(`  Local Hash (Bad): ${localBlock.hash}`)
          this.logger.warn(`  Node Hash (Good): ${rpcBlockHash}`)

          // 执行回滚
          await this.handleReorg(localBlock.height)

          // 重新获取回滚后的本地最新区块
          localBlock = await this.prisma.block.findFirst({
            orderBy: { height: 'desc' }
          })

          if (!localBlock) {
            // 我们回滚了所有区块
            localHeight = -1
            this.logger.log('Database rolled back to genesis.')
            break // 退出 while 循环
          }

          // 再次检查新高度的哈希
          localHeight = localBlock.height
          rpcBlockHash = await this.rpc.call<string>('getblockhash', [localBlock.height])
        }
      }
      // --- 回滚检测结束 ---

      this.logger.log(`Syncing from safe height ${localHeight + 1} to ${rpcHeight}...`)

      // 3. 循环同步 (现在是安全的)
      for (let height = localHeight + 1; height <= rpcHeight; height++) {
        this.logger.log(`Syncing block ${height}/${rpcHeight}...`)

        const blockHash = await this.rpc.call<string>('getblockhash', [height])
        const blockData = await this.rpc.call<any>('getblock', [blockHash, 2])

        await this.processBlock(blockData)
      }

      this.logger.log('Block sync finished.')
    } catch (error) {
      this.logger.error('Error during block sync:', error.stack)
    } finally {
      this.isSyncing = false
    }
  }

  /**
   * 核心函数：解析区块并存入数据库
   * (已包含 vout 逻辑和外键约束修复)
   */
  private async processBlock(block: any) {
    await this.prisma.$transaction(
      async (tx) => {
        const blockTimestamp = new Date(block.time * 1000)

        // --- [新增] 提取矿工地址 ---
        // 矿工地址在区块的第一笔交易 (coinbase) 的输出中
        let minerAddress: string | null = null
        let reward: bigint = BigInt(0)
        const coinbaseTx = block.tx[0]
        if (coinbaseTx && coinbaseTx.vout) {
          for (const vout of coinbaseTx.vout) {
            if (vout.scriptPubKey && vout.scriptPubKey.address) {
              minerAddress = vout.scriptPubKey.address
              reward = btcToSatoshis(vout.value)
              break
            }
          }
        }
        // --- 矿工地址提取结束 ---

        // --- [新增] 费用计算逻辑 ---
        let medianFee = 0n
        let feeSpanMin = 0n
        let feeSpanMax = 0n
        let totalFees = 0n
        if (block.tx.length > 1) {
          // 至少有1笔非coinbase交易
          const feeRates: number[] = [] // 费率数组 (sat/vB)
          const totalFeesArray: number[] = [] // 总手续费数组

          for (const txn of block.tx.slice(1)) {
            const feeInSatoshis = txn.fee ? btcToSatoshisNumber(txn.fee) : 0
            const vsize = txn.vsize || (txn.weight ? txn.weight / 4 : 0)

            // 累计总手续费
            if (feeInSatoshis > 0) {
              totalFeesArray.push(feeInSatoshis)
            }

            // 计算费率 (sat/vB)
            if (vsize > 0 && feeInSatoshis > 0) {
              feeRates.push(feeInSatoshis / vsize)
            }
          }

          // 计算总手续费
          totalFees = BigInt(totalFeesArray.reduce((sum, fee) => sum + fee, 0))

          // 计算费率统计
          if (feeRates.length > 0) {
            feeRates.sort((a, b) => a - b)

            // 中位数费率
            const mid = Math.floor(feeRates.length / 2)
            medianFee = BigInt((feeRates.length % 2 !== 0 ? feeRates[mid] : (feeRates[mid - 1] + feeRates[mid]) / 2).toFixed(0))

            // 最小和最大费率
            feeSpanMin = BigInt(feeRates[0].toFixed(0))
            feeSpanMax = BigInt(feeRates[feeRates.length - 1].toFixed(0))
          }
        }
        // --- 费用计算结束 ---

        // 1. 创建 Block 记录
        await tx.block.create({
          data: {
            height: block.height,
            hash: block.hash,
            timestamp: blockTimestamp,
            txCount: block.tx.length,
            size: block.size,
            weight: block.weight,
            medianFee: medianFee,
            difficulty: block.difficulty,
            version: block.version,
            minerAddress: minerAddress,
            nonce: BigInt(block.nonce),
            reward: reward,
            feeSpanMin: feeSpanMin,
            feeSpanMax: feeSpanMax,
            totalFees: totalFees
          }
        })

        // --- [新增] 从 MempoolTransaction 表中删除已打包的交易 ---
        const txIds = block.tx.map((t: any) => t.txid)
        if (txIds.length > 0) {
          await tx.mempoolTransaction.deleteMany({
            where: {
              txid: { in: txIds }
            }
          })
          // this.logger.debug(`Removed ${txIds.length} transactions from MempoolTransaction.`);
        }
        // --- Mempool 清理结束 ---

        // 2. 遍历所有交易
        for (const txn of block.tx) {
          // 2.1 创建 Transaction 记录
          await tx.transaction.create({
            data: {
              txid: txn.txid,
              hash: txn.hash,
              timestamp: blockTimestamp,
              blockHeight: block.height,
              size: txn.size,
              weight: txn.weight
            }
          })

          // 2. 处理 Vin (花费，负数) 和 Vout (接收，正数)
          // 修复找零统计问题：先收集输入信息，再处理输出时区分找零
          const inputAddressAmounts = new Map<string, bigint>() // 记录每个地址在该交易中的总输入金额

          if (!txn.vin[0].coinbase) {
            for (const vin of txn.vin) {
              const prevVout = await this.findPreviousVout(vin.txid, vin.vout, tx)

              if (!prevVout) {
                this.logger.warn(`Skipping Vin for tx ${txn.txid}: Could not find prev vout ${vin.txid}:${vin.vout}`)
                continue
              }

              const { address, amount } = prevVout

              // 累加该地址的输入金额（处理多输入情况）
              inputAddressAmounts.set(address, (inputAddressAmounts.get(address) || 0n) + amount)

              // [FIXED] 先更新 Address（sent累计输入金额）
              await tx.address.upsert({
                where: { address: address },
                create: {
                  address: address,
                  balance: -amount,
                  sent: amount,
                  txCount: 1,
                  lastActive: blockTimestamp
                },
                update: {
                  balance: { decrement: amount },
                  sent: { increment: amount },
                  txCount: { increment: 1 },
                  lastActive: blockTimestamp
                }
              })

              // [FIXED] 再创建 TransactionIO
              await tx.transactionIO.create({
                data: {
                  txid: txn.txid,
                  address: address,
                  amount: -amount, // 负数
                  spentTxid: vin.txid,
                  spentIndex: vin.vout
                }
              })
            }
          }

          // 2.3 处理 Vout (接收，正数)
          // 收集找零金额，用于后续扣除sent和received
          const addressChangeAmounts = new Map<string, bigint>()

          for (const vout of txn.vout) {
            if (vout.scriptPubKey && vout.scriptPubKey.address) {
              const address = vout.scriptPubKey.address
              const amount = btcToSatoshis(vout.value)

              // 判断是否为找零：如果该地址在输入中出现过
              const inputAmount = inputAddressAmounts.get(address) || 0n
              if (inputAmount > 0) {
                // 记录找零金额
                const totalChange = addressChangeAmounts.get(address) || 0n
                addressChangeAmounts.set(address, totalChange + amount)
              }

              // 判断是否为找零输出
              const isChangeOutput = inputAmount > 0 && amount <= inputAmount

              if (isChangeOutput) {
                // 找零输出：只更新balance和txCount，不计入received
                await tx.address.upsert({
                  where: { address: address },
                  create: {
                    address: address,
                    balance: amount,
                    txCount: 1,
                    lastActive: blockTimestamp
                  },
                  update: {
                    balance: { increment: amount },
                    lastActive: blockTimestamp
                  }
                })
              } else {
                // 正常收款输出：计入received
                await tx.address.upsert({
                  where: { address: address },
                  create: {
                    address: address,
                    balance: amount,
                    received: amount,
                    txCount: 1,
                    lastActive: blockTimestamp
                  },
                  update: {
                    balance: { increment: amount },
                    received: { increment: amount },
                    txCount: { increment: 1 },
                    lastActive: blockTimestamp
                  }
                })
              }

              // 创建 TransactionIO
              await tx.transactionIO.create({
                data: {
                  txid: txn.txid,
                  address: address,
                  amount: amount,
                  voutIndex: vout.n
                }
              })

              // 检测 DAP 地址并标记
              if (this.dapService.isDapAddress(address)) {
                await tx.address.update({
                  where: { address },
                  data: { isDapCreated: true }
                })
              }
            }
          }

          // 扣除找零金额：sent不计入找零（只算真正发给他人的）
          for (const [address, changeAmount] of addressChangeAmounts) {
            if (changeAmount > 0n) {
              await tx.address.update({
                where: { address },
                data: {
                  sent: { decrement: changeAmount },
                  txCount: { decrement: 1 }
                }
              })
            }
          }

          // [新增] 处理 DAP 数据解析和存储
          if (this.dapService.isAvailable()) {
            await this.dapService.processTransactionDap(txn.txid, block.height, blockTimestamp, txn.vout, [...inputAddressAmounts.keys()])
          }
        }
      },
      {
        timeout: 120000 // 事务超时时间 120 秒，处理大区块时需要更长时间
      }
    )

    // this.logger.log(`Successfully processed and saved block ${block.height}`);
  }

  /**
   * 辅助函数：查找 Vin 对应的 Vout 信息 (地址和金额)
   * (已包含数据库优先查询 和 RPC 逻辑修复)
   */
  public async findPreviousVout(
    txid: string,
    index: number,
    tx?: PrismaTransactionClient
  ): Promise<{ address: string; amount: bigint } | null> {
    // 如果没有传入事务客户端，使用默认的 prisma 服务
    const client = tx || this.prisma

    // --- 方案 B: (首选) 从数据库查找 ---
    try {
      const voutIO = await client.transactionIO.findFirst({
        where: {
          txid: txid,
          voutIndex: index,
          amount: { gt: 0 }
        }
      })
      if (voutIO) {
        return { address: voutIO.address, amount: voutIO.amount }
      }
    } catch (error) {
      this.logger.warn(`DB lookup for prev vout failed: ${txid}:${index}`, error.message)
    }

    // --- 方案 A: (回退) 实时 RPC 调用 ---
    // this.logger.debug(`DB lookup failed, falling back to RPC for ${txid}:${index}`)
    try {
      const prevTx = await this.rpc.call<any>('getrawtransaction', [txid, true])
      const vout = prevTx.vout[index]

      // [FIXED] 检查 vout.scriptPubKey.address (单数)
      if (vout && vout.scriptPubKey && vout.scriptPubKey.address) {
        return {
          address: vout.scriptPubKey.address,
          amount: btcToSatoshis(vout.value)
        }
      }
    } catch (error) {
      this.logger.warn(`RPC lookup failed for prev vout: ${txid}:${index}`, error.message)
    }

    // this.logger.error(`Could not find prev vout for ${txid}:${index} by any method.`)
    return null
  }

  /**
   * [新增] 处理区块链回滚
   * @param badBlockHeight 需要被删除的区块高度
   */
  private async handleReorg(badBlockHeight: number) {
    this.logger.log(`Rolling back block ${badBlockHeight}...`)

    await this.prisma.$transaction(
      async (tx) => {
        // 1. 找到所有在此区块中被影响的 TransactionIO
        const iosToRollback = await tx.transactionIO.findMany({
          where: {
            transaction: { blockHeight: badBlockHeight }
          },
          select: { address: true } // 只需要地址
        })

        // 2. 获取所有受影响的 *唯一* 地址
        const affectedAddresses = [...new Set(iosToRollback.map((io) => io.address))]
        this.logger.log(`Reorg affects ${affectedAddresses.length} unique addresses.`)

        // 3. 按正确顺序删除数据 (外键约束)
        // 3a. 删除 TransactionIO
        await tx.transactionIO.deleteMany({
          where: {
            transaction: { blockHeight: badBlockHeight }
          }
        })

        // 3b. 删除 Transaction
        await tx.transaction.deleteMany({
          where: { blockHeight: badBlockHeight }
        })

        // 3c. 删除 Block
        await tx.block.delete({
          where: { height: badBlockHeight }
        })

        // 4. [关键] 为所有受影响的地址重建状态
        this.logger.log(`Recalculating state for ${affectedAddresses.length} addresses...`)
        for (const address of affectedAddresses) {
          await this.recalculateAddressState(address, tx)
        }

        this.logger.log(`Block ${badBlockHeight} successfully rolled back.`)
      },
      {
        timeout: 120000 // 回滚可能很慢，给更长的超时时间
      }
    )
  }

  /**
   * [新增] 完全重新计算一个地址的所有状态
   * 这是保证回滚后数据一致性的唯一方法
   * @param address 要重建的地址
   * @param tx Prisma 事务客户端
   */
  private async recalculateAddressState(address: string, tx: PrismaTransactionClient) {
    // 1. 查找该地址 *所有* 剩余的 IO 记录
    const ios = await tx.transactionIO.findMany({
      where: { address: address },
      include: {
        transaction: {
          select: { timestamp: true } // 需要交易时间来找 lastActive
        }
      }
    })

    if (ios.length === 0) {
      // 这个地址在回滚后没有任何交易了
      this.logger.log(`Address ${address} has no txs left, resetting.`)
      try {
        // 尝试删除，如果失败（例如有其他外键），则重置
        await tx.address.delete({ where: { address: address } })
      } catch (e) {
        await tx.address.update({
          where: { address: address },
          data: { balance: 0, received: 0, sent: 0, txCount: 0 }
        })
      }
      return
    }

    // 2. 从零开始计算
    let newBalance = 0n
    let newReceived = 0n
    let newSent = 0n
    let newLastActive = new Date(0) // 1970年

    for (const io of ios) {
      newBalance += io.amount // BigInt 加法

      if (io.amount > 0) {
        newReceived += io.amount
      } else {
        newSent += -io.amount // amount 是负数，转为正数累加
      }

      if (io.transaction.timestamp > newLastActive) {
        newLastActive = io.transaction.timestamp
      }
    }

    // 3. 计算唯一交易次数 (这是更准确的 txCount)
    const newTxCount = new Set(ios.map((io) => io.txid)).size

    // 4. 更新 Address 表
    await tx.address.update({
      where: { address: address },
      data: {
        balance: newBalance,
        received: newReceived,
        sent: newSent,
        txCount: newTxCount,
        lastActive: newLastActive
      }
    })
  }
}
