// src/explorer/explorer.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { RpcService } from '../rpc/rpc.service'
import { btcToSatoshisNumber, satoshisToBtc } from '../utils/currency.utils'
import Decimal from 'decimal.js'
import { AddressSnapshot, AddressTag } from '@prisma/client'
import { calculateSkip } from 'src/utils/utils'

@Injectable()
export class ExplorerService {
  private readonly logger = new Logger(ExplorerService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly rpc: RpcService
  ) {}

  // 获取当前最新区块高度
  private async getCurrentBlockHeight(): Promise<number> {
    const currentBlock = await this.prisma.block.findFirst({
      orderBy: { height: 'desc' },
      select: { height: true }
    })
    return currentBlock?.height || 0
  }

  // 处理交易数据，提取所需格式
  private async processTransactionData(transactions: any[], currentBlockHeight?: number) {
    // 批量查询 dapData，避免 N+1 问题
    const txids = transactions.map((tx) => tx.txid)
    const dapDataList = await this.prisma.dapData.findMany({
      where: { txid: { in: txids } }
    })

    // 构建 Map 以便快速查找
    const dapDataMap = new Map(dapDataList.map((data) => [data.txid, data]))

    return transactions.map((tx) => {
      // 分离输入和输出
      const inputs = tx.io.filter((io) => io.amount < 0)
      const outputs = tx.io.filter((io) => io.amount > 0)

      // 获取发送方地址集合
      const senderAddresses = new Set(inputs.map((input) => input.address))

      // 分离真实接收方和找零地址
      const realReceivers: { address: string; amount: number }[] = []
      const changeOutputs: { address: string; amount: number }[] = []
      let changeAmount = 0

      outputs.forEach((output) => {
        if (senderAddresses.has(output.address)) {
          // 这是找零地址
          changeOutputs.push({
            address: output.address,
            amount: Number(output.amount)
          })
          changeAmount += Number(output.amount)
        } else {
          // 这是真实接收方
          realReceivers.push({
            address: output.address,
            amount: Number(output.amount)
          })
        }
      })

      // 计算真实转账金额（总输出 - 找零）
      const totalOutputAmount = outputs.reduce((sum, output) => sum + Number(output.amount), 0)
      const realTransferAmount = totalOutputAmount - changeAmount

      // 计算手续费（输入总额 - 输出总额）
      // 如果没有输入（coinbase交易/挖矿奖励），手续费为0
      const totalInputs = inputs.reduce((sum, input) => sum + Math.abs(Number(input.amount)), 0)
      const fee = inputs.length === 0 ? 0 : totalInputs - totalOutputAmount

      // 提取发送方地址和金额（输入地址）
      const senders = inputs.map((input) => ({
        address: input.address,
        amount: Math.abs(Number(input.amount))
      }))

      // 计算确认次数（当前区块高度 - 交易所在区块高度 + 1）
      // 如果交易还未被确认（当前区块高度小于交易所在区块高度），确认次数为0
      const confirmations = currentBlockHeight && tx.blockHeight <= currentBlockHeight ? currentBlockHeight - tx.blockHeight + 1 : 0

      // 判断是否有dap数据，是否是留言dap
      const dapData = dapDataMap.get(tx.txid)
      const isMessageDap = dapData?.isMessageDap || false

      return {
        txid: tx.txid,
        blockHeight: tx.blockHeight,
        size: tx.size,
        weight: tx.weight,
        senders: senders,
        receivers: realReceivers,
        changeOutputs: changeOutputs, // 找零输出
        totalAmount: realTransferAmount, // 真实转账金额
        fee: fee,
        timestamp: tx.timestamp,
        confirmations: confirmations,
        dapStatus: {
          isDap: dapData !== undefined,
          isMessageDap
        }
      }
    })
  }

