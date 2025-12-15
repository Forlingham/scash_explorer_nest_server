import { Global, Module } from '@nestjs/common';
import { RpcService } from './rpc.service';
import { RpcController } from './rpc.controller';
import { HttpModule } from '@nestjs/axios';

@Global()
@Module({
  imports: [HttpModule], // 导入 HttpModule
  controllers: [RpcController],
  providers: [RpcService],
  exports: [RpcService], // <-- 导出
})
export class RpcModule {}
