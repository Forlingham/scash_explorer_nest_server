// src/snapshot/snapshot.service.ts
import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { RpcService } from '../rpc/rpc.service'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { satoshisToBtc } from 'src/utils/currency.utils'
import Decimal from 'decimal.js'

@Injectable()
export class SnapshotService {
  private readonly logger = new Logger(SnapshotService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly rpc: RpcService
  ) {}

  /**
   * 每天凌晨 00:01 运行一次，统计前一天的地址快照
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleCron() {
    if (process.env.SKIP_SYNC === 'true') {
      this.logger.warn('Snapshot is disabled. Skipping cron job.[handleCron]')
      return
    }
    try {
      const today = new Date()
      today.setUTCHours(0, 0, 0, 0)
      today.setDate(today.getDate() - 1)

      // 检查今天是否已经运行过
      const existing = await this.prisma.addressSnapshot.findFirst({
        where: { date: today }
      })
      if (existing) {
        this.logger.log(`Snapshot for ${today.toISOString()} already exists. Skipping.`)
        return
      }

      // 1. 获取 Top 1000
      const topHolders = await this.prisma.address.findMany({
        orderBy: { balance: 'desc' },
        take: 1000,
        select: { address: true, balance: true }
      })

      // 2. 准备要插入的数据
      const snapshotData = topHolders.map((holder, index) => ({
        address: holder.address,
        balance: holder.balance,
        rank: index + 1, // 排名
        date: today
      }))

      // 3. 批量插入快照
      const result = await this.prisma.addressSnapshot.createMany({
        data: snapshotData,
        skipDuplicates: true
      })

      this.logger.log(`Successfully created ${result.count} address snapshots.`)
    } catch (error) {
      this.logger.error('Error during daily snapshot job:', error.stack)
    }
  }

  // 每天凌晨 00:01 运行一次，统计前一天的区块、交易、地址数、总交易金额
  // @Cron('*/30 * * * * *')
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleDaily() {
    if (process.env.SKIP_SYNC === 'true') {
      this.logger.warn('Snapshot is disabled. Skipping cron job.[handleDaily]')
      return
    }
    // 1. 计算前一天的日期
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0) // 规范化到 UTC 日期
    today.setDate(today.getDate() - 1) // 前一天

    // 检查今天是否已经运行过
    const existing = await this.prisma.dailyStats.findFirst({
      where: { date: today }
    })
    if (existing) {
      this.logger.log(`Daily stats for ${today.toISOString()} already exists. Skipping.`)
      return
    }

    this.logger.log(`Starting daily stats calculation for ${today.toISOString()}...`)

    try {
      // 2. 计算前一天的时间范围
      const startOfDay = new Date(today)
      const endOfDay = new Date(today)
      endOfDay.setDate(endOfDay.getDate() + 1) // 下一天的开始

      // 3. 并行查询各项统计数据
      const [totalBlocks, totalTxs, totalVolumeResult, addrCount, latestPrice] = await Promise.all([
        // 统计前一天的区块数
        this.prisma.block.count({
          where: {
            timestamp: {
              gte: startOfDay,
              lt: endOfDay
            }
          }
        }),

        // 统计前一天的交易数
        this.prisma.transaction.count({
          where: {
            timestamp: {
              gte: startOfDay,
              lt: endOfDay
            }
          }
        }),

        // 统计前一天的总交易金额（绝对值）
        this.prisma.transactionIO.aggregate({
          where: {
            transaction: {
              timestamp: {
                gte: startOfDay,
                lt: endOfDay
              }
            },
            amount: {
              gt: 0 // 只统计输出（正数）
            }
          },
          _sum: {
            amount: true
          }
        }),

        // 统计截止到前一天的总地址数
        this.prisma.address.count(),

        // 获取最新价格用于计算市值
        this.prisma.price.findFirst({
          orderBy: {
            timestamp: 'desc'
          }
        })
      ])

      // 4. 计算总市值（如果有价格数据）
      let totalMarketCap: Decimal = new Decimal(0)
      if (latestPrice) {
        // 获取总供应量（所有地址余额之和）
        const totalSupplyResult = await this.prisma.address.aggregate({
          _sum: {
            balance: true
          }
        })

        if (totalSupplyResult._sum.balance) {
          // 市值 = 总供应量 * 价格
          const totalSupply = satoshisToBtc(totalSupplyResult._sum.balance) // 转换为主单位
          totalMarketCap = new Decimal(totalSupply).times(latestPrice.price)
        }
      }

      // 5. 创建每日统计记录
      await this.prisma.dailyStats.create({
        data: {
          date: today,
          totalBlocks,
          totalTxs,
          totalVolume: satoshisToBtc(totalVolumeResult._sum.amount || BigInt(0)),
          addrCount,
          totalMarketCap: totalMarketCap.toFixed(2)
        }
      })
    } catch (error) {
      this.logger.error(`Failed to create daily stats for ${today.toISOString()}:`, error)
      throw error
    }
  }

  // 每半小时获取一次币价
  // @Cron('*/30 * * * * *') // 每30秒执行一次，用于测试
  @Cron(CronExpression.EVERY_30_MINUTES)
  async handlePriceCron() {
    if (process.env.SKIP_SYNC === 'true') {
      this.logger.warn('Snapshot is disabled. Skipping cron job.[handlePriceCron]')
      return
    }
    this.logger.log('Starting price snapshot job...')

    try {
      // 1. 获取当前价格
      const { data } = await firstValueFrom(
        this.httpService.get('https://api.coingecko.com/api/v3/simple/price?ids=satoshi-cash-network&vs_currencies=usd') // {"scash":{"usd":0.00077399}}
      )

      // 2. 准备要插入的数据
      const priceData = {
        price: data['satoshi-cash-network'].usd,
        timestamp: new Date()
      }

      // 3. 插入快照
      await this.prisma.price.create({
        data: priceData
      })

      this.logger.log(`Successfully created price snapshot.`)
    } catch (error) {
      this.logger.error('Error during price snapshot job:', error.stack)
    }
  }

  // 每半小时获取一次当前网络算力
  // @Cron('*/30 * * * * *') // 每30秒执行一次，用于测试
  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleNetworkHashrateCron() {
    if (process.env.SKIP_SYNC === 'true') {
      this.logger.warn('Snapshot is disabled. Skipping cron job.[handleNetworkHashrateCron]')
      return
    }
    this.logger.log('Starting network hashrate snapshot job...')

    try {
      // 1. 通过RPC获取挖矿信息，包含网络算力
      const miningInfo = await this.rpc.call('getmininginfo')

      // 2. 从挖矿信息中提取网络算力 (networkhashps)
      const hashrate = miningInfo.networkhashps || 0

      // 3. 准备要插入的数据
      const hashrateData = {
        hashrate: BigInt(hashrate.toFixed(0)),
        timestamp: new Date()
      }

      // 4. 插入网络算力快照
      await this.prisma.networkHashrate.create({
        data: hashrateData
      })

      this.logger.log(`Successfully created network hashrate snapshot: ${hashrate} H/s`)
    } catch (error) {
      this.logger.error('Error during network hashrate snapshot job:', error.stack)
    }
  }
}
