import { Body, Controller, Post, Headers } from '@nestjs/common';
import { AiBuilderService } from './ai-builder.service';
import type { AiGenerationInput } from './ai-builder.service';

@Controller('ai-builder')
export class AiBuilderController {
  constructor(private readonly aiBuilderService: AiBuilderService) {}

  @Post('generate')
  generate(
    @Headers() headers: Record<string, string> = {},
    @Body() body: AiGenerationInput,
  ) {
    const workspaceId =
      body.workspaceId ||
      (body as any).workspacePublicId ||
      headers['x-workspace-id'] ||
      headers['x-workspace-public-id'];
    return this.aiBuilderService.generateForm({ ...body, workspaceId });
  }
}
