import { Module } from '@nestjs/common'
import { PrismaModule } from './prisma/prisma.module'
import { ConfigModule } from '@nestjs/config'
import { HttpModule } from '@nestjs/axios'
import { RpcModule } from './rpc/rpc.module'
import { IndexerModule } from './indexer/indexer.module'
import { ExplorerModule } from './explorer/explorer.module'
import { SnapshotModule } from './snapshot/snapshot.module'
import { transferModule } from './transfer/transfer.module'
import { CacheModule } from './common/services/cache.module'
import { AppController } from './app.controller'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HttpModule,
    PrismaModule,
    CacheModule,
    RpcModule,
    IndexerModule,
    ExplorerModule,
    SnapshotModule,
    transferModule
  ],
  controllers: [AppController],
  providers: []
})
export class AppModule {}
