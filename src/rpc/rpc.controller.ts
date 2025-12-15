import { Controller, Post, Body, HttpCode, HttpStatus, Headers, BadRequestException, UseGuards } from '@nestjs/common'
import { RpcService } from './rpc.service'
import { RpcAuthGuard } from './rpc.auth.guard'

@Controller('rpc')
@UseGuards(RpcAuthGuard)
export class RpcController {
  constructor(private readonly rpcService: RpcService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleRpc(@Body() body: any, @Headers('content-type') contentType: string, @Headers('content-length') contentLength: string) {
    console.log(contentType.toLowerCase());
    console.log(body);
    
    // 1. 安全限制：强制 Content-Type 为 application/json
    // 导致后端校验失败或转发给节点时出错。因此这里严格限制为 application/json。
    if (!contentType || !contentType.toLowerCase().includes('application/json')) {
      throw new BadRequestException('Invalid Content-Type. Only application/json is allowed.')
    }

    // 2. 安全限制：限制请求体大小
    // 注意：content-length 是字符串，单位字节。1MB = 1048576 字节
    const MAX_BODY_SIZE = 1024 * 1024
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
      throw new BadRequestException('Payload too large.')
    }

    return await this.rpcService.proxy(body)
  }
}
