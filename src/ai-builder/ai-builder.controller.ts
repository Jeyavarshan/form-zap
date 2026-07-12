import { Body, Controller, Post } from '@nestjs/common';
import { AiBuilderService } from './ai-builder.service';
import type { AiGenerationInput } from './ai-builder.service';

@Controller('ai-builder')
export class AiBuilderController {
  constructor(private readonly aiBuilderService: AiBuilderService) {}

  @Post('generate')
  generate(@Body() body: AiGenerationInput) {
    return this.aiBuilderService.generateForm(body);
  }
}
