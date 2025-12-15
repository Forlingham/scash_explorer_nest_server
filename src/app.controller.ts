import { Controller, Get } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { rpcAllowedMethods } from './utils/utils'

@Controller()
export class AppController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  getApiInfo() {
    return {
      name: 'SCASH Explorer API',
      version: '1.0.0',
      description: 'API for SCASH Explorer',
      contentType: 'application/json',
      rpc_auth: {
        username: this.configService.get<string>('RPC_PUBLIC_USER'),
        password: this.configService.get<string>('RPC_PUBLIC_PASSWORD')
      },
      rpc_support_methods: rpcAllowedMethods
    }
  }
}
