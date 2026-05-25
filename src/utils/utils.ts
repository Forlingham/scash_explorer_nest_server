/**
 * 计算分页的 skip 值（带参数验证）
 * @param page 页码，小于1时默认为1
 * @param pageSize 每页大小，小于1时默认为20
 * @returns skip 值
 */
export function calculateSkip(page: number, pageSize: number = 20): number {
  const validPage = page < 1 ? 1 : page;
  const validPageSize = pageSize < 1 ? 20 : pageSize;
  return (validPage - 1) * validPageSize;
}


// 允许转发的 RPC 方法白名单
export const rpcAllowedMethods = [
    'getbestblockhash',
    'getblock',
    'getblockchaininfo',
    'getblockcount',
    'getblockhash',
    'getblockheader',
    'getchaintips',
    'getconnectioncount',
    'getdifficulty',
    'getmempoolinfo',
    'getrawmempool',
    'getrawtransaction',
    'gettxout',
    'gettxoutsetinfo',
    'estimatesmartfee',
    'scantxoutset',
    'sendrawtransaction'
  ]
