import { Controller, Get } from '@nestjs/common'
import { NodeManagerService } from './node-manager.service'

/**
 * 节点管理控制器
 * 提供给前端查询节点状态的接口
 */
@Controller('nodes')
export class NodeManagerController {
  constructor(private readonly nodeManagerService: NodeManagerService) {}

  /**
   * 获取所有节点的状态信息
   * GET /api/nodes/status
   *
   * 返回各节点的名称、延迟、健康状态、是否活跃等信息
   */
  @Get('status')
  getStatus() {
    return this.nodeManagerService.getNodesStatus()
  }

  /**
   * 手动触发一次健康检测
   * GET /api/nodes/health-check
   *
   * 用于调试或在感知到网络问题时手动触发
   */
  @Get('health-check')
  async triggerHealthCheck() {
    await this.nodeManagerService.performHealthCheck()
    return {
      message: '健康检测完成',
      result: this.nodeManagerService.getNodesStatus()
    }
  }
}
