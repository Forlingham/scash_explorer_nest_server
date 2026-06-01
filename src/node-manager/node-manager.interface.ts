/**
 * 节点配置接口
 */
export interface NodeConfig {
  /** 节点名称（唯一标识） */
  name: string
  /** RPC 地址 */
  rpcUrl: string
  /** RPC 用户名 */
  rpcUser: string
  /** RPC 密码 */
  rpcPassword: string
  /** ZMQ 地址 */
  zmqUrl: string
}

/**
 * 节点运行时状态
 */
export interface NodeStatus {
  /** 节点配置 */
  config: NodeConfig
  /** 是否健康 */
  isHealthy: boolean
  /** 是否为当前活跃节点 */
  isActive: boolean
  /** 最近一次健康检测的延迟（毫秒），-1 表示不可达 */
  latency: number
  /** 最近一次健康检测时间 */
  lastCheckTime: Date | null
  /** 连续失败次数 */
  failureCount: number
}

/**
 * 前端展示用的节点状态（脱敏）
 */
export interface NodeStatusResponse {
  /** 当前活跃节点名称 */
  activeNode: string
  /** 最近一次全局健康检测时间 */
  lastCheckTime: string | null
  /** 各节点状态列表 */
  nodes: {
    name: string
    rpcUrl: string
    zmqUrl: string
    isHealthy: boolean
    isActive: boolean
    latency: number
    lastCheckTime: string | null
    failureCount: number
  }[]
}

// ─── 节点链状态相关接口 ────────────────────────────────────────

/**
 * 网络信息（来自 getnetworkinfo）
 */
export interface NetworkInfo {
  /** 节点软件版本号 */
  version: number
  /** 节点 User-Agent 字符串 */
  subversion: string
  /** P2P 协议版本 */
  protocolversion: number
  /** 总连接节点数 */
  connections: number
  /** 入站连接数 */
  connections_in: number
  /** 出站连接数 */
  connections_out: number
  /** 网络是否激活 */
  networkactive: boolean
  /** 最小中继费率 (BTC/kB) */
  relayfee: number
  /** 本节点是否参与交易中继 */
  localrelay: boolean
  /** 网络警告信息 */
  warnings: string
}

/**
 * 区块链信息（来自 getblockchaininfo）
 */
export interface BlockchainInfo {
  /** 所在链名称 */
  chain: string
  /** 当前最新区块高度 */
  blocks: number
  /** 已同步的区块头数量 */
  headers: number
  /** 最新区块哈希 */
  bestblockhash: string
  /** 当前挖矿难度 */
  difficulty: number
  /** 最近11个区块的中位时间戳 */
  mediantime: number
  /** 验证进度 (0.0~1.0) */
  verificationprogress: number
  /** 累计链工作量 */
  chainwork: string
  /** 区块数据磁盘占用（字节） */
  size_on_disk: number
  /** 是否启用了区块修剪 */
  pruned: boolean
  /** 警告信息 */
  warnings: string
}

/**
 * 内存池信息（来自 getmempoolinfo）
 */
export interface MempoolInfo {
  /** 内存池中的交易数量 */
  size: number
  /** 内存池总字节数 */
  bytes: number
  /** 内存池内存使用量（字节） */
  usage: number
  /** 内存池最大允许大小 */
  maxmempool: number
  /** 进入内存池的最低费率 (BTC/kB) */
  mempoolminfee: number
}

/**
 * 挖矿信息（来自 getmininginfo）
 */
export interface MiningInfo {
  /** 区块高度 */
  blocks: number
  /** 当前难度 */
  difficulty: number
  /** 全网算力 (hash/s) */
  networkhashps: number
  /** 链名称 */
  chain: string
}

/**
 * 网络流量信息（来自 getnettotals）
 */
export interface NetTotals {
  /** 总接收字节数 */
  totalbytesrecv: number
  /** 总发送字节数 */
  totalbytessent: number
  /** 当前时间戳（毫秒） */
  timemillis: number
}

/**
 * 完整的节点链状态信息（聚合接口返回值）
 */
export interface NodeChainStatus {
  /** 节点运行时间（秒） */
  uptime: number
  /** 网络信息 */
  network: NetworkInfo
  /** 区块链信息 */
  blockchain: BlockchainInfo
  /** 内存池信息 */
  mempool: MempoolInfo
  /** 挖矿信息 */
  mining: MiningInfo
  /** 网络流量信息 */
  netTotals: NetTotals
}
