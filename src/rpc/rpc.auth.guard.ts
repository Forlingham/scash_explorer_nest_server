import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class RpcAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest()
    const authHeader = request.headers['authorization']

    if (!authHeader) {
      throw new UnauthorizedException('Missing Authorization header')
    }

    const [type, credentials] = authHeader.split(' ')
    if (type !== 'Basic') {
      throw new UnauthorizedException('Invalid Authorization type. Basic Auth required.')
    }

    const decoded = Buffer.from(credentials, 'base64').toString('utf-8')
    const [user, pass] = decoded.split(':')

    const expectedUser = this.configService.get<string>('RPC_PUBLIC_USER')
    const expectedPass = this.configService.get<string>('RPC_PUBLIC_PASSWORD')

    if (!expectedUser || !expectedPass) {
      // 如果未配置公共密码，则默认拒绝访问，或者你可以选择开放（取决于策略，这里为了安全选择拒绝）
      console.error('RPC_PUBLIC_USER or RPC_PUBLIC_PASSWORD not configured in .env')
      throw new UnauthorizedException('Server configuration error: Public RPC auth not set')
    }

    if (user === expectedUser && pass === expectedPass) {
      return true
    }

    throw new UnauthorizedException('Invalid credentials')
  }
}