  /**
   * 获取近7天交易数量按天统计（折线图数据）
   */
  async getTransactionStatsLast7Days() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    // 使用原生SQL查询按天统计交易数量，排除挖矿产出交易（coinbase交易）
    // coinbase交易只有输出没有输入，所以所有io记录都是正数
    // 我们只统计至少有一个负数io记录的交易（即有输入的交易）
    const stats = await this.prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        DATE(t.timestamp) as date,
        COUNT(DISTINCT t.txid) as "txCount"
      FROM "Transaction" t
      WHERE t.timestamp >= $1
        AND EXISTS (
          SELECT 1 FROM "TransactionIO" io 
          WHERE io.txid = t.txid AND io.amount < 0
        )
      GROUP BY DATE(t.timestamp)
      ORDER BY date ASC;
      `,
      sevenDaysAgo
    )

    // 格式化返回数据
    return stats.map((s) => ({
      date: s.date.toISOString().split('T')[0], // 格式化为 YYYY-MM-DD
      txCount: Number(s.txCount)
    }))
  }

  /**
   * 获取网络hash每小时统计（折线图数据）
   */
  async getNetworkHashStatsHourly(hours: number = 24) {
    const hoursAgo = new Date(Date.now() - hours * 60 * 60 * 1000)

    // 使用NetworkHashrate表查询按小时统计网络算力
    const stats = await this.prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        DATE_TRUNC('hour', timestamp) as hour,
        AVG(hashrate) as "avgHashrate"
      FROM "NetworkHashrate"
      WHERE timestamp >= $1
      GROUP BY DATE_TRUNC('hour', timestamp)
      ORDER BY hour ASC;
      `,
      hoursAgo
    )

    // 格式化返回数据
    return stats.map((s) => ({
      hour: s.hour.toISOString(), // ISO格式的小时时间戳
      networkHash: Number(s.avgHashrate) // 使用实际的网络算力数据
    }))
  }

  /**
   * 获取网络难度每小时统计（折线图数据）
   */
  async getNetworkDifficultyStatsHourly(hours: number = 24) {
    const hoursAgo = new Date(Date.now() - hours * 60 * 60 * 1000)

    // 使用原生SQL查询按小时统计网络难度
    const stats = await this.prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        DATE_TRUNC('hour', timestamp) as hour,
        AVG(difficulty) as "avgDifficulty"
      FROM "Block"
      WHERE timestamp >= $1
      GROUP BY DATE_TRUNC('hour', timestamp)
      ORDER BY hour ASC;
      `,
      hoursAgo
    )

    // 格式化返回数据
    return stats.map((s) => ({
      hour: s.hour.toISOString(), // ISO格式的小时时间戳
      difficulty: Number(s.avgDifficulty)
    }))
  }

  /**
   * 获取近1000个区块挖矿获得者地址分布（饼图数据）
   */
  async getMinerDistributionStats(blockCount: number = 1000) {
    // 获取最新区块高度
    const latestBlock = await this.prisma.block.findFirst({
      orderBy: { height: 'desc' },
      select: { height: true }
    })

    if (!latestBlock) {
      return { totalBlocks: 0, minerDistribution: [] }
    }

    const startHeight = Math.max(0, latestBlock.height - blockCount + 1)

    // 使用groupBy统计矿工地址分布
    const minerStats = await this.prisma.block.groupBy({
      by: ['minerAddress'],
      where: {
        height: {
          gte: startHeight,
          lte: latestBlock.height
        },
        minerAddress: { not: null } // 过滤掉空的矿工地址
      },
      _count: {
        minerAddress: true
      },
      orderBy: {
        _count: {
          minerAddress: 'desc'
        }
      }
    })

    const totalBlocks = minerStats.reduce((sum, s) => sum + s._count.minerAddress, 0)

    // 查询所有矿工地址的标签
    const minerAddresses = minerStats.map((s) => s.minerAddress).filter(Boolean) as string[]
    const tags = await this.prisma.addressTag.findMany({
      where: {
        address: { in: minerAddresses },
        status: 1
      },
      orderBy: { sortOrder: 'desc' },
      select: { address: true, name: true }
    })

    // 构建地址 → 标签名映射（取排序最高的标签）
    const tagMap = new Map<string, string>()
    for (const tag of tags) {
      if (!tagMap.has(tag.address)) {
        tagMap.set(tag.address, tag.name)
      }
    }

    // 格式化返回数据
    return {
      totalBlocksScanned: totalBlocks,
      minerDistribution: minerStats.map((s) => ({
        address: s.minerAddress,
        blocksMined: s._count.minerAddress,
        percentage: Number(((s._count.minerAddress / totalBlocks) * 100).toFixed(2)),
        tag: tagMap.get(s.minerAddress!) || null
      }))
    }
  }

  // 获取区块列表
  async blocks(page: number = 1, pageSize: number = 20) {
    const blocks = await this.prisma.block.findMany({
      orderBy: { height: 'desc' },
      take: pageSize,
      skip: calculateSkip(page, pageSize)
    })

    // 计算总页数
    const total = await this.prisma.block.count()
    const totalPages = Math.ceil(total / pageSize)

    return {
      list: blocks,
      pagination: {
        total: total,
        totalPages: totalPages,
        currentPage: page,
        pageSize: pageSize
      }
    }
  }

  // 使用区块高度或者hash查询区块详情
  async blockDetail(heightOrHash: string) {
    if (isNaN(Number(heightOrHash))) {
      // 按hash查询
      const blockByHash = await this.prisma.block.findFirst({
        where: { hash: heightOrHash }
      })

      if (blockByHash) {
        return blockByHash
      }
    }

    // 尝试按高度查询
    if (!isNaN(Number(heightOrHash))) {
      const blockByHeight = await this.prisma.block.findFirst({
        where: { height: Number(heightOrHash) }
      })

      if (blockByHeight) {
        return blockByHeight
      }
    }

    throw new Error('Block not found')
  }

  // 使用区块高度，查询出当前区块中的交易列表，包含所有详情。需要分页
  async getBlockTransactions(blockHeight: number, page: number = 1, pageSize: number = 20) {
    // 首先验证区块是否存在
    const block = await this.prisma.block.findUnique({
      where: { height: blockHeight },
      select: { height: true, hash: true, timestamp: true, txCount: true }
    })

    if (!block) {
      throw new Error(`Block with height ${blockHeight} not found`)
    }

    // 查询该区块中的交易列表（根据schema，Transaction表通过blockHeight关联）
    const transactions = await this.prisma.transaction.findMany({
      where: { blockHeight: blockHeight },
      orderBy: { timestamp: 'desc' },
      take: pageSize,
      skip: calculateSkip(page, pageSize),
      include: { io: true } // 包含所有的输入 (负数) 和输出 (正数)
    })

    // 获取当前最新区块高度用于计算确认次数
    const currentBlockHeight = await this.getCurrentBlockHeight()

    // 计算该区块中的交易总数（使用区块的txCount字段更高效）
    const total = block.txCount
    const totalPages = Math.ceil(total / pageSize)

    // 计算确认次数
    const confirmations = currentBlockHeight - blockHeight + 1

    // 处理交易数据，提取所需格式（与transactions方法保持一致）
    const processedTransactions = await this.processTransactionData(transactions, currentBlockHeight)

    return {
      block: {
        height: block.height,
        hash: block.hash,
        timestamp: block.timestamp,
        txCount: block.txCount,
        confirmations: confirmations
      },
      list: processedTransactions,
      pagination: {
        total: total,
        totalPages: totalPages,
        currentPage: page,
        pageSize: pageSize
      }
    }
  }

  // 查询地址下的交易列表
  async getAddressTransactions(address: string, page: number = 1, pageSize: number = 20) {
    // 验证地址是否存在
    const addressExists = await this.prisma.transactionIO.findFirst({
      where: { address }
    })

    if (!addressExists) {
      return {
        address,
        list: [],
        pagination: {
          total: 0,
          totalPages: 0,
          currentPage: page,
          pageSize
        }
      }
    }

    // 计算总交易数（使用count查询，避免全量获取）
    const total = await this.prisma.transactionIO
      .groupBy({
        by: ['txid'],
        where: { address },
        _count: true
      })
      .then((result) => result.length)

    const totalPages = Math.ceil(total / pageSize)

    // 直接分页查询交易ID（使用distinct和take/skip实现分页）
    const paginatedTxIds = await this.prisma.transactionIO
      .findMany({
        where: { address },
        select: { txid: true },
        distinct: ['txid'],
        orderBy: {
          transaction: {
            timestamp: 'desc'
          }
        },
        take: pageSize,
        skip: calculateSkip(page, pageSize)
      })
      .then((results) => results.map((tx) => tx.txid))

    // 查询这些交易的详细信息
    const transactions = await this.prisma.transaction.findMany({
      where: { txid: { in: paginatedTxIds } },
      orderBy: { timestamp: 'desc' },
      include: { io: true }
    })

    // 获取当前最新区块高度用于计算确认次数
    const currentBlockHeight = await this.getCurrentBlockHeight()

    // 处理交易数据，提取所需格式（与getBlockTransactions方法保持一致）
    const processedTransactions = await this.processTransactionData(transactions, currentBlockHeight)

    return {
      address,
      list: processedTransactions,
      pagination: {
        total,
        totalPages,
        currentPage: page,
        pageSize
      }
    }
  }

  // 查询地址详情
  async getAddressDetail(address: string) {
    // 验证地址是否存在
    const addressExists = await this.prisma.address.findFirst({
      where: { address },
      include: {
        tags: {
          orderBy: {
            sortOrder: 'desc'
          },
          where: {
            status: 1
          },
          select: {
            name: true,
            type: true,
            description: true,
            source: true
          }
        }
      }
    })

    if (!addressExists) {
      return {
        address,
        balance: 0,
        transactionCount: 0,
        received: 0,
        sent: 0,
        firstSeen: null,
        lastSeen: null,
        addressTags: []
      }
    }

    // 查询地址的所有交易输入输出
    const firstTransactionPrisma = await this.prisma.transactionIO.findFirst({
      where: { address },
      include: {
        transaction: true
      },
      orderBy: {
        transaction: {
          timestamp: 'asc'
        }
      }
    })

    const lastTransactionPrisma = await this.prisma.transactionIO.findFirst({
      where: { address },
      include: {
        transaction: true
      },
      orderBy: {
        transaction: {
          timestamp: 'desc'
        }
      }
    })

    const firstTransaction = firstTransactionPrisma?.transaction || null
    const lastTransaction = lastTransactionPrisma?.transaction || null

    return {
      address,
      balance: addressExists.balance,
      transactionCount: addressExists.txCount,
      received: addressExists.received,
      sent: addressExists.sent,
      firstSeen: firstTransaction?.timestamp || null,
      lastSeen: lastTransaction?.timestamp || null,
      addressTags: addressExists.tags
    }
  }

  // 使用区块高度查询当前区块全部交易的大小和手续费
  async getBlockTransactionVisualization(blockHeight: number) {
    // 首先验证区块是否存在
    const block = await this.prisma.block.findUnique({
      where: { height: blockHeight },
      select: { height: true }
    })

    if (!block) {
      throw new Error(`Block with height ${blockHeight} not found`)
    }

    // 查询该区块中的所有交易
    const transactions = await this.prisma.transaction.findMany({
      where: { blockHeight: blockHeight },
      orderBy: { timestamp: 'desc' },
      include: { io: true } // 包含所有的输入 (负数) 和输出 (正数)
    })

    // 处理交易数据，提取可视化所需的字段
    const visualizationData = transactions.map((tx) => {
      // 分离输入和输出
      const inputs = tx.io.filter((io) => io.amount < 0)
      const outputs = tx.io.filter((io) => io.amount > 0)

      // 计算总输出金额作为交易价值
      const totalOutputAmount = outputs.reduce((sum, output) => sum + Number(output.amount), 0)

      // 计算手续费（输入总额 - 输出总额）
      // 如果没有输入（coinbase交易/挖矿奖励），手续费为0
      const totalInputs = inputs.reduce((sum, input) => sum + Math.abs(Number(input.amount)), 0)
      const fee = inputs.length === 0 ? 0 : totalInputs - totalOutputAmount

      return {
        txid: tx.txid,
        size: tx.size,
        fee: fee,
        value: totalOutputAmount // 交易总价值（所有输出的总和）
      }
    })

    return visualizationData
  }

  // 查询地址详情

  // 查询地址下的交易列表

  // 获取交易列表
  async transactions(page: number = 1, pageSize: number = 20) {
    // 排除挖矿奖励交易：通过检查交易是否有负数的io记录来判断
    // coinbase交易只有输出没有输入，所以所有io记录都是正数
    const transactions = await this.prisma.transaction.findMany({
      where: {
        io: {
          some: {
            amount: { lt: 0 } // 至少有一个负数的io记录（输入），说明不是coinbase交易
          }
        }
      },
      orderBy: { timestamp: 'desc' },
      take: pageSize,
      skip: calculateSkip(page, pageSize),
      include: { io: true } // 包含所有的输入 (负数) 和输出 (正数)
    })

    // 获取当前最新区块高度用于计算确认次数
    const currentBlockHeight = await this.getCurrentBlockHeight()

    // 计算总页数（也要排除coinbase交易）
    const total = await this.prisma.transaction.count({
      where: {
        io: {
          some: {
            amount: { lt: 0 }
          }
        }
      }
    })
    const totalPages = Math.ceil(total / pageSize)

    // 处理交易数据，提取所需格式
    const processedTransactions = await this.processTransactionData(transactions, currentBlockHeight)

    return {
      list: processedTransactions,
      pagination: {
        total: total,
        totalPages: totalPages,
        currentPage: page,
        pageSize: pageSize
      }
    }
  }

  // --- 基础查询 ---

  async getBlock(heightOrHash: string) {
    const isHash = heightOrHash.length > 10 // 简单的判断是高度还是哈希
    const where = isHash ? { hash: heightOrHash } : { height: Number(heightOrHash) }

    const block = await this.prisma.block.findUnique({
      where: where,
      include: { transactions: true } // 同时返回交易列表
    })
    if (!block) {
      throw new NotFoundException('Block not found')
    }
    return block
  }

  async getTransaction(txid: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { txid: txid },
      include: {
        io: true // 包含所有的输入 (负数) 和输出 (正数)
      }
    })

    if (!tx) {
      // 当交易不存在的时候需要查询一下内存池
      const mempoolTx = await this.prisma.mempoolTransaction.findUnique({
        where: { txid: txid }
      })
      if (mempoolTx) {
        const [processedTransaction] = await this.processTransactionData([mempoolTx])
        return {
          tx: mempoolTx,
          processedTransaction: processedTransaction
        }
      }
      return {
        tx: null,
        processedTransaction: null
      }
    }

    // 获取当前最新区块高度用于计算确认次数
    const currentBlockHeight = await this.getCurrentBlockHeight()

    // 处理交易数据，提取所需格式（与getBlockTransactions方法保持一致）
    const [processedTransaction] = await this.processTransactionData([tx], currentBlockHeight)

    return {
      tx,
      processedTransaction
    }
  }

  async getAddressInfo(address: string) {
    const addr = await this.prisma.address.findUnique({
      where: { address: address }
    })
    if (!addr) {
      throw new NotFoundException('Address not found')
    }
    return addr
  }

  // --- 特殊功能 API ---

  // 功能 1: 统计活跃/不活跃钱包
  async getWalletStats() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const activeCount = await this.prisma.address.count({
      where: { lastActive: { gte: thirtyDaysAgo }, isDapCreated: false }
    })
    const totalCount = await this.prisma.address.count({
      where: { isDapCreated: false }
    })
    return {
      activeCount,
      inactiveCount: totalCount - activeCount,
      totalCount
    }
  }

  // 功能 2: 统计前100名持币者
  async getTopHolders() {
    return this.prisma.address.findMany({
      orderBy: { balance: 'desc' },
      where: { isDapCreated: false },
      take: 100,
      select: {
        address: true,
        balance: true
      }
    })
  }

  // 功能 3: 获取内存池中的交易
  async getMempool() {
    const txids = await this.rpc.call<string[]>('getrawmempool', [false])

    // 限制返回数量，防止 API 请求过大
    const detailedTxCount = Math.min(txids.length, 50)

    const txPromises = txids.slice(0, detailedTxCount).map((txid) =>
      this.rpc.call<any>('getrawtransaction', [txid, true]).catch((err) => {
        console.warn(`Failed to get mempool tx ${txid}: ${err.message}`)
        return null // 容错
      })
    )
    const transactions = (await Promise.all(txPromises)).filter(Boolean) // 过滤掉 null

    return {
      count: txids.length,
      transactions: transactions
    }
  }

  // 功能 4: 查看一个地址全部的交易关系图
  async getAddressGraph(address: string) {
    // 1) 直接查询包含该地址的最近交易（包含完整IO），按时间倒序，限制数量以控图复杂度
    const transactions = await this.prisma.transaction.findMany({
      where: { io: { some: { address } } },
      orderBy: { timestamp: 'desc' },
      take: 50,
      include: { io: true }
    })

    const incoming: { address: string; txid: string; amount: number; timestamp: Date }[] = []
    const outgoing: { address: string; txid: string; amount: number; timestamp: Date }[] = []
    const seenIncomingKeys = new Set<string>() // 防重复：from-txid
    const seenOutgoingKeys = new Set<string>() // 防重复：to-txid

    for (const tx of transactions) {
      const inputs = tx.io.filter((io) => io.amount < 0)
      const outputs = tx.io.filter((io) => io.amount > 0)

      const isSender = inputs.some((io) => io.address === address)
      const isReceiver = outputs.some((io) => io.address === address)

      // 下一层（支出）：我 -> 对方（排除找零）
      if (isSender) {
        for (const out of outputs) {
          const to = out.address
          if (to === address) continue // 过滤找零
          const key = `${to}-${tx.txid}`
          if (seenOutgoingKeys.has(key)) continue
          outgoing.push({ address: to, txid: tx.txid, amount: Number(out.amount), timestamp: tx.timestamp })
          seenOutgoingKeys.add(key)
        }
      }

      // 上一层（收到）：对方 -> 我
      if (isReceiver) {
        const myReceived = outputs.filter((o) => o.address === address).reduce((sum, o) => sum + Number(o.amount), 0)

        // 去重输入地址（同一交易同一地址可能有多个输入）
        const uniqueSenders = Array.from(new Set(inputs.map((i) => i.address).filter((a) => a !== address)))
        for (const from of uniqueSenders) {
          const key = `${from}-${tx.txid}`
          if (seenIncomingKeys.has(key)) continue
          incoming.push({ address: from, txid: tx.txid, amount: myReceived, timestamp: tx.timestamp })
          seenIncomingKeys.add(key)
        }
      }
    }

    // 时间倒序排序
    incoming.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    outgoing.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    // 关联地址标签（按更新时间倒序）
    const relatedAddresses = Array.from(new Set([address, ...incoming.map((i) => i.address), ...outgoing.map((o) => o.address)]))
    const tags = await this.prisma.addressTag.findMany({
      where: { address: { in: relatedAddresses } },
      orderBy: { updatedAt: 'desc' }
    })

    const tagsByAddress = new Map<string, any[]>()
    for (const tag of tags) {
      const arr = tagsByAddress.get(tag.address) || []
      arr.push({
        id: tag.id,
        name: tag.name,
        type: tag.type,
        description: tag.description,
        status: tag.status,
        source: tag.source,
        createdAt: tag.createdAt,
        updatedAt: tag.updatedAt
      })
      tagsByAddress.set(tag.address, arr)
    }

    const incomingWithTags = incoming.map((i) => ({ ...i, tags: tagsByAddress.get(i.address) || [] }))
    const outgoingWithTags = outgoing.map((o) => ({ ...o, tags: tagsByAddress.get(o.address) || [] }))
    const centerTags = tagsByAddress.get(address) || []

    return {
      center: address,
      centerTags,
      incoming: incomingWithTags,
      outgoing: outgoingWithTags
    }
  }

  /**
   * [新增] 功能 5: 交易费用估算
   * 估算在 N 个区块内确认的费率 (sat/vB)
   * @param confirmationTarget 确认目标区块数 (例如 1, 6, 144)
   */
  async getFeeEstimate(confirmationTarget: number = 6) {
    try {
      // 'estimatesmartfee' 是标准 Bitcoin Core RPC
      // 第一个参数是目标区块数
      // 第二个参数是模式 ("ECONOMICAL" 或 "CONSERVATIVE")
      const result = await this.rpc.call<any>('estimatesmartfee', [confirmationTarget, 'ECONOMICAL'])

      if (result.errors) {
        throw new Error(result.errors.join(', '))
      }

      // 返回的 feerate 是 BTC/kB，我们需要将其转换为 sat/vB
      // 1 BTC/kB = 100,000,000 sat / 1000 vB = 100,000 sat/vB
      // !! 检查你的 altcoin 的单位 !!
      // 假设返回的是以 币种/kB 为单位
      const feeRatePerKb = result.feerate || 0
      const feeRatePerVb = btcToSatoshisNumber(feeRatePerKb) / 1000 // 转换为 sat/vB

      return {
        targetBlocks: confirmationTarget,
        feeRateSatPerVb: feeRatePerVb > 0.1 ? feeRatePerVb : 0.1, // 返回一个最小值
        estimatedInBlocks: result.blocks
      }
    } catch (error) {
      this.logger.warn(`Failed to get fee estimate: ${error.message}`)
      // 如果 RPC 不支持或失败，返回一个合理的默认值
      return {
        targetBlocks: confirmationTarget,
        feeRateSatPerVb: 1.0, // 默认 1 sat/vB
        estimatedInBlocks: confirmationTarget
      }
    }
  }

  /**
   * [新增] 获取区块统计数据 (用于图表)
   * @param days 要查询的天数
   */
  async getBlockStatsForChart(days: number = 30) {
    const thirtyDaysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    // [更新] 在 SQL 查询中添加 AVG(difficulty)
    const stats = await this.prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        DATE(timestamp) as date,
        AVG("txCount") as "avgTxCount",
        AVG(size) as "avgSize",
        AVG("medianFee") as "avgMedianFee",
        AVG(difficulty) as "avgDifficulty"
      FROM "Block"
      WHERE timestamp >= $1
      GROUP BY DATE(timestamp)
      ORDER BY date ASC;
    `,
      thirtyDaysAgo
    )

    // [更新] 在返回中添加 avgDifficulty
    return stats.map((s) => ({
      date: s.date.toISOString().split('T')[0],
      avgTxCount: Number(s.avgTxCount).toFixed(0),
      avgSize: Number(s.avgSize).toFixed(0),
      avgMedianFee: Number(s.avgMedianFee).toFixed(2),
      avgDifficulty: Number(s.avgDifficulty).toFixed(2) // <-- 新增
    }))
  }

  /**
   * [新增] 功能 6: 富豪榜变动
   * 比较今天和昨天的富豪榜
   */
  async getWhaleChanges(dateString?: string) {
    let todaySnaps: (AddressSnapshot & { tags?: { name: string; type: string; description: string; sortOrder: number }[] })[] = []

    let today = new Date()
    if (dateString) {
      today = new Date(dateString)
      today.setUTCHours(0, 0, 0, 0)
      const snaps = await this.prisma.addressSnapshot.findMany({
        where: { date: today, rank: { lte: 100 } },
        orderBy: { rank: 'asc' }
      })

      const tags = await this.prisma.addressTag.findMany({
        where: { address: { in: snaps.map((s) => s.address) }, status: 1 }
      })

      // 组装 tags
      const tagsMap = new Map<string, { name: string; type: string; description: string; sortOrder: number }[]>()
      tags.forEach((tag) => {
        if (!tagsMap.has(tag.address)) {
          tagsMap.set(tag.address, [])
        }
        tagsMap.get(tag.address)?.push({
          name: tag.name,
          type: tag.type,
          description: tag.description || '',
          sortOrder: tag.sortOrder
        })
      })

      todaySnaps = snaps.map((snap) => ({
        ...snap,
        tags: tagsMap.get(snap.address) || []
      }))
    } else {
      const topHolders = await this.prisma.address.findMany({
        orderBy: { balance: 'desc' },
        take: 100,
        select: { address: true, balance: true, tags: { where: { status: 1 } } }
      })
      const snapshotData = topHolders.map((holder, index) => ({
        id: holder.address,
        address: holder.address,
        balance: holder.balance,
        rank: index + 1, // 排名
        date: today,
        tags: holder.tags.map((tag) => ({
          name: tag.name,
          type: tag.type,
          description: tag.description || '',
          sortOrder: tag.sortOrder
        }))
      }))
      todaySnaps = snapshotData
    }

    if (todaySnaps.length === 0) {
      return []
    }

    const yesterday = new Date(today)
    yesterday.setUTCDate(today.getUTCDate() - 1)

    // 2. 获取昨天的 Top 100 快照 (用于对比)
    const yesterdaySnaps = await this.prisma.addressSnapshot.findMany({
      where: { date: yesterday, rank: { lte: 100 } }
    })
    // 将昨天的快照转为 Map，方便快速查找
    const yesterdayMap = new Map(yesterdaySnaps.map((s) => [s.address, s]))

    // 3. 比较数据
    const changes = todaySnaps.map((todaySnap) => {
      const yesterdaySnap = yesterdayMap.get(todaySnap.address)

      const rankChange = yesterdaySnap
        ? yesterdaySnap.rank - todaySnap.rank // 排名上升为正
        : null // 昨天不在榜内

      const balanceChange = yesterdaySnap
        ? todaySnap.balance - yesterdaySnap.balance // 余额增加为正
        : null

      return {
        address: todaySnap.address,
        currentRank: todaySnap.rank,
        currentBalance: todaySnap.balance,
        rankChange: rankChange, // null, 正数 (上升), 负数 (下降)
        balanceChange: balanceChange, // null, 正数 (增加), 负数 (减少)
        tags: todaySnap.tags
      }
    })

    return changes
  }

  /**
   * [新增] 获取矿工统计数据 (用于饼图)
   * @param blocks 统计最近的 X 个区块
   */
  async getMinerStats(blocks: number = 1000) {
    // 1. 使用 groupBy 高效查询
    const minerStats = await this.prisma.block.groupBy({
      by: ['minerAddress'],
      where: {
        minerAddress: { not: null }, // 过滤掉未知的
        height: {
          // 找到最高的区块，然后减去 'blocks'
          gt:
            (await this.prisma.block.findFirst({
              orderBy: { height: 'desc' },
              select: { height: true }
            }))!.height - blocks
        }
      },
      _count: {
        minerAddress: true
      },
      orderBy: {
        _count: {
          minerAddress: 'desc'
        }
      }
    })

    const totalBlocks = minerStats.reduce((sum, s) => sum + s._count.minerAddress, 0)

    // 查询所有矿工地址的标签
    const minerAddresses = minerStats.map((s) => s.minerAddress).filter(Boolean) as string[]
    const tags = await this.prisma.addressTag.findMany({
      where: {
        address: { in: minerAddresses },
        status: 1
      },
      orderBy: { sortOrder: 'desc' },
      select: { address: true, name: true }
    })

    // 构建地址 → 标签名映射（取排序最高的标签）
    const tagMap = new Map<string, string>()
    for (const tag of tags) {
      if (!tagMap.has(tag.address)) {
        tagMap.set(tag.address, tag.name)
      }
    }

    // 2. 格式化数据
    return {
      totalBlocksScanned: totalBlocks,
      minerDistribution: minerStats.map((s) => ({
        address: s.minerAddress,
        blocksMined: s._count.minerAddress,
        percentage: (s._count.minerAddress / totalBlocks) * 100,
        tag: tagMap.get(s.minerAddress!) || null
      }))
    }
  }

  /**
   * [新增] 获取当前价格
   * @returns
   */
  async getPrice() {
    // 1. 从数据库中获取最新价格
    const latestPrice = await this.prisma.price.findFirst({
      orderBy: { timestamp: 'desc' }
    })

    if (!latestPrice) {
      return {
        price: new Decimal(0),
        timestamp: new Date(),
        change24h: new Decimal(0),
        changePercent24h: new Decimal(0),
        change30d: new Decimal(0),
        changePercent30d: new Decimal(0)
      }
    }

    // 2. 获取24小时前的价格
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const price24hAgo = await this.prisma.price.findFirst({
      where: {
        timestamp: {
          lte: oneDayAgo
        }
      },
      orderBy: { timestamp: 'desc' }
    })

    // 获取7天前的价格
    const weekDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const price7dAgo = await this.prisma.price.findFirst({
      where: {
        timestamp: {
          lte: weekDaysAgo
        }
      },
      orderBy: { timestamp: 'desc' }
    })

    // 3. 获取30天前的价格
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const price30dAgo = await this.prisma.price.findFirst({
      where: {
        timestamp: {
          lte: thirtyDaysAgo
        }
      },
      orderBy: { timestamp: 'desc' }
    })

    // 4. 计算涨幅
    let change24h = new Decimal(0)
    let changePercent24h = new Decimal(0)
    if (price24hAgo) {
      change24h = latestPrice.price.sub(price24hAgo.price)
      changePercent24h = change24h.div(price24hAgo.price).times(100)
    }

    let change7d = new Decimal(0)
    let changePercent7d = new Decimal(0)
    if (price7dAgo) {
      change7d = latestPrice.price.sub(price7dAgo.price)
      changePercent7d = change7d.div(price7dAgo.price).times(100)
    }

    let change30d = new Decimal(0)
    let changePercent30d = new Decimal(0)
    if (price30dAgo) {
      change30d = latestPrice.price.sub(price30dAgo.price)
      changePercent30d = change30d.div(price30dAgo.price).times(100)
    }

    return {
      price: latestPrice.price,
      timestamp: latestPrice.timestamp,
      change24h: change24h,
      changePercent24h: changePercent24h,
      change7d: change7d,
      changePercent7d: changePercent7d,
      change30d: change30d,
      changePercent30d: changePercent30d
    }
  }

  /**
   * [新增] 获取价格图表数据,可以传入查询参数days,默认7天
   * @param days 要查询的天数
   * @returns
   */
  async getPriceChart(days: number = 7) {
    const thirtyDaysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    // 1. 从数据库中获取价格数据
    const priceData = await this.prisma.price.findMany({
      where: {
        timestamp: {
          gte: thirtyDaysAgo
        }
      },
      orderBy: {
        timestamp: 'asc'
      }
    })

    if (!priceData.length) {
      return []
    }

    // 2. 格式化数据
    return priceData.map((p) => ({
      timestamp: p.timestamp,
      price: p.price
    }))
  }

  /**
   * [新增] 获取不活跃地址统计
   * 统计各个独立时间段内不活跃的地址数量和金额（不重复计算）
   */
  async getInactiveAddresses() {
    const now = new Date()

    // 计算各个时间点
    const twoYearsAgo = new Date(now.getTime() - 2 * 365 * 24 * 60 * 60 * 1000)
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
    const sixMonthsAgo = new Date(now.getTime() - 6 * 30 * 24 * 60 * 60 * 1000)
    const threeMonthsAgo = new Date(now.getTime() - 3 * 30 * 24 * 60 * 60 * 1000)
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    // 并行查询各个独立时间段的不活跃地址数量和金额
    const [inactive2Years, inactive1Year, inactive6Months, inactive3Months, inactive1Month, totalStats] = await Promise.all([
      // 超过2年未活跃的地址
      this.prisma.address.aggregate({
        where: {
          lastActive: {
            lt: twoYearsAgo
          },
          balance: {
            gt: BigInt(0)
          },
          isDapCreated: false
        },
        _count: true,
        _sum: {
          balance: true
        }
      }),
      // 1年到2年之间未活跃的地址
      this.prisma.address.aggregate({
        where: {
          lastActive: {
            gte: twoYearsAgo,
            lt: oneYearAgo
          },
          balance: {
            gt: BigInt(0)
          },
          isDapCreated: false
        },
        _count: true,
        _sum: {
          balance: true
        }
      }),
      // 6个月到1年之间未活跃的地址
      this.prisma.address.aggregate({
        where: {
          lastActive: {
            gte: oneYearAgo,
            lt: sixMonthsAgo
          },
          balance: {
            gt: BigInt(0)
          },
          isDapCreated: false
        },
        _count: true,
        _sum: {
          balance: true
        }
      }),
      // 3个月到6个月之间未活跃的地址
      this.prisma.address.aggregate({
        where: {
          lastActive: {
            gte: sixMonthsAgo,
            lt: threeMonthsAgo
          },
          balance: {
            gt: BigInt(0)
          },
          isDapCreated: false
        },
        _count: true,
        _sum: {
          balance: true
        }
      }),
      // 1个月到3个月之间未活跃的地址
      this.prisma.address.aggregate({
        where: {
          lastActive: {
            gte: threeMonthsAgo,
            lt: oneMonthAgo
          },
          balance: {
            gt: BigInt(0)
          },
          isDapCreated: false
        },
        _count: true,
        _sum: {
          balance: true
        }
      }),
      // 获取总地址数量和总余额用于计算百分比
      this.prisma.address.aggregate({
        _count: true,
        _sum: {
          balance: true
        },
        where: {
          balance: {
            gt: BigInt(0)
          },
          isDapCreated: false
        }
      })
    ])

    const totalAddresses = totalStats._count
    const totalBalance = totalStats._sum.balance || BigInt(0)

    return {
      totalAddresses,
      totalBalance: totalBalance.toString(),
      inactiveAddresses: {
        twoYears: {
          count: inactive2Years._count,
          balance: (inactive2Years._sum.balance || BigInt(0)).toString(),
          description: '超过2年未活跃'
        },
        oneYear: {
          count: inactive1Year._count,
          balance: (inactive1Year._sum.balance || BigInt(0)).toString(),
          description: '1年-2年未活跃'
        },
        sixMonths: {
          count: inactive6Months._count,
          balance: (inactive6Months._sum.balance || BigInt(0)).toString(),
          description: '6个月-1年未活跃'
        },
        threeMonths: {
          count: inactive3Months._count,
          balance: (inactive3Months._sum.balance || BigInt(0)).toString(),
          description: '3个月-6个月未活跃'
        },
        oneMonth: {
          count: inactive1Month._count,
          balance: (inactive1Month._sum.balance || BigInt(0)).toString(),
          description: '1个月-3个月未活跃'
        }
      }
    }
  }

  /**
   * 查询指定时间段内不活跃的地址列表
   * @param period 不活跃时间段 (2years|1year|6months|3months|1month)
   * @param type 地址类型 (address|balance)
   * @param page 页码
   * @param pageSize 每页数量
   * @returns
   */
  async getInactiveAddressList(period: string, type: string, page: number = 1, pageSize: number = 20) {
    const now = new Date()

    // 计算各个时间点
    const twoYearsAgo = new Date(now.getTime() - 2 * 365 * 24 * 60 * 60 * 1000)
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
    const sixMonthsAgo = new Date(now.getTime() - 6 * 30 * 24 * 60 * 60 * 1000)
    const threeMonthsAgo = new Date(now.getTime() - 3 * 30 * 24 * 60 * 60 * 1000)
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    // 定义时间段映射（与 getInactiveAddresses 保持一致）
    const periodMap = {
      '2year': {
        whereCondition: { lastActive: { lt: twoYearsAgo } },
        description: '超过2年未活跃'
      },
      '1year': {
        whereCondition: { lastActive: { gte: twoYearsAgo, lt: oneYearAgo } },
        description: '1年-2年未活跃'
      },
      '6months': {
        whereCondition: { lastActive: { gte: oneYearAgo, lt: sixMonthsAgo } },
        description: '6个月-1年未活跃'
      },
      '3months': {
        whereCondition: { lastActive: { gte: sixMonthsAgo, lt: threeMonthsAgo } },
        description: '3个月-6个月未活跃'
      },
      '1month': {
        whereCondition: { lastActive: { gte: threeMonthsAgo, lt: oneMonthAgo } },
        description: '1个月-3个月未活跃'
      }
    }

    let periodConfig = periodMap[period]
    if (!periodConfig) {
      periodConfig = {
        whereCondition: { lastActive: { gte: oneMonthAgo } },
        description: '活跃地址'
      }
    }

    const skip = (page - 1) * pageSize

    let orderBy: any = {
      lastActive: 'asc'
    }

    if (type === 'balance') {
      orderBy = {
        balance: 'desc'
      }
    }

    // 查询地址列表
    const addresses = await this.prisma.address.findMany({
      where: {
        balance: {
          gt: BigInt(0)
        },
        ...periodConfig.whereCondition,
        isDapCreated: false
      },
      select: {
        address: true,
        balance: true,
        lastActive: true,
        txCount: true,
        received: true,
        sent: true
      },
      orderBy: orderBy,
      skip,
      take: pageSize
    })

    // 查询总数和总余额
    const summary = await this.prisma.address.aggregate({
      where: {
        balance: {
          gt: BigInt(0)
        },
        ...periodConfig.whereCondition,
        isDapCreated: false
      },
      _count: true,
      _sum: {
        balance: true
      }
    })

    // 计算不活跃天数
    const addressesWithInactiveDays = addresses.map((addr) => {
      const inactiveDays = Math.floor((now.getTime() - addr.lastActive.getTime()) / (24 * 60 * 60 * 1000))
      return {
        ...addr,
        balance: addr.balance.toString(),
        received: addr.received.toString(),
        sent: addr.sent.toString(),
        inactiveDays
      }
    })

    return {
      addresses: addressesWithInactiveDays,
      pagination: {
        page,
        pageSize,
        total: summary._count,
        totalPages: Math.ceil(summary._count / pageSize)
      },
      summary: {
        totalAddresses: summary._count,
        totalBalance: summary._sum.balance?.toString() || '0',
        period,
        description: periodConfig.description
      }
    }
  }

  /**
   * 查询最新的统计数据相对于上一个统计数据的变化
   */
  async getDailyStatsChange() {
    // 1. 查询最新的统计数据
    const latestStats = await this.prisma.dailyStats.findFirst({
      orderBy: {
        date: 'desc'
      }
    })

    if (!latestStats) {
      return {
        totalBlocks: 0,
        totalTxs: 0,
        totalVolume: new Decimal(0),
        addrCount: 0,
        totalAddrCount: 0,
        totalMarketCap: new Decimal(0),
        latestStatsTotalMarketCap: new Decimal(0),
        change: {
          totalBlocks: 0,
          totalTxs: 0,
          totalVolume: new Decimal(0),
          addrCount: 0,
          latestStatsTotalMarketCap: new Decimal(0)
        }
      }
    }

    // 2. 查询上一个统计数据
    let previousStats = await this.prisma.dailyStats.findFirst({
      where: {
        date: {
          lt: latestStats.date
        }
      },
      orderBy: {
        date: 'desc'
      }
    })

    if (!previousStats) {
      previousStats = {
        id: '',
        date: new Date(),
        totalBlocks: 0,
        totalTxs: 0,
        totalVolume: new Decimal(0),
        addrCount: 0,
        totalMarketCap: new Decimal(0)
      }
    }

    // 3. 计算变化
    const change = {
      totalBlocks: latestStats.totalBlocks - previousStats.totalBlocks,
      totalTxs: latestStats.totalTxs - previousStats.totalTxs,
      totalVolume: new Decimal(latestStats.totalVolume).minus(previousStats.totalVolume),
      addrCount: latestStats.addrCount - previousStats.addrCount,
      latestStatsTotalMarketCap: latestStats.totalMarketCap
    }
    // 查询出总区块数、总交易数、总钱包数、市值
    const totalBlocks = await this.prisma.block.count()
    const totalTxs = await this.prisma.transaction.count()
    const totalVolumePrisma = await this.prisma.transactionIO.aggregate({
      where: {
        amount: {
          gt: 0 // 只统计输出（正数）
        }
      },
      _sum: {
        amount: true
      }
    })
    const totalAddrCount = await this.prisma.address.count()
    const latestPrice = await this.prisma.price.findFirst({
      orderBy: {
        timestamp: 'desc'
      }
    })

    // 4. 计算总市值（如果有价格数据）
    let totalMarketCap: Decimal = new Decimal(0)
    if (latestPrice) {
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

    return {
      totalBlocks,
      totalTxs,
      totalAddrCount,
      totalVolume: totalVolumePrisma._sum.amount?.toString() || '0',
      totalMarketCap: totalMarketCap.toFixed(2),
      latestStatsTotalMarketCap: change.latestStatsTotalMarketCap.toFixed(2),
      change: {
        totalBlocks: change.totalBlocks,
        totalTxs: change.totalTxs,
        totalVolume: change.totalVolume.toFixed(2),
        addrCount: change.addrCount
      }
    }
  }

  // 获取地址余额分布统计（用于饼图）
  async getBalanceDistribution() {
    try {
      // 定义金额区间（以BTC为单位）
      const ranges = [
        { name: '< 100', min: 0, max: 100, minSatoshis: 1, maxSatoshis: btcToSatoshisNumber(100) },
        { name: '100 - 500', min: 100, max: 500, minSatoshis: btcToSatoshisNumber(100), maxSatoshis: btcToSatoshisNumber(500) },
        { name: '500 - 1000', min: 500, max: 1000, minSatoshis: btcToSatoshisNumber(500), maxSatoshis: btcToSatoshisNumber(1000) },
        { name: '1000 - 5000', min: 1000, max: 5000, minSatoshis: btcToSatoshisNumber(1000), maxSatoshis: btcToSatoshisNumber(5000) },
        { name: '5000 - 10000', min: 5000, max: 10000, minSatoshis: btcToSatoshisNumber(5000), maxSatoshis: btcToSatoshisNumber(10000) },
        { name: '10000 - 50000', min: 10000, max: 50000, minSatoshis: btcToSatoshisNumber(10000), maxSatoshis: btcToSatoshisNumber(50000) },
        {
          name: '50000 - 100000',
          min: 50000,
          max: 100000,
          minSatoshis: btcToSatoshisNumber(50000),
          maxSatoshis: btcToSatoshisNumber(100000)
        },
        { name: '> 100000', min: 100000, max: null, minSatoshis: btcToSatoshisNumber(100000), maxSatoshis: null }
      ]

      // 获取总地址数（排除0余额）
      const totalAddresses = await this.prisma.address.count({
        where: {
          balance: {
            gt: 0
          },
          isDapCreated: false
        }
      })

      // 并行查询各个区间的地址数量
      const distributionPromises = ranges.map(async (range) => {
        const whereCondition: any = {
          balance: {
            gt: 0 // 排除0金额
          }
        }

        if (range.maxSatoshis === null) {
          // 最大区间：> 1000000
          whereCondition.balance.gte = range.minSatoshis
        } else {
          // 其他区间
          whereCondition.balance.gte = range.minSatoshis
          whereCondition.balance.lt = range.maxSatoshis
        }

        // 添加 isDapCreated: false 条件
        whereCondition.isDapCreated = false

        const count = await this.prisma.address.count({
          where: whereCondition
        })

        return {
          range: range.name,
          count,
          percentage: totalAddresses > 0 ? ((count / totalAddresses) * 100).toFixed(2) : '0.00'
        }
      })

      const distribution = await Promise.all(distributionPromises)

      return {
        totalAddresses,
        distribution
      }
    } catch (error) {
      this.logger.error('获取余额分布统计失败:', error)
      throw error
    }
  }

  // 获取地址排名金额占比统计（用于饼图）
  async getAddressRankingDistribution() {
    try {
      // 定义排名区间
      const rankRanges = [
        { name: 'Top 1-10', start: 1, end: 10 },
        { name: 'Top 11-20', start: 11, end: 20 },
        { name: 'Top 21-50', start: 21, end: 50 },
        { name: 'Top 51-100', start: 51, end: 100 },
        { name: 'Top 101-1000', start: 101, end: 1000 },
        { name: 'Others (1000+)', start: 1001, end: null }
      ]

      // 获取总余额（排除0余额）
      const totalBalanceResult = await this.prisma.address.aggregate({
        _sum: {
          balance: true
        },
        where: {
          balance: {
            gt: 0
          },
          isDapCreated: false
        }
      })

      const totalBalance = totalBalanceResult._sum.balance || BigInt(0)

      // 获取按余额排序的地址（分页获取前1000个）
      const topAddresses = await this.prisma.address.findMany({
        where: {
          balance: {
            gt: 0
          },
          isDapCreated: false
        },
        orderBy: {
          balance: 'desc'
        },
        take: 1000,
        select: {
          balance: true
        }
      })

      // 计算各排名区间的金额占比
      const distribution = rankRanges.map((range) => {
        let rangeBalance = BigInt(0)
        let count = 0

        if (range.end === null) {
          // Others (1000+) - 计算剩余部分
          const top1000Balance = topAddresses.reduce((sum, addr) => sum + addr.balance, BigInt(0))
          rangeBalance = totalBalance - top1000Balance
          // 获取总地址数减去前1000个
          count = -1 // 标记为其他地址，不显示具体数量
        } else {
          // 计算指定排名区间的余额
          for (let i = range.start - 1; i < Math.min(range.end, topAddresses.length); i++) {
            if (topAddresses[i]) {
              rangeBalance += topAddresses[i].balance
              count++
            }
          }
        }

        const percentage = totalBalance > 0 ? ((Number(rangeBalance) / Number(totalBalance)) * 100).toFixed(2) : '0.00'

        return {
          range: range.name,
          balance: satoshisToBtc(rangeBalance),
          balanceSatoshis: rangeBalance.toString(),
          count: count === -1 ? 'Others' : count,
          percentage
        }
      })

      return {
        totalBalance: satoshisToBtc(totalBalance),
        totalBalanceSatoshis: totalBalance.toString(),
        distribution
      }
    } catch (error) {
      this.logger.error('获取地址排名分布统计失败:', error)
      throw error
    }
  }

  // 添加地址标签
  async addAddressTag(payload: { address: string; name: string; type: string; description?: string }) {
    const { address, name, type, description } = payload

    if (!address || !name || !type) {
      throw new Error('address, name, type are required')
    }

    // 检查地址是否存在
    const addr = await this.prisma.address.findUnique({ where: { address } })
    if (!addr) {
      throw new NotFoundException(`Address ${address} not found`)
    }
    if (addr.isDapCreated) {
      throw new NotFoundException('DAP addresses cannot be tagged')
    }

    // 创建新标签（默认启用）
    const created = await this.prisma.addressTag.create({
      data: {
        address,
        name,
        type,
        description
      }
    })
    return created
  }

  // 获取内存池中的交易数据
  async getMempoolTransactions(page: number, pageSize: number) {
    const skip = (page - 1) * pageSize
    const transactions = await this.prisma.mempoolTransaction.findMany({
      skip,
      take: pageSize,
      orderBy: {
        timestamp: 'desc'
      }
    })

    const total = await this.prisma.mempoolTransaction.count()
    const totalPages = Math.ceil(total / pageSize)
    const processedTransactions = await this.processTransactionData(transactions)
    return {
      list: processedTransactions,
      pagination: {
        total: total,
        totalPages: totalPages,
        currentPage: page,
        pageSize: pageSize
      }
    }
  }
}
