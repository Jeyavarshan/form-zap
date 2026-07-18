import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { google } from 'googleapis';

@Injectable()
export class GoogleSheetsService {
  private oauth2Client;

  constructor(private readonly prisma: PrismaService) {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID || 'dummy_client_id',
      process.env.GOOGLE_CLIENT_SECRET || 'dummy_client_secret',
      process.env.GOOGLE_REDIRECT_URI || 'http://localhost:4200/api/google-sheets/auth/callback'
    );
  }

  getAuthUrl(workspacePublicId: string) {
    const scopes = [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file'
    ];
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state: workspacePublicId,
      prompt: 'consent' // to force refresh token
    });
  }

  async handleAuthCallback(code: string, workspacePublicId: string) {
    const { tokens } = await this.oauth2Client.getToken(code);
    
    // Ensure Workspace exists (create a demo one if it doesn't exist yet)
    const workspace = await this.prisma.workspace.upsert({
      where: { publicId: workspacePublicId },
      create: { publicId: workspacePublicId, name: 'Demo Workspace' },
      update: {}
    });

    await this.prisma.workspaceGoogleCredential.upsert({
      where: { workspacePublicId },
      create: {
        workspaceId: workspace.id,
        workspacePublicId: workspacePublicId,
        accessToken: tokens.access_token ?? '',
        refreshToken: tokens.refresh_token ?? '',
        expiryDate: tokens.expiry_date
      },
      update: {
        accessToken: tokens.access_token ?? '',
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        expiryDate: tokens.expiry_date
      }
    });
  }
  
  async getAuthStatus(workspacePublicId: string) {
    const creds = await this.prisma.workspaceGoogleCredential.findUnique({
      where: { workspacePublicId }
    });
    return { isConnected: !!creds };
  }

  async disconnectAuth(workspacePublicId: string) {
    await this.prisma.workspaceGoogleCredential.delete({
      where: { workspacePublicId }
    }).catch(() => null);
  }

  private async getClient(workspacePublicId: string) {
    const cred = await this.prisma.workspaceGoogleCredential.findUnique({
      where: { workspacePublicId }
    });
    if (!cred) throw new BadRequestException('Google account not connected');

    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID || 'dummy_client_id',
      process.env.GOOGLE_CLIENT_SECRET || 'dummy_client_secret'
    );
    client.setCredentials({
      access_token: cred.accessToken,
      refresh_token: cred.refreshToken,
      expiry_date: Number(cred.expiryDate)
    });
    
    client.on('tokens', async (tokens) => {
       await this.prisma.workspaceGoogleCredential.update({
         where: { workspacePublicId },
         data: {
           accessToken: tokens.access_token ?? '',
           ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
           expiryDate: tokens.expiry_date
         }
       });
    });

    return client;
  }

  async createConnection(workspacePublicId: string, formId: string, formName: string, numberId: string, numberLabel: string) {
    const auth = await this.getClient(workspacePublicId);
    const sheets = google.sheets({ version: 'v4', auth });
    
    const spreadsheet = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: `FormZap Responses - ${formName}`
        }
      }
    });

    const spreadsheetId = spreadsheet.data.spreadsheetId;
    const spreadsheetUrl = spreadsheet.data.spreadsheetUrl;

    const connection = await this.prisma.googleSheetConnection.create({
      data: {
        workspacePublicId,
        formId,
        formName,
        numberId,
        numberLabel,
        spreadsheetId: spreadsheetId as string,
        spreadsheetUrl: spreadsheetUrl as string
      }
    });

    await this.appendRow(workspacePublicId, formId, numberId, ['Submission ID', 'Phone Number', 'Timestamp', 'Answers (JSON)']);

    try {
      const existingSubmissions = await this.prisma.flowSubmission.findMany({
        where: { workspacePublicId, formId },
        orderBy: { submittedAt: 'asc' }
      });

      if (existingSubmissions.length > 0) {
        const values = existingSubmissions.map(sub => [
          sub.id,
          sub.contactPhone || 'Unknown',
          sub.submittedAt.toISOString(),
          JSON.stringify(sub.answers)
        ]);

        await sheets.spreadsheets.values.append({
          spreadsheetId: connection.spreadsheetId,
          range: 'Sheet1', 
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values
          }
        });
      }
    } catch (e) {
      console.error('Failed to append existing data to Google Sheet', e);
    }

    return connection;
  }

  async listConnections(workspacePublicId: string) {
    return this.prisma.googleSheetConnection.findMany({
      where: { workspacePublicId }
    });
  }

  async deleteConnection(workspacePublicId: string, connectionId: string) {
    return this.prisma.googleSheetConnection.delete({
      where: { id: connectionId, workspacePublicId }
    });
  }

  async appendRow(workspacePublicId: string, formId: string, numberId: string, values: any[]) {
    // NumberId isn't easily extracted from a submission right now, maybe we just use formId? 
    // Usually a form can be submitted from different WhatsApp numbers, but in FormZap it looks like submissions might not explicitly track numberId the same way.
    // Let's just find connections by formId.
    const connections = await this.prisma.googleSheetConnection.findMany({
      where: { workspacePublicId, formId }
    });
    if (!connections.length) return;

    for (const connection of connections) {
      try {
        const auth = await this.getClient(workspacePublicId);
        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.values.append({
          spreadsheetId: connection.spreadsheetId,
          range: 'Sheet1', 
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [values]
          }
        });
      } catch(e) {
        console.error('Failed to append to Google Sheet', e);
      }
    }
  }
}
