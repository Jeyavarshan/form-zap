import { WebhookIntegrationService } from './webhook-integration.service';

function createPrismaMock() {
  const forms: Record<string, any>[] = [];
  const sends: Record<string, any>[] = [];
  const webhookEvents: Record<string, any>[] = [];
  const flowEvents: Record<string, any>[] = [];
  const submissions: Record<string, any>[] = [];
  let id = 0;

  const nextId = (prefix: string) => `${prefix}_${++id}`;
  const now = () => new Date();
  const findForm = (where: Record<string, any>) => {
    if (where.id) {
      return forms.find((form) => form.id === where.id) ?? null;
    }

    if (where.workspaceId_formId) {
      return (
        forms.find(
          (form) =>
            form.workspaceId === where.workspaceId_formId.workspaceId &&
            form.formId === where.workspaceId_formId.formId,
        ) ?? null
      );
    }

    if (where.workspacePublicId_provider_flowId) {
      return (
        forms.find(
          (form) =>
            form.workspacePublicId ===
              where.workspacePublicId_provider_flowId.workspacePublicId &&
            form.provider ===
              where.workspacePublicId_provider_flowId.provider &&
            form.flowId === where.workspacePublicId_provider_flowId.flowId,
        ) ?? null
      );
    }

    return null;
  };

  return {
    formIntegration: {
      findMany: jest.fn(async () => forms),
      findUnique: jest.fn(async ({ where }) => findForm(where)),
      findFirst: jest.fn(async ({ where }) => {
        return (
          forms.find(
            (form) =>
              form.workspacePublicId === where.workspacePublicId &&
              form.flowId === where.flowId,
          ) ?? null
        );
      }),
      upsert: jest.fn(async ({ where, create, update }) => {
        const existing = findForm(where);

        if (existing) {
          Object.assign(existing, update, { updatedAt: now() });
          return existing;
        }

        const record = {
          id: nextId('form'),
          ...create,
          lastResponseAt: null,
          createdAt: now(),
          updatedAt: now(),
        };
        forms.push(record);
        return record;
      }),
      update: jest.fn(async ({ where, data }) => {
        const record = findForm(where);

        if (!record) {
          throw new Error('Form not found');
        }

        Object.assign(record, data, { updatedAt: now() });
        return record;
      }),
    },
    flowSend: {
      create: jest.fn(async ({ data }) => {
        const record = {
          id: nextId('send'),
          ...data,
          createdAt: now(),
        };
        sends.push(record);
        return record;
      }),
      findMany: jest.fn(async () => sends),
      findUnique: jest.fn(async ({ where }) => {
        return (
          sends.find(
            (send) =>
              send.id === where.id || send.flowToken === where.flowToken,
          ) ?? null
        );
      }),
    },
    webhookEvent: {
      create: jest.fn(async ({ data }) => {
        const record = {
          id: nextId('raw'),
          ...data,
          receivedAt: now(),
        };
        webhookEvents.push(record);
        return record;
      }),
      update: jest.fn(async ({ where, data }) => {
        const record =
          webhookEvents.find((event) => event.id === where.id) ?? null;

        if (!record) {
          throw new Error('Webhook event not found');
        }

        Object.assign(record, data);
        return record;
      }),
      findMany: jest.fn(async () => webhookEvents),
    },
    flowEvent: {
      create: jest.fn(async ({ data }) => {
        const record = {
          id: nextId('event'),
          ...data,
          createdAt: now(),
        };
        flowEvents.push(record);
        return record;
      }),
      findMany: jest.fn(async () => flowEvents),
    },
    flowSubmission: {
      findMany: jest.fn(async () => submissions),
      findUnique: jest.fn(async ({ where }) => {
        return (
          submissions.find(
            (submission) => submission.idempotencyKey === where.idempotencyKey,
          ) ?? null
        );
      }),
      create: jest.fn(async ({ data }) => {
        const record = {
          id: nextId('submission'),
          ...data,
          createdAt: now(),
        };
        submissions.push(record);
        return record;
      }),
    },
  };
}

