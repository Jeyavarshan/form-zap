import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { WebhookIntegrationService } from './webhook-integration.service';
import { PlanLimitsGuard } from '../subscription/guards/plan-limits.guard';
import { CheckPlanLimit } from '../subscription/guards/plan-limits.decorator';
import type {
  GenerateFlowTokenInput,
  SaveFormMappingInput,
  SendFormFlowInput,
  TestWebhookInput,
} from './webhook-integration.service';

@Controller('webhook-integration')
export class WebhookIntegrationController {
  constructor(
    private readonly webhookIntegrationService: WebhookIntegrationService,
  ) {}

  @Get('config')
  getConfig(@Query('workspacePublicId') workspacePublicId?: string) {
    return this.webhookIntegrationService.getWebhookConfig(workspacePublicId);
  }

  @Get('forms')
  listForms() {
    return this.webhookIntegrationService.listForms();
  }

  @Get('webhook-events')
  listWebhookEvents() {
    return this.webhookIntegrationService.listWebhookEvents();
  }

  @Get('flow-events')
  listFlowEvents() {
    return this.webhookIntegrationService.listFlowEvents();
  }

  @Get('submissions')
  listSubmissions() {
    return this.webhookIntegrationService.listSubmissions();
  }

  @Post('forms')
  @UseGuards(PlanLimitsGuard)
  @CheckPlanLimit('active_flows_limit')
  saveFormMapping(@Body() body: SaveFormMappingInput) {
    return this.webhookIntegrationService.saveFormMapping(body);
  }

  @Get('forms/:workspaceId/:formId')
  getForm(
    @Param('workspaceId') workspaceId: string,
    @Param('formId') formId: string,
  ) {
    return this.webhookIntegrationService.getForm(workspaceId, formId);
  }

  @Get('flow-sends')
  listSends() {
    return this.webhookIntegrationService.listSends();
  }

  @Post('forms/:formId/send')
  sendFormFlow(
    @Param('formId') formId: string,
    @Body() body: SendFormFlowInput,
  ) {
    return this.webhookIntegrationService.sendFormFlow({
      ...body,
      formId: body.formId || formId,
    });
  }

  @Get('flow-sends/:sendId')
  getSend(@Param('sendId') sendId: string) {
    return this.webhookIntegrationService.getSend(sendId);
  }

  @Post('flow-sends/:sendId/test-webhook')
  sendTestWebhookForSend(
    @Param('sendId') sendId: string,
    @Body() body: TestWebhookInput,
  ) {
    return this.webhookIntegrationService.sendTestWebhookForSend(sendId, body);
  }

  @Get('flow-tokens')
  listFlowTokens() {
    return this.webhookIntegrationService.listFlowTokens();
  }

  @Post('flow-tokens')
  generateFlowToken(@Body() body: GenerateFlowTokenInput) {
    return this.webhookIntegrationService.generateFlowToken(body);
  }

  @Get('flow-tokens/:flowToken')
  getFlowToken(@Param('flowToken') flowToken: string) {
    return this.webhookIntegrationService.getFlowToken(flowToken);
  }

  @Post('flow-tokens/:flowToken/test-webhook')
  sendTestWebhook(
    @Param('flowToken') flowToken: string,
    @Body() body: TestWebhookInput,
  ) {
    return this.webhookIntegrationService.sendTestWebhook(flowToken, body);
  }
}
