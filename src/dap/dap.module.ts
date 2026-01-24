import { Module } from "@nestjs/common";
import { DapService } from "./dap.service";
import { DapController } from "./dap.controller";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [DapController],
  providers: [DapService],
  exports: [DapService],
})
export class DapModule {}
