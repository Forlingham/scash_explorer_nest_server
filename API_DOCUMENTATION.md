# Scash Explorer API 接口文档

> 基础路径：`/api`  
> 所有接口均以 `GET` 方法访问（除特殊标注外）

---

## 目录

- [1. 节点管理](#1-节点管理)
- [2. 节点链状态](#2-节点链状态)
- [3. 区块浏览器](#3-区块浏览器)
- [4. 统计数据](#4-统计数据)
- [5. DAP 数据](#5-dap-数据)
- [6. 转账/RPC 代理](#6-转账rpc-代理)
- [7. 公共 RPC 代理](#7-公共-rpc-代理)

---

## 1. 节点管理

管理多节点配置、健康检测与故障切换。

### `GET /api/nodes/status`

获取所有配置节点的状态信息（延迟、健康状态、是否活跃）。

**响应示例：**
```json
{
  "activeNode": "node-1",
  "lastCheckTime": "2026-05-24T10:00:00.000Z",
  "nodes": [
    {
      "name": "node-1",
      "rpcUrl": "http://127.0.0.1:8342/",
      "zmqUrl": "tcp://127.0.0.1:28332",
      "isHealthy": true,
      "isActive": true,
      "latency": 45,
      "lastCheckTime": "2026-05-24T10:00:00.000Z",
      "failureCount": 0
    },
    {
      "name": "node-2",
      "rpcUrl": "http://192.168.1.100:8342/",
      "zmqUrl": "tcp://192.168.1.100:28332",
      "isHealthy": true,
      "isActive": false,
      "latency": 120,
      "lastCheckTime": "2026-05-24T10:00:00.000Z",
      "failureCount": 0
    }
  ]
}
```

---

### `GET /api/nodes/health-check`

手动触发一次全量健康检测，立即返回检测结果。

**响应示例：**
```json
{
  "message": "健康检测完成",
  "result": { /* 同 /api/nodes/status 结构 */ }
}
```

---

## 2. 节点链状态

获取当前活跃核心节点的区块链运行状态信息。

### `GET /api/nodes/chain-status`

**聚合接口** — 一次性获取所有链状态信息（推荐前端首页使用）。

| 缓存 | 30 秒 |
|------|--------|

**响应示例：**
```json
{
  "uptime": 864000,
  "network": {
    "version": 250000,
    "subversion": "/Scash:25.0.0/",
    "protocolversion": 70016,
    "connections": 12,
    "connections_in": 5,
    "connections_out": 7,
    "networkactive": true,
    "relayfee": 0.00001,
    "localrelay": true,
    "warnings": ""
  },
  "blockchain": {
    "chain": "main",
    "blocks": 185432,
    "headers": 185432,
    "bestblockhash": "000000000000003a...",
    "difficulty": 1234567.89,
    "mediantime": 1716537600,
    "verificationprogress": 0.9999998,
    "chainwork": "00000000000000000000000000000000000000000000000b...",
    "size_on_disk": 5368709120,
    "pruned": false,
    "warnings": ""
  },
  "mempool": {
    "size": 156,
    "bytes": 89432,
    "usage": 352768,
    "maxmempool": 300000000,
    "mempoolminfee": 0.00001
  },
  "mining": {
    "blocks": 185432,
    "difficulty": 1234567.89,
    "networkhashps": 98765432100,
    "chain": "main"
  },
  "netTotals": {
    "totalbytesrecv": 1073741824,
    "totalbytessent": 536870912,
    "timemillis": 1716537600000
  }
}
```

---

### `GET /api/nodes/network-info`

获取 P2P 网络信息（连接数、协议版本等）。

| 缓存 | 60 秒 |
|------|--------|

---

### `GET /api/nodes/blockchain-info`

获取区块链同步状态（高度、难度、磁盘占用等）。

| 缓存 | 15 秒 |
|------|--------|

---

### `GET /api/nodes/mempool-info`

获取内存池状态（交易数、内存使用等）。

| 缓存 | 10 秒 |
|------|--------|

---

### `GET /api/nodes/mining-info`

获取挖矿信息（难度、全网算力等）。

| 缓存 | 60 秒 |
|------|--------|

---

### `GET /api/nodes/net-totals`

获取网络流量统计（总收发字节数）。

| 缓存 | 30 秒 |
|------|--------|

---

### `GET /api/nodes/uptime`

获取节点运行时间。

| 缓存 | 30 秒 |
|------|--------|

**响应示例：**
```json
{
  "seconds": 864000,
  "formatted": "10 天 0 小时 0 分钟"
}
```

---

## 3. 区块浏览器

核心浏览器功能接口。

### `GET /api/explorer/blocks`

获取区块列表（分页）。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `page` | number | 1 | 页码 |
| `pageSize` | number | 20 | 每页数量 |

---

### `GET /api/explorer/block-detail/:heightOrHash`

根据区块高度或哈希获取区块详情。

| 参数 | 类型 | 说明 |
|------|------|------|
| `heightOrHash` | string | 区块高度（数字）或区块哈希 |

---

### `GET /api/explorer/block-transactions/:height`

获取指定区块的交易列表（分页）。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `height` | number | - | 区块高度（路径参数） |
| `page` | number | 1 | 页码 |
| `pageSize` | number | 20 | 每页数量 |

---

### `GET /api/explorer/block-transactions-visualization/:height`

获取指定区块所有交易的大小和手续费（用于可视化）。

---

### `GET /api/explorer/transactions`

获取交易列表（排除 coinbase 交易，分页）。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `page` | number | 1 | 页码 |
| `pageSize` | number | 20 | 每页数量 |

---

### `GET /api/explorer/tx/:txid`

获取交易详情（含处理后的输入输出、确认数等）。

---

### `GET /api/explorer/block/:heightOrHash`

获取区块原始信息（含关联交易列表）。

---

### `GET /api/explorer/address-detail/:address`

获取地址详情（余额、交易数、标签等）。

---

### `GET /api/explorer/address/:address/txs`

获取地址的交易列表（分页）。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `page` | number | 1 | 页码 |
| `pageSize` | number | 20 | 每页数量 |

---

### `GET /api/explorer/address/:address`

获取地址基础信息。

---

### `GET /api/explorer/address/:address/graph`

获取地址的交易关系图数据（上下游地址）。

---

### `GET /api/explorer/mempool`

获取当前内存池中的交易（RPC 实时查询，最多50条）。

---

### `GET /api/explorer/mempool/transactions`

获取数据库中缓存的内存池交易列表（分页）。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `page` | number | 1 | 页码 |
| `pageSize` | number | 20 | 每页数量 |

---

### `POST /api/explorer/address/addTag`

添加地址标签。

**请求体：**
```json
{
  "address": "scash1q...",
  "name": "交易所",
  "type": "exchange",
  "description": "某交易所冷钱包"
}
```

---

## 4. 统计数据

### `GET /api/explorer/home/overview`

首页概览数据（日变动、费率估计、价格等聚合）。

| 缓存 | 60 秒 |
|------|--------|

---

### `GET /api/explorer/home/chart`

首页图表数据（7天交易量、算力、难度、矿工分布）。

| 缓存 | 60 秒 |
|------|--------|

---

### `GET /api/explorer/stats/chart/transactions-7days`

近7天每日交易数量（折线图）。

| 缓存 | 60 秒 |
|------|--------|

---

### `GET /api/explorer/stats/chart/network-hash`

网络算力每小时统计（折线图）。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `hours` | number | 24 | 查询小时数 |

| 缓存 | 60 秒 |
|------|--------|

---

### `GET /api/explorer/stats/chart/network-difficulty`

网络难度每小时统计（折线图）。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `hours` | number | 24 | 查询小时数 |

| 缓存 | 60 秒 |
|------|--------|

---

### `GET /api/explorer/stats/chart/miner-distribution`

矿工地址分布（饼图）。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `blockCount` | number | 1000 | 统计区块数 |

| 缓存 | 60 秒 |
|------|--------|

---

### `GET /api/explorer/stats/chart/blocks`

区块统计数据图表（每日平均交易数、大小、费率、难度）。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `days` | number | 30 | 查询天数 |

| 缓存 | 60 秒 |
|------|--------|

---

### `GET /api/explorer/stats/wallets`

钱包活跃/不活跃统计。

| 缓存 | 60 秒 |
|------|--------|

---

### `GET /api/explorer/stats/miners`

矿工统计信息（饼图）。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `blocks` | number | 1000 | 统计区块数 |

| 缓存 | 60 秒 |
|------|--------|

---

### `GET /api/explorer/stats/whale-changes`

富豪榜变动数据。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `date` | string | 今天 | 日期 (YYYY-MM-DD) |

| 缓存 | 30 秒 |
|------|--------|

---

### `GET /api/explorer/stats/daily-changes`

每日统计信息变动。

| 缓存 | 30 秒 |
|------|--------|

---

### `GET /api/explorer/stats/balance-distribution`

地址余额分布统计（饼图）。

| 缓存 | 60 秒 |
|------|--------|

---

### `GET /api/explorer/stats/ranking-distribution`

地址排名金额占比统计（饼图）。

| 缓存 | 60 秒 |
|------|--------|

---

### `GET /api/explorer/stats/inactive-addresses`

不活跃地址统计概览。

| 缓存 | 60 秒 |
|------|--------|

---

### `GET /api/explorer/inactive-addresses`

查询指定时间段内不活跃的地址列表。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `period` | string | - | 时间段 (2year/1year/6months/3months/1month) |
| `type` | string | address | 类型 |
| `page` | number | 1 | 页码 |
| `pageSize` | number | 20 | 每页数量 |

---

### `GET /api/explorer/top-holders`

前100名持币者。

| 缓存 | 60 秒 |
|------|--------|

---

### `GET /api/explorer/fee-estimate`

交易费用估算。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `target` | number | 6 | 目标确认区块数 |

| 缓存 | 60 秒 |
|------|--------|

---

### `GET /api/explorer/price`

获取当前价格及涨跌幅。

| 缓存 | 30 秒 |
|------|--------|

---

### `GET /api/explorer/price/chart`

价格历史图表数据。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `days` | number | 30 | 查询天数 |

| 缓存 | 60 秒 |
|------|--------|

---

## 5. DAP 数据

### `GET /api/dap/list`

获取 DAP 数据列表（支持多条件查询）。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `filterTransfer` | boolean | - | 是否过滤转账留言 |
| `address` | string | - | 地址筛选 |
| `txid` | string | - | 交易ID筛选 |
| `content` | string | - | 内容模糊搜索 |
| `page` | number | 1 | 页码 |
| `pageSize` | number | 20 | 每页数量 |
| `sortBy` | string | blockHeight | 排序字段 (sortOrder/blockHeight/timestamp/totalFee) |
| `sortOrder` | string | desc | 排序方向 (asc/desc) |
| `isTop` | boolean | - | 是否只看置顶 |

---

### `GET /api/dap/stats`

获取 DAP 总统计数据（总金额、总地址数、总交易数）。

---

### `GET /api/dap/:id`

获取单个 DAP 数据详情。

---

## 6. 转账/RPC 代理

直接代理 RPC 调用的接口（无缓存）。

| 接口 | 说明 |
|------|------|
| `GET /api/transfer/blockchain-info` | 获取区块链信息 |
| `GET /api/transfer/block-count` | 获取当前区块高度 |
| `GET /api/transfer/block-hash/:height` | 根据高度获取区块哈希 |
| `GET /api/transfer/block/:hash?verbosity=` | 根据哈希获取区块信息 |
| `GET /api/transfer/best-block-hash` | 获取最佳区块哈希 |
| `GET /api/transfer/transaction/:txid?verbose=` | 获取交易信息 |
| `GET /api/transfer/raw-transaction/:txid?verbose=` | 获取原始交易信息 |
| `GET /api/transfer/network-info` | 获取网络信息 |
| `GET /api/transfer/mining-info` | 获取挖矿信息 |
| `GET /api/transfer/mempool-info` | 获取内存池信息 |
| `GET /api/transfer/raw-mempool?verbose=` | 获取内存池交易列表 |
| `GET /api/transfer/wallet-info` | 获取钱包信息 |
| `GET /api/transfer/balance?account=&minconf=` | 获取余额 |
| `POST /api/transfer/new-address` | 获取新地址 |
| `POST /api/transfer/send-to-address` | 发送到地址 |
| `GET /api/transfer/validate-address/:address` | 验证地址 |
| `GET /api/transfer/connection-count` | 获取节点连接数 |
| `GET /api/transfer/difficulty` | 获取难度 |

---

## 7. 公共 RPC 代理

### `POST /api/rpc`

代理转发 JSON-RPC 请求到核心节点（需要 Basic Auth 认证）。

**认证方式：** Basic Auth (`RPC_PUBLIC_USER` / `RPC_PUBLIC_PASSWORD`)

**请求体：**
```json
{
  "jsonrpc": "2.0",
  "method": "getblockcount",
  "params": [],
  "id": 1
}
```

**允许的方法白名单：** 详见 `src/utils/utils.ts` 中的 `rpcAllowedMethods`。

**限制：**
- Content-Type 必须为 `application/json`
- 请求体最大 1MB
- 仅允许白名单中的 RPC 方法

---

## 缓存策略总览

| 数据类别 | 缓存时间 | 说明 |
|---------|---------|------|
| 内存池数据 | 10 秒 | 变化频繁 |
| 区块链状态 | 15 秒 | 出块间隔敏感 |
| 聚合状态/流量/运行时间 | 30 秒 | 适中频率 |
| 统计图表/网络/挖矿/价格 | 60 秒 | 变化缓慢 |
| 实时查询（区块/交易详情） | 无缓存 | 按需查询 |

---

## 多节点配置说明

在 `.env` 中配置 `RPC_NODES` 环境变量（JSON 数组格式）：

```env
RPC_NODES='[{"name":"node-1","rpcUrl":"http://127.0.0.1:8342","rpcUser":"user1","rpcPassword":"pass1","zmqUrl":"tcp://127.0.0.1:28332"},{"name":"node-2","rpcUrl":"http://192.168.1.100:8342","rpcUser":"user2","rpcPassword":"pass2","zmqUrl":"tcp://192.168.1.100:28332"}]'
```

**工作机制：**
- 每小时自动健康检测，选择延迟最低的节点
- RPC 调用失败时自动切换到下一个健康节点
- ZMQ 连接跟随节点切换自动重连
- 30 秒切换冷却期，防止切换风暴
- 未配置 `RPC_NODES` 时自动回退到旧版 `RPC_URL` 单节点配置
