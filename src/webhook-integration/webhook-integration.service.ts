import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, type FlowEvent as PrismaFlowEvent, type FlowSend as PrismaFlowSend, type FlowSubmission as PrismaFlowSubmission, type FormIntegration as PrismaFormIntegration } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';


export type FlowPublishStatus =
  | 'draft'
  | 'ready_to_publish'
  | 'exported'
  | 'awaiting_flow_id'
  | 'flow_id_added'
  | 'published_connected';

export type FlowConnectionStatus =
  | 'not_configured'
  | 'webhook_pending'
  | 'connected'
  | 'failed'
  | 'disconnected';

export type FormIntegrationRecord = {
  id: string;
  workspaceId: string;
  workspacePublicId: string;
  formId: string;
  formVersionId: string;
  formName: string;
  provider: string;
  flowId: string;
  flowJson?: unknown;
  screenCount: number;
  webhookUrl: string;
  ylyncWebhookUrl: string;
  publishStatus: FlowPublishStatus;
  connectionStatus: FlowConnectionStatus;
  lastResponseAt?: string;
  createdInFormZap: true;
  customerDatabaseChanged: false;
  createdAt: string;
  updatedAt: string;
};

export type FlowSendRecord = {
  id: string;
  flowToken: string;
  workspaceId: string;
  workspacePublicId: string;
  formId: string;
  formName: string;
  provider: string;
  flowId: string;
  recipientPhone: string;
  ylyncWebhookUrl: string;
  status: 'poc_send_created';
  createdAt: string;
};

export type WebhookEventRecord = {
  id: string;
  workspacePublicId: string;
  provider: string;
  receivedAt: string;
  processingStatus: 'received' | 'processed' | 'ignored' | 'failed';
  rawPayload: unknown;
  eventCount: number;
  mappedCount: number;
  unmappedCount: number;
  errorMessage?: string;
};

export type NormalizedFlowEvent = {
  type: 'flow.completed' | 'provider.event';
  provider: string;
  workspacePublicId: string;
  rawEventId: string;
  messageId?: string;
  flowId?: string;
  flowToken?: string;
  contactPhone?: string;
  contactName?: string;
  answers: Record<string, unknown>;
  occurredAt: string;
};

export type FlowEventRecord = NormalizedFlowEvent & {
  id: string;
  formIntegrationId?: string;
  formId?: string;
  mapped: boolean;
};

export type FlowSubmissionRecord = {
  id: string;
  idempotencyKey: string;
  flowEventId: string;
  formIntegrationId: string;
  workspaceId: string;
  workspacePublicId: string;
  formId: string;
  formName: string;
  provider: string;
  flowId?: string;
  flowToken?: string;
  contactPhone?: string;
  contactName?: string;
  answers: Record<string, unknown>;
  submittedAt: string;
};

export type SaveFormMappingInput = {
  workspaceId?: string;
  workspacePublicId?: string;
  formId?: string;
  formVersionId?: string;
  formName?: string;
  provider?: string;
  flowId?: string;
  flowJson?: unknown;
  screenCount?: number;
  publishStatus?: FlowPublishStatus;
  connectionStatus?: FlowConnectionStatus;
  ylyncWebhookUrl?: string;
};

export type SendFormFlowInput = SaveFormMappingInput & {
  recipientPhone?: string;
};

export type GenerateFlowTokenInput = SendFormFlowInput;

export type TestWebhookInput = {
  answers?: Record<string, unknown>;
  ylyncWebhookUrl?: string;
  webhookSecret?: string;
  source?: 'meta' | 'bsp';
};

export type ReceiveWebhookInput = {
  provider: string;
  workspacePublicId: string;
  payload: unknown;
  headers?: Record<string, string | string[] | undefined>;
};

export type MetaVerifyInput = {
  mode?: string;
  verifyToken?: string;
  challenge?: string;
};

const DEFAULT_WORKSPACE_ID = 'workspace_poc';
const DEFAULT_WORKSPACE_PUBLIC_ID = 'ws_acme_corp';
const DEFAULT_FORM_ID = 'appointment-flow';
const DEFAULT_FORM_VERSION_ID = 'appointment-flow-v1';
const DEFAULT_FORM_NAME = 'Appointment Flow';
const DEFAULT_FLOW_ID = 'meta_flow_id_from_import';
const DEFAULT_PROVIDER = 'meta';
const DEFAULT_RECIPIENT_PHONE = '9198XXXXXXX';
const DEFAULT_ANSWERS = {
  screen_0_DatePicker_0: '2026-06-20',
  screen_0_Dropdown_1: '0_9AM',
};