describe('WebhookIntegrationService', () => {
  let service: WebhookIntegrationService;

  beforeEach(() => {
    service = new WebhookIntegrationService(createPrismaMock() as never);
  });

  it('stores a created form as a draft before a Flow ID exists', async () => {
    const flowJson = {
      version: '6.3',
      screens: [{ id: 'screen_1', title: 'Lead Details' }],
    };

    const result = await service.saveFormMapping({
      workspaceId: 'workspace-1',
      workspacePublicId: 'ws_1',
      formId: 'lead-form',
      formName: 'Lead Form',
      publishStatus: 'draft',
      connectionStatus: 'not_configured',
      flowJson,
      screenCount: 1,
      ylyncWebhookUrl: 'http://localhost:5000/api/v1/webhook/poc/receive',
    });

    expect(result).toMatchObject({
      formId: 'lead-form',
      formName: 'Lead Form',
      flowId: '',
      flowJson,
      screenCount: 1,
      publishStatus: 'draft',
      connectionStatus: 'not_configured',
    });
  });

  it('stores the Meta flow mapping in Form-Zap without customer DB changes', async () => {
    const result = await service.saveFormMapping({
      workspaceId: 'workspace-1',
      formId: 'appointment',
      formName: 'Appointment',
      flowId: 'flow-123',
      ylyncWebhookUrl: 'http://localhost:5000/api/v1/webhook/poc/receive',
    });

    expect(result).toMatchObject({
      workspaceId: 'workspace-1',
      workspacePublicId: 'workspace-1',
      formId: 'appointment',
      formName: 'Appointment',
      provider: 'meta',
      flowId: 'flow-123',
      publishStatus: 'flow_id_added',
      connectionStatus: 'webhook_pending',
      customerDatabaseChanged: false,
      trackingOwner: 'Form-Zap',
    });
    expect(result.providerWebhookUrl).toBe(
      'http://localhost:4200/webhooks/meta/workspace-1',
    );
  });

  it('auto-stamps a hidden token when sending a Form-Zap form', async () => {
    const result = await service.sendFormFlow({
      workspaceId: 'workspace-1',
      formId: 'appointment',
      flowId: 'flow-123',
      recipientPhone: '919876543210',
      ylyncWebhookUrl: 'http://localhost:5000/api/v1/webhook/poc/receive',
    });

    expect(result.tracking).toMatchObject({
      storedBy: 'Form-Zap',
      customerDatabaseChanged: false,
      customerManuallyHandlesFlowToken: false,
    });
    expect(result.debug.flowToken).toMatch(/^flw_zap_/);
    expect(
      result.debug.whatsappSendPayload.interactive.action.parameters,
    ).toMatchObject({
      flow_id: 'flow-123',
      flow_token: result.debug.flowToken,
    });
  });

  it('returns the same token inside Meta webhook samples', async () => {
    const result = await service.sendFormFlow({
      flowId: 'flow-456',
      ylyncWebhookUrl: 'http://localhost:5000/api/v1/webhook/poc/receive',
    });

    const message =
      result.debug.metaWebhookSample.entry[0].changes[0].value.messages[0];

    expect(message.interactive.nfm_reply).toMatchObject({
      flow_id: 'flow-456',
      flow_token: result.debug.flowToken,
    });
  });

  it('maps a generic completed webhook by flow_id and stores a submission', async () => {
    await service.saveFormMapping({
      workspaceId: 'workspace-1',
      workspacePublicId: 'ws_1',
      formId: 'appointment',
      formName: 'Appointment',
      provider: 'generic',
      flowId: 'flow-123',
      ylyncWebhookUrl: 'http://localhost:5000/api/v1/webhook/poc/receive',
    });

    const result = await service.receiveWebhook({
      provider: 'generic',
      workspacePublicId: 'ws_1',
      payload: {
        event_type: 'flow.completed',
        flow_id: 'flow-123',
        flow_token: 'token-123',
        contact: { wa_id: '919876543210', name: 'Test User' },
        response: { date: '2026-06-20', slot: '9 AM' },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      eventCount: 1,
      mappedCount: 1,
      unmappedCount: 0,
      processingStatus: 'processed',
    });
    expect(await service.listSubmissions()).toHaveLength(1);
    expect((await service.listForms())[0]).toMatchObject({
      connectionStatus: 'connected',
      publishStatus: 'published_connected',
    });
  });

  it('keeps wrong flow_id webhooks as unmapped events', async () => {
    await service.saveFormMapping({
      workspaceId: 'workspace-1',
      workspacePublicId: 'ws_1',
      formId: 'appointment',
      provider: 'meta',
      flowId: 'flow-123',
      ylyncWebhookUrl: 'http://localhost:5000/api/v1/webhook/poc/receive',
    });

    const result = await service.receiveWebhook({
      provider: 'meta',
      workspacePublicId: 'ws_1',
      payload: {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: '919876543210',
                      id: 'wamid.test',
                      timestamp: '1781694000',
                      type: 'interactive',
                      interactive: {
                        type: 'nfm_reply',
                        nfm_reply: {
                          flow_id: 'wrong-flow',
                          response_json: JSON.stringify({ answer: 'Yes' }),
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    });

    expect(result).toMatchObject({
      eventCount: 1,
      mappedCount: 0,
      unmappedCount: 1,
    });
    expect(await service.listSubmissions()).toHaveLength(0);
  });
});
