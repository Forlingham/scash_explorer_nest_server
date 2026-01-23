// src/indexer/indexer.module.ts
import { Module } from "@nestjs/common";
import { IndexerService } from "./indexer.service";
import { ZmqService } from "./zmq.service";
import { ScheduleModule } from "@nestjs/schedule";
import { DapModule } from "../dap/dap.module";

@Module({
  imports: [ScheduleModule.forRoot(), DapModule],
  providers: [IndexerService, ZmqService],
  exports: [IndexerService, ZmqService],
})
export class IndexerModule {}
