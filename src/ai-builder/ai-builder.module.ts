import { Module } from '@nestjs/common';
import { AiBuilderController } from './ai-builder.controller';
import { AiBuilderService } from './ai-builder.service';

@Module({
  controllers: [AiBuilderController],
  providers: [AiBuilderService],
})
export class AiBuilderModule {}
