import { Controller, Get, Param, Query, ParseIntPipe, Logger } from '@nestjs/common'
import { DapService } from './dap.service'
import { PrismaService } from '../prisma/prisma.service'

@Controller('dap')
export class DapController {
  private readonly logger = new Logger(DapController.name)

  constructor(
    private readonly dapService: DapService,
    private readonly prisma: PrismaService
  ) {}

  /**
   * 获取 DAP 数据列表（支持多条件查询）
   * @param address 地址筛选
   * @param txid 交易ID筛选
   * @param content 内容模糊搜索
   * @param page 页码
   * @param pageSize 每页数量
   * @param sortBy 排序字段 (sortOrder, blockHeight, timestamp, totalFee)
   * @param sortOrder 排序方向 (asc, desc)
   */
  @Get('list')
  async getDapList(
    @Query('address') address?: string,
    @Query('txid') txid?: string,
    @Query('content') content?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize?: number,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc'
  ) {
    page = page || 1
    pageSize = pageSize || 20
    sortBy = sortBy || 'blockHeight'
    sortOrder = sortOrder || 'desc'

    this.logger.log(`Request received for /dap/list address=${address} txid=${txid} content=${content} page=${page}`)

    const where: any = {}

    if (address) {
      where.address = address
    }

    if (txid) {
      where.txid = txid
    }

    if (content) {
      where.dataContent = {
        contains: content,
        mode: 'insensitive'
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.dapData.findMany({
        where,
        orderBy: {
          [sortBy]: sortOrder
        },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.dapData.count({ where })
    ])

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    }
  }

  /**
   * 获取单个 DAP 数据详情
   * @param id DAP 数据 ID
   */
  @Get(':id')
  async getDapById(@Param('id') id: string) {
    this.logger.log(`Request received for /dap/${id}`)
    return this.prisma.dapData.findUnique({
      where: { id }
    })
  }
}
