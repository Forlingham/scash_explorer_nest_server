import { Module } from "@nestjs/common";
import { DapService } from "./dap.service";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  providers: [DapService],
  exports: [DapService],
})
export class DapModule {}
