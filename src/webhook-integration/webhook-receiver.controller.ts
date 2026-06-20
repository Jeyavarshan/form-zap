import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { WebhookIntegrationService } from './webhook-integration.service';

@Controller('webhooks')
export class WebhookReceiverController {
  constructor(
    private readonly webhookIntegrationService: WebhookIntegrationService,
  ) {}

  @Post(':provider/:workspacePublicId')
  receiveWebhook(
    @Param('provider') provider: string,
    @Param('workspacePublicId') workspacePublicId: string,
    @Body() payload: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.webhookIntegrationService.receiveWebhook({
      provider,
      workspacePublicId,
      payload,
      headers,
    });
  }

  @Get('meta/:workspacePublicId')
  verifyMetaWebhook(
    @Param('workspacePublicId') workspacePublicId: string,
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') verifyToken?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    return this.webhookIntegrationService.verifyMetaWebhook(workspacePublicId, {
      mode,
      verifyToken,
      challenge,
    });
  }
}