@Injectable()
export class WebhookIntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly googleSheetsService: GoogleSheetsService,
  ) { }


  getWebhookConfig(inputWorkspacePublicId?: string) {
    const workspacePublicId =
      this.clean(inputWorkspacePublicId) || DEFAULT_WORKSPACE_PUBLIC_ID;
    const providers = ['meta', 'twilio', '360dialog', 'gupshup', 'generic'];

    return {
      workspacePublicId,
      providerWebhookUrls: Object.fromEntries(
        providers.map((provider) => [
          provider,
          this.createWebhookUrl(provider, workspacePublicId),
        ]),
      ),
      webhookSecretRequired: Boolean(this.resolveIncomingWebhookSecret()),
      tokenPlacement: 'interactive.action.parameters.flow_token',
      flowIdPlacement: 'interactive.action.parameters.flow_id',
      routingPriority: ['flow_token', 'flow_id', 'form_id'],
      ownership: {
        formMappingStoredBy: 'Form-Zap',
        sendTrackingStoredBy: 'Form-Zap',
        customerDatabaseChanged: false,
        customerManuallyHandlesFlowToken: false,
      },
      notes: [
        'Use one stable webhook URL per workspace and WhatsApp provider.',
        'Map Meta/BSP flow_id values to Form-Zap form IDs before collecting responses.',
        'A form is marked connected only after a mapped webhook response is received.',
      ],
    };
  }

  async listForms() {
    const records = await this.prisma.formIntegration.findMany({
      orderBy: { updatedAt: 'desc' },
    });

    return records.map((record) => this.toFormResponse(record));
  }

  async listWebhookEvents() {
    const records = await this.prisma.webhookEvent.findMany({
      orderBy: { receivedAt: 'desc' },
    });

    return records.map((record) => ({
      ...record,
      receivedAt: this.toIso(record.receivedAt),
    }));
  }

  async listFlowEvents() {
    const records = await this.prisma.flowEvent.findMany({
      orderBy: { occurredAt: 'desc' },
    });

    return records.map((record) => ({
      ...record,
      occurredAt: this.toIso(record.occurredAt),
      createdAt: this.toIso(record.createdAt),
    }));
  }

  async listSubmissions() {
    const records = await this.prisma.flowSubmission.findMany({
      orderBy: { submittedAt: 'desc' },
    });

    return records.map((record) => ({
      ...record,
      submittedAt: this.toIso(record.submittedAt),
      createdAt: this.toIso(record.createdAt),
    }));
  }

  async saveFormMapping(input: SaveFormMappingInput = {}) {
    const workspaceId = this.clean(input.workspaceId) || DEFAULT_WORKSPACE_ID;
    const workspacePublicId =
      this.clean(input.workspacePublicId) ||
      this.createWorkspacePublicId(workspaceId);
    const formId = this.clean(input.formId) || DEFAULT_FORM_ID;
    const provider = this.normalizeProvider(input.provider);
    const existing = await this.prisma.formIntegration.findUnique({
      where: { workspaceId_formId: { workspaceId, formId } },
    });

    if (!existing) {
      const ws = await this.prisma.workspace.findUnique({ where: { publicId: workspacePublicId } });
      if (ws) {
        const plan = await this.prisma.plan.findUnique({ where: { name: ws.planName } });
        const maxFlows = plan?.maxFlows ?? 1;
        if (ws.flowsCount >= maxFlows) {
          throw new BadRequestException(`Flow limit reached (${maxFlows}). Please upgrade your plan.`);
        }
        await this.prisma.workspace.update({
          where: { publicId: workspacePublicId },
          data: { flowsCount: { increment: 1 } },
        });
      }
    }
    const flowId = this.clean(input.flowId) || existing?.flowId || '';
    const requestedPublishStatus = this.normalizePublishStatus(
      input.publishStatus,
    );
    const publishStatus = this.resolvePublishStatus(
      requestedPublishStatus,
      flowId,
      existing?.publishStatus,
    );
    const connectionStatus = this.resolveConnectionStatus(
      input.connectionStatus,
      publishStatus,
      existing?.connectionStatus,
    );
    const duplicate = flowId
      ? await this.prisma.formIntegration.findUnique({
        where: {
          workspacePublicId_provider_flowId: {
            workspacePublicId,
            provider,
            flowId,
          },
        },
      })
      : null;

    if (duplicate && duplicate.id !== existing?.id) {
      throw new BadRequestException(
        'This Meta Flow ID is already connected to another form in this workspace.',
      );
    }

    const ylyncWebhookUrl = this.normalizeUrl(
      input.ylyncWebhookUrl ||
      existing?.ylyncWebhookUrl ||
      this.resolveYlyncWebhookUrl(),
    );
    const flowJson =
      input.flowJson !== undefined
        ? this.toInputJson(input.flowJson)
        : existing?.flowJson === null
          ? undefined
          : existing?.flowJson;
    const data = {
      workspaceId,
      workspacePublicId,
      formId,
      formVersionId:
        this.clean(input.formVersionId) ||
        existing?.formVersionId ||
        DEFAULT_FORM_VERSION_ID,
      formName:
        this.clean(input.formName) || existing?.formName || DEFAULT_FORM_NAME,
      provider,
      flowId: flowId || null,
      screenCount:
        this.toPositiveInt(input.screenCount) ||
        this.countFlowScreens(input.flowJson) ||
        existing?.screenCount ||
        1,
      webhookUrl: this.createWebhookUrl(provider, workspacePublicId),
      ylyncWebhookUrl,
      publishStatus,
      connectionStatus,
      createdInFormZap: true,
      customerDatabaseChanged: false,
    };

    if (flowJson !== undefined) {
      Object.assign(data, { flowJson });
    }

    const record = await this.prisma.formIntegration.upsert({
      where: { workspaceId_formId: { workspaceId, formId } },
      create: data,
      update: data,
    });

    return this.toFormResponse(record);
  }

  async getForm(workspaceId: string, formId: string) {
    const cleanWorkspaceId = this.clean(workspaceId) || DEFAULT_WORKSPACE_ID;
    const cleanFormId = this.clean(formId) || DEFAULT_FORM_ID;
    const record = await this.prisma.formIntegration.findUnique({
      where: {
        workspaceId_formId: {
          workspaceId: cleanWorkspaceId,
          formId: cleanFormId,
        },
      },
    });

    if (!record) {
      throw new NotFoundException('Form integration was not found.');
    }

    return this.toFormResponse(record);
  }

  async listSends() {
    const records = await this.prisma.flowSend.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return records.map((record) => this.toSendResponse(record));
  }

  async getSend(sendId: string) {
    return this.toSendResponse(await this.findSendById(sendId));
  }

  async sendFormFlow(input: SendFormFlowInput = {}) {
    const form = await this.saveFormMapping({
      ...input,
      flowId: this.clean(input.flowId) || DEFAULT_FLOW_ID,
      publishStatus: input.publishStatus || 'flow_id_added',
      connectionStatus: input.connectionStatus || 'webhook_pending',
    });
    const record = await this.prisma.flowSend.create({
      data: {
        flowToken: this.createFlowToken(form.workspacePublicId, form.formId),
        workspaceId: form.workspaceId,
        workspacePublicId: form.workspacePublicId,
        formId: form.formId,
        formName: form.formName,
        provider: form.provider,
        flowId: form.flowId,
        recipientPhone:
          this.clean(input.recipientPhone) || DEFAULT_RECIPIENT_PHONE,
        ylyncWebhookUrl: form.ylyncWebhookUrl,
        status: 'poc_send_created',
      },
    });

    return this.toSendResponse(record);
  }

  async generateFlowToken(input: GenerateFlowTokenInput = {}) {
    const send = await this.sendFormFlow(input);

    return this.toLegacyFlowTokenResponse(await this.findSendById(send.sendId));
  }

  async listFlowTokens() {
    const records = await this.prisma.flowSend.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return records.map((record) => this.toLegacyFlowTokenResponse(record));
  }

  async getFlowToken(flowToken: string) {
    const record = await this.prisma.flowSend.findUnique({
      where: { flowToken },
    });

    if (!record) {
      throw new NotFoundException('Flow token was not found.');
    }

    return this.toLegacyFlowTokenResponse(record);
  }

  async sendTestWebhookForSend(sendId: string, input: TestWebhookInput = {}) {
    return this.sendTestWebhookForRecord(
      await this.findSendById(sendId),
      input,
    );
  }

  async sendTestWebhook(flowToken: string, input: TestWebhookInput = {}) {
    const record = await this.prisma.flowSend.findUnique({
      where: { flowToken },
    });

    if (!record) {
      throw new NotFoundException('Flow token was not found.');
    }

    return this.sendTestWebhookForRecord(record, input);
  }

  async receiveWebhook(input: ReceiveWebhookInput) {
    const provider = this.normalizeProvider(input.provider);
    const workspacePublicId = this.clean(input.workspacePublicId);

    if (!workspacePublicId) {
      throw new BadRequestException('Workspace public ID is required.');
    }

    const rawEvent = await this.prisma.webhookEvent.create({
      data: {
        workspacePublicId,
        provider,
        processingStatus: 'received',
        rawPayload: this.toInputJson(input.payload),
        eventCount: 0,
        mappedCount: 0,
        unmappedCount: 0,
      },
    });

    try {
      this.verifyIncomingSecret(input.headers);

      const normalizedEvents = this.normalizeProviderPayload(
        input.payload,
        provider,
        workspacePublicId,
        rawEvent.id,
      );

      // Enforce response limit
      if (normalizedEvents.length > 0) {
        const ws = await this.prisma.workspace.findUnique({ where: { publicId: workspacePublicId } });
        if (ws) {
          const plan = await this.prisma.plan.findUnique({ where: { name: ws.planName } });
          const maxResponses = plan?.maxResponses ?? 100;
          if (ws.responsesCount >= maxResponses) {
            throw new BadRequestException(`Monthly response limit reached (${maxResponses}). Please upgrade your plan.`);
          }
          await this.prisma.workspace.update({
            where: { publicId: workspacePublicId },
            data: { responsesCount: { increment: normalizedEvents.length } },
          });
        }
      }

      const processedEvents: FlowEventRecord[] = [];

      for (const event of normalizedEvents) {
        processedEvents.push(await this.storeFlowEvent(event));
      }

      const mappedCount = processedEvents.filter(
        (event) => event.mapped,
      ).length;
      const processingStatus =
        processedEvents.length > 0 ? 'processed' : 'ignored';

      await this.prisma.webhookEvent.update({
        where: { id: rawEvent.id },
        data: {
          eventCount: processedEvents.length,
          mappedCount,
          unmappedCount: processedEvents.length - mappedCount,
          processingStatus,
        },
      });

      return {
        ok: true,
        rawEventId: rawEvent.id,
        provider,
        workspacePublicId,
        eventCount: processedEvents.length,
        mappedCount,
        unmappedCount: processedEvents.length - mappedCount,
        processingStatus,
      };
    } catch (error) {
      await this.prisma.webhookEvent.update({
        where: { id: rawEvent.id },
        data: {
          processingStatus: 'failed',
          errorMessage:
            error instanceof Error
              ? error.message
              : 'Webhook processing failed.',
        },
      });
      throw error;
    }
  }

  verifyMetaWebhook(workspacePublicId: string, input: MetaVerifyInput) {
    const cleanWorkspacePublicId = this.clean(workspacePublicId);

    if (!cleanWorkspacePublicId) {
      throw new BadRequestException('Workspace public ID is required.');
    }

    if (input.mode !== 'subscribe') {
      throw new BadRequestException('Unsupported webhook verification mode.');
    }

    const expectedVerifyToken = this.resolveVerifyToken();

    if (
      expectedVerifyToken &&
      this.clean(input.verifyToken) !== expectedVerifyToken
    ) {
      throw new UnauthorizedException('Invalid Meta webhook verify token.');
    }

    return input.challenge ?? '';
  }

  private toFormResponse(
    record: PrismaFormIntegration | FormIntegrationRecord,
  ) {
    const form = this.toFormRecord(record);

    return {
      ...form,
      providerWebhookUrl: form.webhookUrl,
      trackingOwner: 'Form-Zap',
      customerAction:
        form.connectionStatus === 'connected'
          ? 'Responses are being collected for this form.'
          : 'Add this webhook URL in your provider and send a test Flow response.',
    };
  }

  private toFormRecord(
    record: PrismaFormIntegration | FormIntegrationRecord,
  ): FormIntegrationRecord {
    return {
      ...record,
      flowId: record.flowId || '',
      flowJson: record.flowJson ?? undefined,
      screenCount: record.screenCount || 1,
      publishStatus: record.publishStatus as FlowPublishStatus,
      connectionStatus: record.connectionStatus as FlowConnectionStatus,
      lastResponseAt: record.lastResponseAt
        ? this.toIso(record.lastResponseAt)
        : undefined,
      createdInFormZap: true,
      customerDatabaseChanged: false,
      createdAt: this.toIso(record.createdAt),
      updatedAt: this.toIso(record.updatedAt),
    };
  }

  private toSendResponse(record: PrismaFlowSend | FlowSendRecord) {
    const send = this.toSendRecord(record);

    return {
      sendId: send.id,
      status: send.status,
      workspaceId: send.workspaceId,
      workspacePublicId: send.workspacePublicId,
      formId: send.formId,
      formName: send.formName,
      provider: send.provider,
      flowId: send.flowId,
      recipientPhone: send.recipientPhone,
      createdAt: send.createdAt,
      message:
        'PoC send session created. Form-Zap stamped a hidden flow_token for this recipient.',
      tracking: {
        storedBy: 'Form-Zap',
        customerDatabaseChanged: false,
        customerManuallyHandlesFlowToken: false,
      },
      debug: {
        flowToken: send.flowToken,
        ylyncWebhookUrl: send.ylyncWebhookUrl,
        platformWebhookUrl: this.createWebhookUrl(
          send.provider,
          send.workspacePublicId,
        ),
        whatsappSendPayload: this.createWhatsAppSendPayload(send),
        metaWebhookSample: this.createMetaWebhookPayload(send),
        bspWebhookSample: this.createBspWebhookPayload(send),
        testWebhookPath: `/webhook-integration/flow-sends/${encodeURIComponent(
          send.id,
        )}/test-webhook`,
      },
    };
  }

  private toSendRecord(
    record: PrismaFlowSend | FlowSendRecord,
  ): FlowSendRecord {
    return {
      ...record,
      status: 'poc_send_created',
      createdAt: this.toIso(record.createdAt),
    };
  }

  private toLegacyFlowTokenResponse(record: PrismaFlowSend | FlowSendRecord) {
    const send = this.toSendRecord(record);

    return {
      id: send.id,
      flowToken: send.flowToken,
      workspaceId: send.workspaceId,
      workspacePublicId: send.workspacePublicId,
      formId: send.formId,
      flowId: send.flowId,
      recipientPhone: send.recipientPhone,
      ylyncWebhookUrl: send.ylyncWebhookUrl,
      platformWebhookUrl: this.createWebhookUrl(
        send.provider,
        send.workspacePublicId,
      ),
      createdAt: send.createdAt,
      whatsappSendPayload: this.createWhatsAppSendPayload(send),
      metaWebhookSample: this.createMetaWebhookPayload(send),
      bspWebhookSample: this.createBspWebhookPayload(send),
      testWebhookPath: `/webhook-integration/flow-tokens/${encodeURIComponent(
        send.flowToken,
      )}/test-webhook`,
    };
  }

  private async sendTestWebhookForRecord(
    record: PrismaFlowSend | FlowSendRecord,
    input: TestWebhookInput = {},
  ) {
    const send = this.toSendRecord(record);
    const ylyncWebhookUrl = this.normalizeUrl(
      input.ylyncWebhookUrl || send.ylyncWebhookUrl,
    );
    const source = input.source === 'bsp' ? 'bsp' : 'meta';
    const payload =
      source === 'bsp'
        ? this.createBspWebhookPayload(send, input.answers)
        : this.createMetaWebhookPayload(send, input.answers);
    const secret =
      this.clean(input.webhookSecret) || this.resolveWebhookSecret();
    const response = await fetch(ylyncWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'x-webhook-secret': secret } : {}),
      },
      body: JSON.stringify(payload),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const responseBody: unknown = contentType.includes('application/json')
      ? ((await response.json()) as unknown)
      : await response.text();

    return {
      ok: response.ok,
      status: response.status,
      ylyncWebhookUrl,
      source,
      sendId: send.id,
      formId: send.formId,
      sentPayload: payload,
      ylyncResponse: responseBody,
    };
  }

  private createWhatsAppSendPayload(record: FlowSendRecord) {
    return {
      messaging_product: 'whatsapp',
      to: record.recipientPhone,
      type: 'interactive',
      interactive: {
        type: 'flow',
        action: {
          name: 'flow',
          parameters: {
            flow_id: record.flowId,
            flow_token: record.flowToken,
          },
        },
      },
    };
  }

  private createMetaWebhookPayload(
    record: FlowSendRecord,
    answers: Record<string, unknown> = DEFAULT_ANSWERS,
  ) {
    return {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: record.workspacePublicId,
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                contacts: [
                  {
                    wa_id: record.recipientPhone,
                    profile: { name: 'Form-Zap PoC User' },
                  },
                ],
                messages: [
                  {
                    from: record.recipientPhone,
                    id: `wamid.${record.flowToken}`,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'interactive',
                    interactive: {
                      type: 'nfm_reply',
                      nfm_reply: {
                        flow_token: record.flowToken,
                        flow_id: record.flowId,
                        response_json: JSON.stringify(answers),
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
  }

  private createBspWebhookPayload(
    record: FlowSendRecord,
    answers: Record<string, unknown> = DEFAULT_ANSWERS,
  ) {
    return {
      event_type: 'flow.completed',
      flow_id: record.flowId,
      flow_token: record.flowToken,
      contact: {
        wa_id: record.recipientPhone,
        name: 'Form-Zap PoC User',
      },
      response: answers,
      timestamp: new Date().toISOString(),
    };
  }

  private normalizeProviderPayload(
    payload: unknown,
    provider: string,
    workspacePublicId: string,
    rawEventId: string,
  ): NormalizedFlowEvent[] {
    const metaEvents = this.normalizeMetaPayload(
      payload,
      provider,
      workspacePublicId,
      rawEventId,
    );

    if (metaEvents.length > 0) {
      return metaEvents;
    }

    const genericEvent = this.normalizeGenericPayload(
      payload,
      provider,
      workspacePublicId,
      rawEventId,
    );

    return genericEvent ? [genericEvent] : [];
  }

  private normalizeMetaPayload(
    payload: unknown,
    provider: string,
    workspacePublicId: string,
    rawEventId: string,
  ): NormalizedFlowEvent[] {
    const root = this.asRecord(payload);
    const events: NormalizedFlowEvent[] = [];

    if (!root || !Array.isArray(root.entry)) {
      return events;
    }

    for (const entry of root.entry) {
      const entryRecord = this.asRecord(entry);

      if (!entryRecord || !Array.isArray(entryRecord.changes)) {
        continue;
      }

      for (const change of entryRecord.changes) {
        const value = this.asRecord(this.asRecord(change)?.value);

        if (!value || !Array.isArray(value.messages)) {
          continue;
        }

        const contact = this.firstRecord(value.contacts);
        const contactName = this.clean(
          this.asRecord(contact?.profile)?.name as string,
        );
        const contactPhone = this.clean(contact?.wa_id as string);

        for (const message of value.messages) {
          const messageRecord = this.asRecord(message);
          const interactive = this.asRecord(messageRecord?.interactive);
          const nfmReply = this.asRecord(interactive?.nfm_reply);

          if (
            !messageRecord ||
            !nfmReply ||
            interactive?.type !== 'nfm_reply'
          ) {
            continue;
          }

          const responseJson = this.parseResponseJson(nfmReply.response_json);
          const flowToken =
            this.clean(nfmReply.flow_token as string) ||
            this.clean(responseJson.flow_token as string);
          const flowId =
            this.clean(nfmReply.flow_id as string) ||
            this.clean(responseJson.flow_id as string) ||
            this.clean(responseJson.form_id as string);
          const answers = this.stripRoutingFields(responseJson);

          events.push({
            type: 'flow.completed',
            provider,
            workspacePublicId,
            rawEventId,
            messageId: this.clean(messageRecord.id as string),
            flowId,
            flowToken,
            contactPhone:
              this.clean(messageRecord.from as string) || contactPhone,
            contactName,
            answers,
            occurredAt: this.timestampToIso(messageRecord.timestamp),
          });
        }
      }
    }

    return events;
  }

  private normalizeGenericPayload(
    payload: unknown,
    provider: string,
    workspacePublicId: string,
    rawEventId: string,
  ): NormalizedFlowEvent | null {
    const root = this.asRecord(payload);

    if (!root) {
      return null;
    }

    const response =
      this.asRecord(root.response) ||
      this.asRecord(root.answers) ||
      this.asRecord(root.response_payload) ||
      this.parseResponseJson(root.response_json);
    const contact = this.asRecord(root.contact) || this.asRecord(root.customer);
    const flowId =
      this.clean(root.flow_id as string) || this.clean(root.flowId as string);
    const flowToken =
      this.clean(root.flow_token as string) ||
      this.clean(root.flowToken as string) ||
      this.clean(response.flow_token as string);

    if (!flowId && !flowToken && Object.keys(response).length === 0) {
      return null;
    }

    return {
      type:
        root.event_type === 'flow.completed' ||
          root.event === 'flow_completed' ||
          root.type === 'flow.completed'
          ? 'flow.completed'
          : 'provider.event',
      provider,
      workspacePublicId,
      rawEventId,
      messageId:
        this.clean(root.message_id as string) ||
        this.clean(root.messageId as string) ||
        this.clean(root.id as string),
      flowId: flowId || this.clean(response.flow_id as string),
      flowToken,
      contactPhone:
        this.clean(contact?.wa_id as string) ||
        this.clean(contact?.phone as string) ||
        this.clean(root.from as string) ||
        this.clean(root.whatsapp_user as string),
      contactName:
        this.clean(contact?.name as string) || this.clean(root.name as string),
      answers: this.stripRoutingFields(response),
      occurredAt:
        this.clean(root.timestamp as string) || new Date().toISOString(),
    };
  }

  private async storeFlowEvent(
    event: NormalizedFlowEvent,
  ): Promise<FlowEventRecord> {
    const mappedForm = await this.findMappedForm(event);
    const record = await this.prisma.flowEvent.create({
      data: {
        type: event.type,
        provider: event.provider,
        workspacePublicId: event.workspacePublicId,
        rawEventId: event.rawEventId,
        messageId: event.messageId || null,
        flowId: event.flowId || null,
        flowToken: event.flowToken || null,
        contactPhone: event.contactPhone || null,
        contactName: event.contactName || null,
        answers: this.toInputJson(event.answers),
        occurredAt: this.toDate(event.occurredAt),
        formIntegrationId: mappedForm?.id,
        formId: mappedForm?.formId,
        mapped: Boolean(mappedForm),
      },
    });
    const flowEvent = this.toFlowEventRecord(record);

    if (mappedForm && event.type === 'flow.completed') {
      await this.storeSubmission(flowEvent, mappedForm);
      await this.prisma.formIntegration.update({
        where: { id: mappedForm.id },
        data: {
          connectionStatus: 'connected',
          publishStatus: 'published_connected',
          lastResponseAt: this.toDate(event.occurredAt),
        },
      });
    }

    return flowEvent;
  }

  private async storeSubmission(
    event: FlowEventRecord,
    form: FormIntegrationRecord,
  ): Promise<FlowSubmissionRecord> {
    const idempotencyKey = this.createIdempotencyKey(event);
    const existingSubmission = await this.prisma.flowSubmission.findUnique({
      where: { idempotencyKey },
    });

    if (existingSubmission) {
      return this.toSubmissionRecord(existingSubmission);
    }

    const submission = await this.prisma.flowSubmission.create({
      data: {
        idempotencyKey,
        flowEventId: event.id,
        formIntegrationId: form.id,
        workspaceId: form.workspaceId,
        workspacePublicId: form.workspacePublicId,
        formId: form.formId,
        formName: form.formName,
        provider: event.provider,
        flowId: event.flowId || null,
        flowToken: event.flowToken || null,
        contactPhone: event.contactPhone || null,
        contactName: event.contactName || null,
        answers: this.toInputJson(event.answers),
        submittedAt: this.toDate(event.occurredAt),
      },
    });
    
    // Attempt to append to Google Sheets
    // The numberId is not explicitly tied to the submission but we can pass a dummy string 
    // or let googleSheetsService search by formId instead. 
    // In google-sheets.service.ts, we updated appendRow to search just by formId and workspacePublicId.
    this.googleSheetsService.appendRow(
      form.workspacePublicId, 
      form.formId, 
      '', 
      [submission.id, submission.contactPhone || 'Unknown', submission.submittedAt.toISOString(), JSON.stringify(event.answers)]
    ).catch(e => console.error('Error appending to Google Sheets', e));

    return this.toSubmissionRecord(submission);
  }

  private async findMappedForm(event: NormalizedFlowEvent) {
    if (event.flowToken) {
      const send = await this.prisma.flowSend.findUnique({
        where: { flowToken: event.flowToken },
      });

      if (send) {
        const form = await this.prisma.formIntegration.findUnique({
          where: {
            workspaceId_formId: {
              workspaceId: send.workspaceId,
              formId: send.formId,
            },
          },
        });

        if (form) {
          return this.toFormRecord(form);
        }
      }
    }

    if (event.flowId) {
      const exactProviderForm = await this.prisma.formIntegration.findUnique({
        where: {
          workspacePublicId_provider_flowId: {
            workspacePublicId: event.workspacePublicId,
            provider: event.provider,
            flowId: event.flowId,
          },
        },
      });

      if (exactProviderForm) {
        return this.toFormRecord(exactProviderForm);
      }

      const fallbackForm = await this.prisma.formIntegration.findFirst({
        where: {
          workspacePublicId: event.workspacePublicId,
          flowId: event.flowId,
        },
      });

      if (fallbackForm) {
        return this.toFormRecord(fallbackForm);
      }
    }

    const formIdFromAnswers =
      this.clean(event.answers?.form_id as string) ||
      this.clean(event.answers?.formId as string);

    if (formIdFromAnswers) {
      const formByFormId = await this.prisma.formIntegration.findFirst({
        where: {
          workspacePublicId: event.workspacePublicId,
          formId: formIdFromAnswers,
        },
      });

      if (formByFormId) {
        return this.toFormRecord(formByFormId);
      }
    }

    return undefined;
  }

  private async findSendById(sendId: string) {
    const record = await this.prisma.flowSend.findUnique({
      where: { id: sendId },
    });

    if (!record) {
      throw new NotFoundException('Send session was not found.');
    }

    return record;
  }

  private toFlowEventRecord(record: PrismaFlowEvent): FlowEventRecord {
    return {
      id: record.id,
      type: record.type as FlowEventRecord['type'],
      provider: record.provider,
      workspacePublicId: record.workspacePublicId,
      rawEventId: record.rawEventId,
      messageId: record.messageId || undefined,
      flowId: record.flowId || undefined,
      flowToken: record.flowToken || undefined,
      contactPhone: record.contactPhone || undefined,
      contactName: record.contactName || undefined,
      answers: this.asRecord(record.answers) || {},
      occurredAt: this.toIso(record.occurredAt),
      formIntegrationId: record.formIntegrationId || undefined,
      formId: record.formId || undefined,
      mapped: record.mapped,
    };
  }

  private toSubmissionRecord(
    record: PrismaFlowSubmission,
  ): FlowSubmissionRecord {
    return {
      id: record.id,
      idempotencyKey: record.idempotencyKey,
      flowEventId: record.flowEventId,
      formIntegrationId: record.formIntegrationId,
      workspaceId: record.workspaceId,
      workspacePublicId: record.workspacePublicId,
      formId: record.formId,
      formName: record.formName,
      provider: record.provider,
      flowId: record.flowId || undefined,
      flowToken: record.flowToken || undefined,
      contactPhone: record.contactPhone || undefined,
      contactName: record.contactName || undefined,
      answers: this.asRecord(record.answers) || {},
      submittedAt: this.toIso(record.submittedAt),
    };
  }

  private createFormKey(workspaceId: string, formId: string) {
    return `${workspaceId}:${formId}`;
  }

  private createMappingKey(
    workspacePublicId: string,
    provider: string,
    flowId: string,
  ) {
    return `${workspacePublicId}:${provider}:${flowId}`.toLowerCase();
  }

  private createIdempotencyKey(event: FlowEventRecord) {
    return (
      [
        event.provider,
        event.workspacePublicId,
        event.messageId || '',
        event.flowToken || '',
        event.flowId || '',
        event.contactPhone || '',
      ]
        .filter(Boolean)
        .join(':') || event.id
    );
  }

  private createFlowToken(workspacePublicId: string, formId: string) {
    const workspacePart = workspacePublicId.replace(/[^a-zA-Z0-9]/g, '');
    const formPart = formId.replace(/[^a-zA-Z0-9]/g, '');

    return `flw_zap_${workspacePart}_${formPart}_${Date.now().toString(
      36,
    )}_${randomBytes(4).toString('hex')}`;
  }

  private createWebhookUrl(provider: string, workspacePublicId: string) {
    return `${this.resolvePublicApiBaseUrl()}/webhooks/${encodeURIComponent(
      provider,
    )}/${encodeURIComponent(workspacePublicId)}`;
  }

  private createWorkspacePublicId(workspaceId: string) {
    if (workspaceId.startsWith('ws_')) {
      return workspaceId;
    }

    return workspaceId === DEFAULT_WORKSPACE_ID
      ? DEFAULT_WORKSPACE_PUBLIC_ID
      : workspaceId;
  }

  private resolvePublicApiBaseUrl() {
    return (
      this.clean(process.env.FORM_ZAP_PUBLIC_API_URL) ||
      this.clean(process.env.PUBLIC_API_BASE_URL) ||
      `http://localhost:${process.env.PORT ?? 4200}`
    ).replace(/\/$/, '');
  }

  private resolveYlyncWebhookUrl() {
    return (
      this.clean(process.env.YLYNC_WEBHOOK_URL) ||
      this.clean(process.env.SNEW_WEBHOOK_URL) ||
      'http://localhost:5000/api/v1/webhook/poc/receive'
    );
  }

  private resolveWebhookSecret() {
    return (
      this.clean(process.env.YLYNC_WEBHOOK_SECRET) ||
      this.clean(process.env.SNEW_WEBHOOK_SECRET) ||
      ''
    );
  }

  private resolveIncomingWebhookSecret() {
    return (
      this.clean(process.env.FORM_ZAP_WEBHOOK_SECRET) ||
      this.clean(process.env.WEBHOOK_SECRET) ||
      ''
    );
  }

  private resolveVerifyToken() {
    return (
      this.clean(process.env.FORM_ZAP_META_VERIFY_TOKEN) ||
      this.clean(process.env.META_VERIFY_TOKEN) ||
      ''
    );
  }

  private verifyIncomingSecret(
    headers: Record<string, string | string[] | undefined> = {},
  ) {
    const secret = this.resolveIncomingWebhookSecret();

    if (!secret) {
      return;
    }

    const provided =
      this.getHeader(headers, 'x-webhook-secret') ||
      this.getHeader(headers, 'x-flowform-secret');

    if (provided !== secret) {
      throw new UnauthorizedException('Invalid webhook secret.');
    }
  }

  private getHeader(
    headers: Record<string, string | string[] | undefined>,
    name: string,
  ) {
    const headerKey = Object.keys(headers).find(
      (key) => key.toLowerCase() === name.toLowerCase(),
    );
    const headerValue = headerKey ? headers[headerKey] : undefined;

    return Array.isArray(headerValue) ? headerValue[0] : headerValue;
  }

  private normalizePublishStatus(value?: string | null) {
    const status = this.clean(value) as FlowPublishStatus;
    const statuses: FlowPublishStatus[] = [
      'draft',
      'ready_to_publish',
      'exported',
      'awaiting_flow_id',
      'flow_id_added',
      'published_connected',
    ];

    return statuses.includes(status) ? status : undefined;
  }

  private resolvePublishStatus(
    requestedStatus: FlowPublishStatus | undefined,
    flowId: string,
    existingStatus?: string | null,
  ): FlowPublishStatus {
    if (requestedStatus === 'draft') {
      return 'draft';
    }

    if (
      requestedStatus === 'flow_id_added' ||
      requestedStatus === 'published_connected'
    ) {
      if (!flowId) {
        throw new BadRequestException('Flow ID is required before publishing.');
      }

      return requestedStatus;
    }

    if (
      requestedStatus === 'ready_to_publish' ||
      requestedStatus === 'exported' ||
      requestedStatus === 'awaiting_flow_id'
    ) {
      return flowId ? 'flow_id_added' : 'awaiting_flow_id';
    }

    if (flowId) {
      return existingStatus === 'published_connected'
        ? 'published_connected'
        : 'flow_id_added';
    }

    return existingStatus === 'ready_to_publish' ||
      existingStatus === 'exported' ||
      existingStatus === 'awaiting_flow_id'
      ? 'awaiting_flow_id'
      : 'draft';
  }

  private resolveConnectionStatus(
    requestedStatus: string | undefined,
    publishStatus: FlowPublishStatus,
    existingStatus?: string | null,
  ): FlowConnectionStatus {
    const status = this.clean(requestedStatus) as FlowConnectionStatus;
    const statuses: FlowConnectionStatus[] = [
      'not_configured',
      'webhook_pending',
      'connected',
      'failed',
      'disconnected',
    ];

    if (statuses.includes(status)) {
      return status;
    }

    if (publishStatus === 'draft') {
      return 'not_configured';
    }

    if (publishStatus === 'published_connected') {
      return 'connected';
    }

    return existingStatus === 'connected' ? 'connected' : 'webhook_pending';
  }

  private normalizeProvider(value?: string | null) {
    return (this.clean(value) || DEFAULT_PROVIDER).toLowerCase();
  }

  private normalizeUrl(value: string) {
    try {
      const url = new URL(value);

      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Unsupported protocol.');
      }

      return url.toString();
    } catch {
      throw new BadRequestException(
        'Webhook URL must be a valid HTTP or HTTPS URL.',
      );
    }
  }

  private parseResponseJson(value: unknown): Record<string, unknown> {
    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value) as unknown;

        return this.asRecord(parsed) || {};
      } catch {
        return {};
      }
    }

    return this.asRecord(value) || {};
  }

  private stripRoutingFields(value: Record<string, unknown>) {
    const { flow_id, flowId, flow_token, flowToken, form_id, formId, ...answers } = value;

    void flow_id;
    void flowId;
    void flow_token;
    void flowToken;
    void form_id;
    void formId;

    return answers;
  }

  private timestampToIso(value: unknown) {
    if (typeof value === 'string' && /^\d+$/.test(value)) {
      return new Date(Number(value) * 1000).toISOString();
    }

    if (typeof value === 'number') {
      return new Date(value * 1000).toISOString();
    }

    return new Date().toISOString();
  }

  private firstRecord(value: unknown) {
    return Array.isArray(value) ? this.asRecord(value[0]) : undefined;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private toInputJson(value: unknown): Prisma.InputJsonValue {
    if (value === undefined || value === null) {
      return {};
    }

    return value as Prisma.InputJsonValue;
  }

  private countFlowScreens(flowJson: unknown) {
    const screens = this.asRecord(flowJson)?.screens;

    return Array.isArray(screens) ? screens.length : 0;
  }

  private toPositiveInt(value: unknown) {
    const numberValue =
      typeof value === 'number' ? value : Number.parseInt(String(value), 10);

    return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : 0;
  }

  private toDate(value: Date | string | undefined) {
    if (value instanceof Date) {
      return value;
    }

    const parsed = value ? new Date(value) : new Date();

    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  private toIso(value: Date | string) {
    return value instanceof Date ? value.toISOString() : value;
  }

  private clean(value?: string | null) {
    return typeof value === 'string' ? value.trim() : '';
  }
}
