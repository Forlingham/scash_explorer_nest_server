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
