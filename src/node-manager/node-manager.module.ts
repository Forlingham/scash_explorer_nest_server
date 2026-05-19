import { Global, Module } from '@nestjs/common'
import { NodeManagerService } from './node-manager.service'
import { NodeManagerController } from './node-manager.controller'

/**
 * 节点管理模块
 *
 * 全局模块，提供多节点管理、健康检测、故障切换功能
 * 其他模块（RpcService、ZmqService）通过注入 NodeManagerService 获取当前活跃节点信息
 */
@Global()
@Module({
  controllers: [NodeManagerController],
  providers: [NodeManagerService],
  exports: [NodeManagerService]
})
export class NodeManagerModule {}
