import { Controller, Get, Post, Delete, Body, Param, Query, Res } from '@nestjs/common';
import { GoogleSheetsService } from './google-sheets.service';
import type { Response } from 'express';

@Controller('google-sheets')
export class GoogleSheetsController {
  constructor(private readonly googleSheetsService: GoogleSheetsService) {}

  @Get('auth/url')
  getAuthUrl(@Query('workspacePublicId') workspacePublicId: string) {
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
  getAuthStatus(@Query('workspacePublicId') workspacePublicId: string) {
    return this.googleSheetsService.getAuthStatus(workspacePublicId);
  }

  @Delete('auth')
  disconnectAuth(@Query('workspacePublicId') workspacePublicId: string) {
    return this.googleSheetsService.disconnectAuth(workspacePublicId);
  }

  @Get('connections')
  listConnections(@Query('workspacePublicId') workspacePublicId: string) {
    return this.googleSheetsService.listConnections(workspacePublicId);
  }

  @Post('connections')
  createConnection(@Body() body: { workspacePublicId: string, formId: string, formName: string, numberId: string, numberLabel: string }) {
    return this.googleSheetsService.createConnection(
      body.workspacePublicId,
      body.formId,
      body.formName,
      body.numberId,
      body.numberLabel
    );
  }

  @Delete('connections/:id')
  deleteConnection(@Param('id') id: string, @Query('workspacePublicId') workspacePublicId: string) {
    return this.googleSheetsService.deleteConnection(workspacePublicId, id);
  }
}
