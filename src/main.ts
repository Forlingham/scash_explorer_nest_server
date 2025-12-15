import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { PrismaService } from './prisma/prisma.service'

;(BigInt.prototype as any).toJSON = function () {
  return this.toString()
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  // 这会确保在 Nest.js 应用关闭时，Prisma 会调用 $disconnect()
  // const prismaService = app.get(PrismaService)
  // await prismaService.enableShutdownHooks(app)
  app.setGlobalPrefix('api')
  await app.listen(process.env.PORT ?? 3000)
}
bootstrap()
