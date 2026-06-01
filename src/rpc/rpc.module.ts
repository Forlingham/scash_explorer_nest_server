import { Global, Module, forwardRef } from '@nestjs/common'
import { RpcService } from './rpc.service'
import { RpcController } from './rpc.controller'
import { HttpModule } from '@nestjs/axios'
import { NodeManagerModule } from '../node-manager/node-manager.module'

@Global()
@Module({
  imports: [HttpModule, forwardRef(() => NodeManagerModule)],
  controllers: [RpcController],
  providers: [RpcService],
  exports: [RpcService]
})
export class RpcModule {}
