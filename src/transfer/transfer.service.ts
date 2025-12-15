import { Injectable } from '@nestjs/common';
import { RpcService } from '../rpc/rpc.service';

@Injectable()
export class transferService {
  constructor(private readonly rpcService: RpcService) {}

  /**
   * 获取区块链信息
   */
  async getBlockchainInfo() {
    return await this.rpcService.call('getblockchaininfo');
  }

  /**
   * 获取当前区块高度
   */
  async getBlockCount(): Promise<number> {
    return await this.rpcService.call<number>('getblockcount');
  }

  /**
   * 根据高度获取区块哈希
   */
  async getBlockHash(height: number): Promise<string> {
    return await this.rpcService.call<string>('getblockhash', [height]);
  }

  /**
   * 根据哈希获取区块信息
   */
  async getBlock(hash: string, verbosity: number = 1) {
    return await this.rpcService.call('getblock', [hash, verbosity]);
  }

  /**
   * 获取最佳区块哈希
   */
  async getBestBlockHash(): Promise<string> {
    return await this.rpcService.call<string>('getbestblockhash');
  }

  /**
   * 获取交易信息
   */
  async getTransaction(txid: string, verbose: boolean = true) {
    return await this.rpcService.call('gettransaction', [txid, verbose]);
  }

  /**
   * 获取原始交易信息
   */
  async getRawTransaction(txid: string, verbose: boolean = true) {
    return await this.rpcService.call('getrawtransaction', [txid, verbose]);
  }

  /**
   * 获取网络信息
   */
  async getNetworkInfo() {
    return await this.rpcService.call('getnetworkinfo');
  }

  /**
   * 获取挖矿信息
   */
  async getMiningInfo() {
    return await this.rpcService.call('getmininginfo');
  }

  /**
   * 获取内存池信息
   */
  async getMempoolInfo() {
    return await this.rpcService.call('getmempoolinfo');
  }

  /**
   * 获取内存池中的交易列表
   */
  async getRawMempool(verbose: boolean = false) {
    return await this.rpcService.call('getrawmempool', [verbose]);
  }

  /**
   * 获取钱包信息
   */
  async getWalletInfo() {
    return await this.rpcService.call('getwalletinfo');
  }

  /**
   * 获取余额
   */
  async getBalance(account: string = '*', minconf: number = 1) {
    return await this.rpcService.call('getbalance', [account, minconf]);
  }

  /**
   * 获取新地址
   */
  async getNewAddress(account?: string, addressType?: string) {
    const params = [] as (string | undefined)[];
    if (account) params.push(account);
    if (addressType) params.push(addressType);
    return await this.rpcService.call<string>('getnewaddress', params);
  }

  /**
   * 发送到地址
   */
  async sendToAddress(address: string, amount: number, comment?: string, commentTo?: string) {
    const params = [address, amount];
    if (comment) params.push(comment);
    if (commentTo) params.push(commentTo);
    return await this.rpcService.call<string>('sendtoaddress', params);
  }

  /**
   * 验证地址
   */
  async validateAddress(address: string) {
    return await this.rpcService.call('validateaddress', [address]);
  }

  /**
   * 获取节点连接数
   */
  async getConnectionCount(): Promise<number> {
    return await this.rpcService.call<number>('getconnectioncount');
  }

  /**
   * 获取难度
   */
  async getDifficulty(): Promise<number> {
    return await this.rpcService.call<number>('getdifficulty');
  }
}