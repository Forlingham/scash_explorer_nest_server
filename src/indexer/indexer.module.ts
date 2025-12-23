// src/indexer/indexer.module.ts
import { Module } from '@nestjs/common';
import { IndexerService } from './indexer.service';
import { ZmqService } from './zmq.service';
import { ScheduleModule } from '@nestjs/schedule'; // <-- 导入定时任务模块

@Module({
  imports: [
    ScheduleModule.forRoot(), // <-- 初始化定时任务
  ],
  providers: [IndexerService, ZmqService],
  exports: [IndexerService, ZmqService],
})
export class IndexerModule {}