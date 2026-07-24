import { Body, Controller, Get, Param, Post, Query, Headers, UseGuards } from '@nestjs/common';
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
  ) { }

  @Get('config')
  getConfig(@Query('workspacePublicId') workspacePublicId?: string) {
    return this.webhookIntegrationService.getWebhookConfig(workspacePublicId);
  }

  private extractWsId(headers: Record<string, string>, queryWsId?: string, queryPublicId?: string): string | undefined {
    return (
      headers['x-workspace-id'] ||
      headers['x-workspace-public-id'] ||
      headers['X-Workspace-Id'] ||
      headers['X-Workspace-Public-Id'] ||
      queryWsId ||
      queryPublicId
    );
  }

  @Get('forms')
  listForms(
    @Headers() headers: Record<string, string> = {},
    @Query('workspaceId') queryWsId?: string,
    @Query('workspacePublicId') queryPublicId?: string,
  ) {
    const wsId = this.extractWsId(headers, queryWsId, queryPublicId);
    return this.webhookIntegrationService.listForms(wsId);
  }

  @Get('webhook-events')
  listWebhookEvents(
    @Headers() headers: Record<string, string> = {},
    @Query('workspaceId') queryWsId?: string,
    @Query('workspacePublicId') queryPublicId?: string,
  ) {
    const wsId = this.extractWsId(headers, queryWsId, queryPublicId);
    return this.webhookIntegrationService.listWebhookEvents(wsId);
  }

  @Get('flow-events')
  listFlowEvents(
    @Headers() headers: Record<string, string> = {},
    @Query('workspaceId') queryWsId?: string,
    @Query('workspacePublicId') queryPublicId?: string,
  ) {
    const wsId = this.extractWsId(headers, queryWsId, queryPublicId);
    return this.webhookIntegrationService.listFlowEvents(wsId);
  }

  @Get('submissions')
  listSubmissions(
    @Headers() headers: Record<string, string> = {},
    @Query('workspaceId') queryWsId?: string,
    @Query('workspacePublicId') queryPublicId?: string,
  ) {
    const wsId = this.extractWsId(headers, queryWsId, queryPublicId);
    return this.webhookIntegrationService.listSubmissions(wsId);
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
  listSends(
    @Headers() headers: Record<string, string> = {},
    @Query('workspaceId') queryWsId?: string,
    @Query('workspacePublicId') queryPublicId?: string,
  ) {
    const wsId = this.extractWsId(headers, queryWsId, queryPublicId);
    return this.webhookIntegrationService.listSends(wsId);
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
  listFlowTokens(
    @Headers() headers: Record<string, string> = {},
    @Query('workspaceId') queryWsId?: string,
    @Query('workspacePublicId') queryPublicId?: string,
  ) {
    const wsId = this.extractWsId(headers, queryWsId, queryPublicId);
    return this.webhookIntegrationService.listFlowTokens(wsId);
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
