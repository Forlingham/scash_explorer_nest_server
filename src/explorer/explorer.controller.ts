// src/explorer/explorer.controller.ts
import { Controller, Get, Param, ParseIntPipe, Query, Logger, Post, Body } from '@nestjs/common'
import { ExplorerService } from './explorer.service'
import { CacheService } from 'src/common/services/cache.service'

@Controller('explorer') // 所有路由都带 /api 前缀
export class ExplorerController {
  private readonly logger = new Logger(ExplorerController.name) // 添加日志

  constructor(
    private readonly explorerService: ExplorerService,
    private readonly cacheService: CacheService
  ) {}

  /**
   * 获取近7天交易数量按天统计（折线图数据）
   * @returns
   */
  @Get('stats/chart/transactions-7days')
  getTransactionStatsLast7Days() {
    this.logger.log('Request received for /stats/chart/transactions-7days')
    return this.cacheService.getOrSet('transactions-7days', () => this.explorerService.getTransactionStatsLast7Days(), 60)
  }

  /**
   * 获取网络hash每小时统计（折线图数据）
   * @param hours 要查询的小时数，默认24小时
   * @returns
   */
  @Get('stats/chart/network-hash')
  getNetworkHashStatsHourly(@Query('hours', new ParseIntPipe({ optional: true })) hours?: number) {
    hours = hours || 24
    this.logger.log(`Request received for /stats/chart/network-hash?hours=${hours}`)
    return this.cacheService.getOrSet(`network-hash-${hours}`, () => this.explorerService.getNetworkHashStatsHourly(hours), 60)
  }

  /**
   * 获取网络难度每小时统计（折线图数据）
   * @param hours 要查询的小时数，默认24小时
   * @returns
   */
  @Get('stats/chart/network-difficulty')
  getNetworkDifficultyStatsHourly(@Query('hours', new ParseIntPipe({ optional: true })) hours?: number) {
    hours = hours || 24
    this.logger.log(`Request received for /stats/chart/network-difficulty?hours=${hours}`)
    return this.cacheService.getOrSet(`network-difficulty-${hours}`, () => this.explorerService.getNetworkDifficultyStatsHourly(hours), 60)
  }

  /**
   * 获取近N个区块挖矿获得者地址分布（饼图数据）
   * @param blockCount 要统计的区块数量，默认1000
   * @returns
   */
  @Get('stats/chart/miner-distribution')
  getMinerDistributionStats(@Query('blockCount', new ParseIntPipe({ optional: true })) blockCount?: number) {
    blockCount = blockCount || 1000
    this.logger.log(`Request received for /stats/chart/miner-distribution?blockCount=${blockCount}`)
    return this.cacheService.getOrSet(
      `miner-distribution-${blockCount}`,
      () => this.explorerService.getMinerDistributionStats(blockCount),
      60
    )
  }

  /**
   * 获取区块列表
   * @param page 页码
   * @param pageSize 每页数量
   * @returns
   */
  @Get('blocks')
  getBlocks(
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize?: number
  ) {
    page = page || 1
    pageSize = pageSize || 20
    this.logger.log(`Request received for blocks?page=${page}&pageSize=${pageSize}`)
    return this.explorerService.blocks(page, pageSize)
  }

  /**
   * 使用区块高度或者hash查询区块详情
   * @param heightOrHash 区块高度或哈希值
   * @returns
   */
  @Get('block-detail/:heightOrHash')
  getBlockDetail(@Param('heightOrHash') heightOrHash: string) {
    this.logger.log(`Request received for block-detail/${heightOrHash}`)
    return this.explorerService.blockDetail(heightOrHash)
  }

  /**
   * 查询地址详情
   * @param address 地址
   * @returns
   */
  @Get('address-detail/:address')
  getAddressDetail(@Param('address') address: string) {
    this.logger.log(`Request received for address-detail/${address}`)
    return this.explorerService.getAddressDetail(address)
  }

  /**
   * 查询地址下的交易列表
   * @param address 地址
   * @param page 页码
   * @returns
   */
  @Get('address/:address/txs')
  getAddressTransactions(
    @Param('address') address: string,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize?: number
  ) {
    this.logger.log(`Request received for address/${address}/txs?page=${page || 1}&pageSize=${pageSize || 20}`)
    return this.explorerService.getAddressTransactions(address, page || 1, pageSize || 20)
  }

  /**
   * 使用区块高度，查询出当前区块中的交易列表，包含所有详情
   * @param height 区块高度
   * @returns
   */
  @Get('block-transactions/:height')
  getTransactionsByHeight(
    @Param('height', new ParseIntPipe()) height: number,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize?: number
  ) {
    this.logger.log(`Request received for block-transactions/${height}?page=${page || 1}&pageSize=${pageSize || 20}`)
    return this.explorerService.getBlockTransactions(height, page || 1, pageSize || 20)
  }

