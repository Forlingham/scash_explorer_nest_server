/**
 * 货币转换工具函数
 */

/**
 * 将 BTC 转换为 satoshis
 * @param btcValue BTC 数值
 * @returns satoshis 数值 (BigInt)
 */
export function btcToSatoshis(btcValue: number): bigint {
  return BigInt(Math.round(btcValue * 1e8));
}

/**
 * 将 satoshis 转换为 BTC
 * @param satoshis satoshis 数值 (BigInt 或 number)
 * @returns BTC 数值
 */
export function satoshisToBtc(satoshis: bigint | number): number {
  const satoshisNum = typeof satoshis === 'bigint' ? Number(satoshis) : satoshis;
  return satoshisNum / 1e8;
}

/**
 * 将 BTC 转换为 satoshis (返回 number 类型，用于费率计算等场景)
 * @param btcValue BTC 数值
 * @returns satoshis 数值 (number)
 */
export function btcToSatoshisNumber(btcValue: number): number {
  return Math.round(btcValue * 1e8);
}

/**
 * 格式化 BTC 数值显示
 * @param btcValue BTC 数值
 * @param decimals 小数位数，默认为 8
 * @returns 格式化后的字符串
 */
export function formatBtc(btcValue: number, decimals: number = 8): string {
  return btcValue.toFixed(decimals);
}

/**
 * 格式化 satoshis 数值显示
 * @param satoshis satoshis 数值 (BigInt 或 number)
 * @returns 格式化后的字符串
 */
export function formatSatoshis(satoshis: bigint | number): string {
  const satoshisNum = typeof satoshis === 'bigint' ? Number(satoshis) : satoshis;
  return satoshisNum.toLocaleString();
}