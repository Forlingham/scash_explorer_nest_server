// src/snapshot/snapshot.module.ts
import { Module } from '@nestjs/common'
import { SnapshotService } from './snapshot.service'
import { ScheduleModule } from '@nestjs/schedule'
import { HttpModule } from '@nestjs/axios'
import { RpcModule } from '../rpc/rpc.module'

@Module({
  imports: [ScheduleModule.forRoot(), HttpModule, RpcModule],
  providers: [SnapshotService]
})
export class SnapshotModule {}