  /**
   * 使用区块高度查询当前区块全部交易的大小和手续费
   * @param height 区块高度
   * @returns
   */
  @Get('block-transactions-visualization/:height')
  getBlockTransactionVisualization(@Param('height', new ParseIntPipe()) height: number) {
    this.logger.log(`Request received for block-transactions-visualization/${height}`)
    return this.explorerService.getBlockTransactionVisualization(height)
  }

  /**
   * 获取交易列表
   * @param page 页码
   * @param pageSize 每页数量
   * @returns
   */
  @Get('transactions')
  getTransactions(
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize?: number
  ) {
    this.logger.log(`Request received for transactions?page=${page || 1}&pageSize=${pageSize || 20}`)
    return this.explorerService.transactions(page || 1, pageSize || 20)
  }

  /**
   * 获取钱包统计信息(活跃/不活跃)
   * @returns
   */
  @Get('stats/wallets')
  getWalletStats() {
    this.logger.log('Request received for stats/wallets')
    return this.cacheService.getOrSet('wallet-stats', () => this.explorerService.getWalletStats(), 60)
  }

  /**
   * 获取前100名持币者
   * @returns
   */
  @Get('top-holders')
  getTopHolders() {
    this.logger.log('Request received for top-holders')
    return this.cacheService.getOrSet('top-holders', () => this.explorerService.getTopHolders(), 60)
  }

  /**
   * 获取内存池中的交易
   * @returns
   */
  @Get('mempool')
  getMempool() {
    this.logger.log('Request received for mempool')
    return this.explorerService.getMempool()
  }

  /**
   * 获取块信息
   * @param heightOrHash 块高或哈希值
   * @returns
   */
  @Get('block/:heightOrHash')
  getBlock(@Param('heightOrHash') heightOrHash: string) {
    this.logger.log(`Request received for block/${heightOrHash}`)
    return this.explorerService.getBlock(heightOrHash)
  }

  /**
   * 获取交易信息
   * @param txid 交易ID
   * @returns
   */
  @Get('tx/:txid')
  getTransaction(@Param('txid') txid: string) {
    this.logger.log(`Request received for tx/${txid}`)
    return this.explorerService.getTransaction(txid)
  }

  /**
   * 获取地址信息
   * @param address 地址
   * @returns
   */
  @Get('address/:address')
  getAddressInfo(@Param('address') address: string) {
    this.logger.log(`Request received for address/${address}`)
    return this.explorerService.getAddressInfo(address)
  }

  /**
   * 获取地址的交易图表数据
   * @param address 地址
   * @returns
   */
  @Get('address/:address/graph')
  getAddressGraph(@Param('address') address: string) {
    this.logger.log(`Request received for address/${address}/graph`)
    return this.explorerService.getAddressGraph(address)
  }

  /**
   * 获取交易费用估计
   * @param target 目标确认数
   * @returns
   */
  @Get('fee-estimate')
  getFeeEstimate(@Query('target', new ParseIntPipe({ optional: true })) target?: number) {
    target = target || 6
    this.logger.log(`Request received for /fee-estimate?target=${target}`)
    return this.cacheService.getOrSet(`fee-estimate-${target}`, () => this.explorerService.getFeeEstimate(target), 60)
  }

  /**
   * 获取块统计信息 (用于图表)
   * @param days 要查询的天数
   * @returns
   */
  @Get('stats/chart/blocks')
  getBlockStatsForChart(@Query('days', new ParseIntPipe({ optional: true })) days?: number) {
    days = days || 30
    this.logger.log(`Request received for /stats/chart/blocks?days=${days}`)
    return this.cacheService.getOrSet(`block-stats-for-chart-${days}`, () => this.explorerService.getBlockStatsForChart(days), 60)
  }

  /**
   * 获取矿工统计信息(用于饼图)
   * @param blocks 要查询的块数
   * @returns
   */
  @Get('stats/miners')
  getMinerStats(@Query('blocks', new ParseIntPipe({ optional: true })) blocks?: number) {
    blocks = blocks || 1000
    this.logger.log(`Request received for /stats/miners?blocks=${blocks}`)
    return this.cacheService.getOrSet(`miner-stats-${blocks}`, () => this.explorerService.getMinerStats(blocks), 60)
  }

  /**
   * 获取富豪榜变动
   * @param date 日期,格式YYYY-MM-DD,默认今天
   * @returns
   */
  @Get('stats/whale-changes')
  getWhaleChanges(@Query('date') date?: string) {
    date = date || ''
    this.logger.log(`Request received for /stats/whale-changes?date=${date}`)
    return this.cacheService.getOrSet(`whale-changes-${date}`, () => this.explorerService.getWhaleChanges(date), 30)
  }

  /**
   * 获取当前价格
   * @returns
   */
  @Get('price')
  getPrice() {
    this.logger.log('Request received for /price')
    return this.cacheService.getOrSet('price', () => this.explorerService.getPrice(), 30)
  }

