// src/rpc/rpc.service.ts
import { HttpService } from '@nestjs/axios'
import { Inject, Injectable, InternalServerErrorException, Logger, forwardRef } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { firstValueFrom } from 'rxjs'
import axios from 'axios'
import { rpcAllowedMethods } from '../utils/utils'
import { NodeManagerService } from '../node-manager/node-manager.service'

@Injectable()
export class RpcService {
  private readonly logger = new Logger(RpcService.name)

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => NodeManagerService))
    private readonly nodeManager: NodeManagerService
  ) {}

  // 允许转发的 RPC 方法白名单
  private readonly allowedMethods = rpcAllowedMethods

  /**
   * 代理转发 RPC 请求
   * @param body JSON-RPC 请求体
   */
  async proxy(body: any): Promise<any> {
    // 1. 安全限制：基础格式校验
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {
        result: null,
        error: { code: -32600, message: 'Invalid Request: Body must be a JSON object' },
        id: null
      }
    }

    const { method, params, id, jsonrpc } = body

    // 2. 安全限制：校验 Method
    if (!method || typeof method !== 'string' || !this.allowedMethods.includes(method)) {
      return {
        result: null,
        error: { code: -32601, message: 'Method not allowed or missing' },
        id: id || null
      }
    }

    // 3. 安全限制：校验 Params (必须是数组或未定义)
    if (params !== undefined && !Array.isArray(params)) {
      return {
        result: null,
        error: { code: -32602, message: 'Invalid params: Must be an array' },
        id: id || null
      }
    }

    // 4. 安全限制：重组 Payload，丢弃所有多余字段（防止携带无关数据）
    const safePayload = {
      jsonrpc: jsonrpc || '2.0',
      method,
      params: params || [],
      id: id || null
    }

    // 获取当前活跃节点的连接信息
    const rpcUrl = this.nodeManager.getActiveRpcUrl()
    const rpcAuth = this.nodeManager.getActiveRpcAuth()

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(rpcUrl, safePayload, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${rpcAuth}`
          }
        })
      )
      return data
    } catch (error: any) {
      // 如果是 Axios 错误且包含响应数据（例如节点返回 500 错误带 JSON-RPC 错误体）
      if (error.response && error.response.data) {
        return error.response.data
      }

      // 网络错误：尝试故障切换后重试一次
      this.logger.warn(`代理 RPC 请求失败: ${error.message}，尝试切换节点...`)
      const switched = this.nodeManager.reportFailure()

      if (switched) {
        return this.retryProxy(safePayload)
      }

      return {
        result: null,
        error: { code: -32603, message: `Internal error: ${error.message}` },
        id: body.id || null
      }
    }
  }

  /**
   * 故障切换后重试代理请求
   */
  private async retryProxy(payload: any): Promise<any> {
    const rpcUrl = this.nodeManager.getActiveRpcUrl()
    const rpcAuth = this.nodeManager.getActiveRpcAuth()

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(rpcUrl, payload, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${rpcAuth}`
          }
        })
      )
      this.logger.log('节点切换后代理请求成功')
      return data
    } catch (error: any) {
      if (error.response && error.response.data) {
        return error.response.data
      }
      return {
        result: null,
        error: { code: -32603, message: `Internal error after failover: ${error.message}` },
        id: payload.id || null
      }
    }
  }

  /**
   * 通用的 RPC 调用方法
   * @param method RPC 方法名, e.g., 'getblockcount'
   * @param params 方法参数数组, e.g., [hash, verbosity]
   */
  async call<T = any>(method: string, params: any[] = []): Promise<T> {
    const payload = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params
    }

    // 从 NodeManager 动态获取连接信息
    const rpcUrl = this.nodeManager.getActiveRpcUrl()
    const rpcAuth = this.nodeManager.getActiveRpcAuth()

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(rpcUrl, payload, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${rpcAuth}`
          }
        })
      )

      if (data.error) {
        throw new InternalServerErrorException(`RPC Error: ${data.error.message} (Code: ${data.error.code})`)
      }

      return data.result as T
    } catch (error) {
      // 判断是否为网络连接错误（区别于 RPC 业务错误）
      if (axios.isAxiosError(error)) {
        this.logger.warn(`节点连接失败 [${method}]: ${error.message}，尝试切换节点...`)
        const switched = this.nodeManager.reportFailure()

        if (switched) {
          return this.retryCall<T>(method, params)
        }

        throw new InternalServerErrorException(`所有节点均不可用: ${error.message}`)
      }

      // RPC 业务错误直接抛出，不触发切换
      throw error
    }
  }

  /**
   * 故障切换后重试 RPC 调用
   */
  private async retryCall<T = any>(method: string, params: any[] = []): Promise<T> {
    const payload = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params
    }

    const rpcUrl = this.nodeManager.getActiveRpcUrl()
    const rpcAuth = this.nodeManager.getActiveRpcAuth()

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(rpcUrl, payload, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${rpcAuth}`
          }
        })
      )

      if (data.error) {
        throw new InternalServerErrorException(`RPC Error: ${data.error.message} (Code: ${data.error.code})`)
      }

      this.logger.log(`节点切换后 RPC 调用成功 [${method}]`)
      return data.result as T
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new InternalServerErrorException(`节点切换后仍然失败: ${error.message}`)
      }
      throw error
    }
  }
}
