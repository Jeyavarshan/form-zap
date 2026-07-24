import { Controller, Get, Post, Delete, Body, Param, Query, Headers, Res, UseGuards } from '@nestjs/common';
import { GoogleSheetsService } from './google-sheets.service';
import { PlanLimitsGuard } from '../subscription/guards/plan-limits.guard';
import { CheckPlanLimit } from '../subscription/guards/plan-limits.decorator';
import type { Response } from 'express';

@Controller('google-sheets')
export class GoogleSheetsController {
  constructor(private readonly googleSheetsService: GoogleSheetsService) {}

  private extractWsId(headers: Record<string, string>, queryWsId?: string): string {
    return (
      queryWsId ||
      headers['x-workspace-public-id'] ||
      headers['x-workspace-id'] ||
      headers['X-Workspace-Public-Id'] ||
      headers['X-Workspace-Id'] ||
      ''
    );
  }

  @Get('auth/url')
  @UseGuards(PlanLimitsGuard)
  @CheckPlanLimit('google_sheets')
  getAuthUrl(
    @Headers() headers: Record<string, string> = {},
    @Query('workspacePublicId') queryWsId?: string,
  ) {
    const workspacePublicId = this.extractWsId(headers, queryWsId);
    const url = this.googleSheetsService.getAuthUrl(workspacePublicId);
    return { url };
  }

  @Get('auth/callback')
  async authCallback(@Query('code') code: string, @Query('state') workspacePublicId: string, @Res() res: Response) {
    await this.googleSheetsService.handleAuthCallback(code, workspacePublicId);
    // Redirect back to frontend Integrations page
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    return res.redirect(`${frontendUrl}/integrations`);
  }

  @Get('auth/status')
  getAuthStatus(
    @Headers() headers: Record<string, string> = {},
    @Query('workspacePublicId') queryWsId?: string,
  ) {
    const workspacePublicId = this.extractWsId(headers, queryWsId);
    return this.googleSheetsService.getAuthStatus(workspacePublicId);
  }

  @Delete('auth')
  disconnectAuth(
    @Headers() headers: Record<string, string> = {},
    @Query('workspacePublicId') queryWsId?: string,
  ) {
    const workspacePublicId = this.extractWsId(headers, queryWsId);
    return this.googleSheetsService.disconnectAuth(workspacePublicId);
  }

  @Get('connections')
  listConnections(
    @Headers() headers: Record<string, string> = {},
    @Query('workspacePublicId') queryWsId?: string,
  ) {
    const workspacePublicId = this.extractWsId(headers, queryWsId);
    return this.googleSheetsService.listConnections(workspacePublicId);
  }

  @Post('connections')
  @UseGuards(PlanLimitsGuard)
  @CheckPlanLimit('google_sheets')
  createConnection(
    @Headers() headers: Record<string, string> = {},
    @Body() body: { workspacePublicId?: string; formId: string; formName: string; numberId: string; numberLabel: string },
  ) {
    const workspacePublicId = body.workspacePublicId || this.extractWsId(headers);
    return this.googleSheetsService.createConnection(
      workspacePublicId,
      body.formId,
      body.formName,
      body.numberId,
      body.numberLabel
    );
  }

  @Delete('connections/:id')
  deleteConnection(
    @Param('id') id: string,
    @Headers() headers: Record<string, string> = {},
    @Query('workspacePublicId') queryWsId?: string,
  ) {
    const workspacePublicId = this.extractWsId(headers, queryWsId);
    return this.googleSheetsService.deleteConnection(workspacePublicId, id);
  }
}