  /**
   * 获取价格图表数据,可以传入查询参数days,默认30天
   * @param days 要查询的天数
   * @returns
   */
  @Get('price/chart')
  getPriceChart(@Query('days', new ParseIntPipe({ optional: true })) days?: number) {
    days = days || 30
    this.logger.log(`Request received for /price/chart?days=${days}`)
    return this.cacheService.getOrSet(`price-chart-${days}`, () => this.explorerService.getPriceChart(days), 60)
  }

  /**
   *  不活跃地址统计
   * @returns
   */
  @Get('stats/inactive-addresses')
  getInactiveAddresses() {
    this.logger.log('Request received for /stats/inactive-addresses')
    return this.cacheService.getOrSet('inactive-addresses', () => this.explorerService.getInactiveAddresses(), 60)
  }

  /**
   * 查询指定时间段内不活跃的地址列表
   * @param period 不活跃时间段 (2year|1year|6months|3months|1month)
   * @param page 页码
   * @param pageSize 每页数量
   * @returns
   */
  @Get('inactive-addresses')
  getInactiveAddressList(
    @Query('period') period: string,
    @Query('type') type: string,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize?: number
  ) {
    type = type || 'address'
    page = page || 1
    pageSize = pageSize || 20

    this.logger.log(`Request received for /inactive-addresses?period=${period}&type=${type}&page=${page}&pageSize=${pageSize}`)
    return this.explorerService.getInactiveAddressList(period, type, page, pageSize)
  }

  /**
   * 获取每日统计信息变动
   * @returns
   */
  @Get('stats/daily-changes')
  getDailyStatsChange() {
    this.logger.log('Request received for /stats/daily-changes')
    return this.cacheService.getOrSet('daily-stats-change', () => this.explorerService.getDailyStatsChange(), 30)
  }

  /**
   * 获取地址余额分布统计（用于饼图）
   * @returns
   */
  @Get('stats/balance-distribution')
  getBalanceDistribution() {
    this.logger.log('Request received for stats/balance-distribution')
    return this.cacheService.getOrSet('balance-distribution', () => this.explorerService.getBalanceDistribution(), 60)
  }

  /**
   * 获取地址排名金额占比统计（用于饼图）
   * @returns
   */
  @Get('stats/ranking-distribution')
  getAddressRankingDistribution() {
    this.logger.log('Request received for stats/ranking-distribution')
    return this.cacheService.getOrSet('ranking-distribution', () => this.explorerService.getAddressRankingDistribution(), 60)
  }

  /**
   * 获取首页概览数据
   * @returns
   */
  @Get('home/overview')
  async getOverview() {
    this.logger.log('Request received for /home/overview')

    const cacheKey = 'home_overview'
    const cachedOverview = await this.cacheService.get(cacheKey)
    if (cachedOverview) {
      return cachedOverview
    }

    const dailyStatsChange = await this.explorerService.getDailyStatsChange()
    const feeEstimate1 = await this.explorerService.getFeeEstimate(1)
    const feeEstimate6 = await this.explorerService.getFeeEstimate(6)
    const feeEstimate144 = await this.explorerService.getFeeEstimate(144)
    const price = await this.explorerService.getPrice()
    const priceChart = await this.explorerService.getPriceChart()

    const res = {
      dailyStatsChange,
      feeEstimate1,
      feeEstimate6,
      feeEstimate144,
      price,
      priceChart
    }

    await this.cacheService.set(cacheKey, res, 60)

    return res
  }

  /**
   * 首页的图表数据
   */
  @Get('/home/chart')
  async getChartData() {
    this.logger.log('Request received for /home/chart')

    const cacheKey = 'home_chart'
    const cachedChartData = await this.cacheService.get(cacheKey)
    if (cachedChartData) {
      return cachedChartData
    }

    const transactionStatsLast7Days = await this.explorerService.getTransactionStatsLast7Days()
    const networkHashStatsHourly = await this.explorerService.getNetworkHashStatsHourly()
    const networkDifficultyStatsHourly = await this.explorerService.getNetworkDifficultyStatsHourly()
    const minerDistributionStats = await this.explorerService.getMinerDistributionStats()

    const res = {
      transactionStatsLast7Days,
      networkHashStatsHourly,
      networkDifficultyStatsHourly,
      minerDistributionStats
    }

    await this.cacheService.set(cacheKey, res, 60)

    return res
  }

  // 添加地址标签
  @Post('address/addTag')
  addAddressTag(
    @Body() body: { address: string; name: string; type: string; description?: string }
  ) {
    const { address, name, type, description } = body
    this.logger.log(`Request received for /address/tag address=${address} name=${name} type=${type}`)
    return this.explorerService.addAddressTag({ address, name, type, description })
  }
  
}
