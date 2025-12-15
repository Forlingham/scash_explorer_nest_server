import { Module } from '@nestjs/common';
import { transferController } from './transfer.controller';
import { transferService } from './transfer.service';

@Module({
  controllers: [transferController],
  providers: [transferService],
})
export class transferModule {}