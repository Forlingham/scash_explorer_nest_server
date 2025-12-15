import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { transferService } from './transfer.service';

@Controller('transfer')
export class transferController {
  constructor(private readonly transferService: transferService) {}

  /**
   * 获取区块链信息
   */
  @Get('blockchain-info')
  async getBlockchainInfo() {
    return await this.transferService.getBlockchainInfo();
  }

  /**
   * 获取当前区块高度
   */
  @Get('block-count')
  async getBlockCount() {
    return await this.transferService.getBlockCount();
  }

  /**
   * 根据高度获取区块哈希
   */
  @Get('block-hash/:height')
  async getBlockHash(@Param('height') height: string) {
    return await this.transferService.getBlockHash(parseInt(height));
  }

  /**
   * 根据哈希获取区块信息
   */
  @Get('block/:hash')
  async getBlock(@Param('hash') hash: string, @Query('verbosity') verbosity?: string) {
    const verb = verbosity ? parseInt(verbosity) : 1;
    return await this.transferService.getBlock(hash, verb);
  }

  /**
   * 获取最佳区块哈希
   */
  @Get('best-block-hash')
  async getBestBlockHash() {
    return await this.transferService.getBestBlockHash();
  }

  /**
   * 获取交易信息
   */
  @Get('transaction/:txid')
  async getTransaction(@Param('txid') txid: string, @Query('verbose') verbose?: string) {
    const isVerbose = verbose === 'false' ? false : true;
    return await this.transferService.getTransaction(txid, isVerbose);
  }

  /**
   * 获取原始交易信息
   */
  @Get('raw-transaction/:txid')
  async getRawTransaction(@Param('txid') txid: string, @Query('verbose') verbose?: string) {
    const isVerbose = verbose === 'false' ? false : true;
    return await this.transferService.getRawTransaction(txid, isVerbose);
  }

  /**
   * 获取网络信息
   */
  @Get('network-info')
  async getNetworkInfo() {
    return await this.transferService.getNetworkInfo();
  }

  /**
   * 获取挖矿信息
   */
  @Get('mining-info')
  async getMiningInfo() {
    return await this.transferService.getMiningInfo();
  }

  /**
   * 获取内存池信息
   */
  @Get('mempool-info')
  async getMempoolInfo() {
    return await this.transferService.getMempoolInfo();
  }

  /**
   * 获取内存池中的交易列表
   */
  @Get('raw-mempool')
  async getRawMempool(@Query('verbose') verbose?: string) {
    const isVerbose = verbose === 'true' ? true : false;
    return await this.transferService.getRawMempool(isVerbose);
  }

  /**
   * 获取钱包信息
   */
  @Get('wallet-info')
  async getWalletInfo() {
    return await this.transferService.getWalletInfo();
  }

  /**
   * 获取余额
   */
  @Get('balance')
  async getBalance(@Query('account') account?: string, @Query('minconf') minconf?: string) {
    const acc = account || '*';
    const conf = minconf ? parseInt(minconf) : 1;
    return await this.transferService.getBalance(acc, conf);
  }

  /**
   * 获取新地址
   */
  @Post('new-address')
  async getNewAddress(@Body() body: { account?: string; addressType?: string }) {
    return await this.transferService.getNewAddress(body.account, body.addressType);
  }

  /**
   * 发送到地址
   */
  @Post('send-to-address')
  async sendToAddress(@Body() body: { 
    address: string; 
    amount: number; 
    comment?: string; 
    commentTo?: string 
  }) {
    return await this.transferService.sendToAddress(
      body.address, 
      body.amount, 
      body.comment, 
      body.commentTo
    );
  }

  /**
   * 验证地址
   */
  @Get('validate-address/:address')
  async validateAddress(@Param('address') address: string) {
    return await this.transferService.validateAddress(address);
  }

  /**
   * 获取节点连接数
   */
  @Get('connection-count')
  async getConnectionCount() {
    return await this.transferService.getConnectionCount();
  }

  /**
   * 获取难度
   */
  @Get('difficulty')
  async getDifficulty() {
    return await this.transferService.getDifficulty();
  }
}