import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { DapData } from '@prisma/client'
import { btcToSatoshis } from 'src/utils/currency.utils'
import ScashDAPModule from 'scash-dap'
import { getArrFeeAddress, getScashNetwork } from 'src/utils/const'

@Injectable()
export class DapService {
  private readonly logger = new Logger(DapService.name)
  private dap: ScashDAPModule

  constructor(private readonly prisma: PrismaService) {
    if (ScashDAPModule) {
      const network = getScashNetwork()
      try {
        this.dap = new ScashDAPModule(network)
        this.logger.log('DapService initialized with scash-dap')
      } catch (e) {
        this.logger.error('Failed to initialize scash-dap:', e.message)
      }
    } else {
      this.logger.warn('scash-dap module not loaded')
    }
  }

  isAvailable(): boolean {
    return this.dap !== null
  }

  isDapAddress(address: string): boolean {
    if (!this.dap) return false
    return this.dap.isScashDAPAddress(address)
  }

  parseDapData(vouts: any[], inputAddress: string[]): DapParseResult | null {
    if (!this.dap || vouts.length === 0) return null
    const appFeeAddress = getArrFeeAddress()
    const appFee = vouts
      .filter((vout) => vout.scriptPubKey?.address === appFeeAddress)
      .reduce((sum, vout) => sum + btcToSatoshis(vout.value), 0n)

    const dapOutputs = vouts.filter((vout) => {
      const address = vout.scriptPubKey?.address
      return address && this.dap!.isScashDAPAddress(address)
    })

    if (dapOutputs.length === 0) return null

    // 当前输出地址中排除dap地址和手续费地址后，如果还有别的地址就是一个转账留言的dap
    const isMessageDap =
      vouts.find((vout) => {
        const address = vout.scriptPubKey?.address
        if (!address || address === appFeeAddress) return false
        if (inputAddress.includes(address)) return false
        return !this.dap!.isScashDAPAddress(address)
      }) !== undefined
    const content = this.dap.parseDapTransaction(dapOutputs)
    if (!content) return null
    const magicHeader = dapOutputs.length > 0 ? this.getMagicHeader(dapOutputs[0].scriptPubKey.address) : ''
    const chunkCount = dapOutputs.length
    const totalOutputValue = dapOutputs.reduce((sum, vout) => sum + btcToSatoshis(vout.value), 0n)

    return {
      content,
      magicHeader,
      chunkCount,
      totalFee: appFee,
      totalOutputValue,
      isMessageDap
    }
  }

  private getMagicHeader(address: string): string {
    if (!this.dap) return ''
    const hash = this.dap.decodeScashAddressToHash(address)
    if (!hash || hash.length < 4) return ''
    return '0x' + hash.subarray(0, 4).toString('hex').toUpperCase()
  }

  async saveDapData(txid: string, blockHeight: number, address: string, timestamp: Date, parseResult: DapParseResult): Promise<DapData> {
    return this.prisma.dapData.create({
      data: {
        txid,
        blockHeight,
        address,
        magicHeader: parseResult.magicHeader,
        dataContent: parseResult.content,
        chunkCount: parseResult.chunkCount,
        totalFee: parseResult.totalFee,
        isMessageDap: parseResult.isMessageDap,
        totalOutputValue: parseResult.totalOutputValue,
        sortOrder: 1,
        timestamp
      }
    })
  }

  async processTransactionDap(txid: string, blockHeight: number, timestamp: Date, vouts: any[], inputAddress: string[]): Promise<number> {
    if (!this.dap) return 0

    const dapParseResult = this.parseDapData(vouts, inputAddress)
    if (!dapParseResult) return 0

    const dapAddresses = vouts.map((vout) => vout.scriptPubKey.address)
    const uniqueAddresses = [...new Set(dapAddresses)]

    if (uniqueAddresses.length > 0) {
      // 判断是否已经存在
      const existing = await this.prisma.dapData.findFirst({
        where: {
          txid
        }
      })
      if (existing) return 0

      await this.saveDapData(txid, blockHeight, uniqueAddresses[0], timestamp, dapParseResult)
      await this.updateDailyStats(
        timestamp,
        dapParseResult.totalOutputValue,
        uniqueAddresses.filter((addr) => this.dap.isScashDAPAddress(addr)).length
      )
      return uniqueAddresses.length
    }

    return 0
  }

  private async updateDailyStats(date: Date, fee: bigint, addrCount: number) {
    const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))

    await this.prisma.dapStatsDate.upsert({
      where: { date: day },
      update: {
        totalAmount: { increment: fee },
        totalAddrs: { increment: addrCount },
        totalTxs: { increment: 1 }
      },
      create: {
        date: day,
        totalAmount: fee,
        totalAddrs: addrCount,
        totalTxs: 1
      }
    })
  }
}

export interface DapParseResult {
  content: string
  magicHeader: string
  chunkCount: number
  totalFee: bigint
  totalOutputValue: bigint
  isMessageDap: boolean
}
