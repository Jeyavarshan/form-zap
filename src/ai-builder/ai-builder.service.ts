import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { WalletService } from '../wallet/wallet.service';

export interface AiGenerationSettings {
  formType?: 'Static' | 'Dynamic';
  screens?: string;
  language?: string;
  tone?: string;
  includeConsent?: boolean;
  includeConfirmation?: boolean;
  includeApiExchange?: boolean;
}

export interface AiGenerationInput {
  workspaceId: string;
  prompt: string;
  settings?: AiGenerationSettings;
}

export interface GeneratedScreen {
  name: string;
  fields: number;
}

export interface AiGenerationResult {
  summary: string;
  screens: GeneratedScreen[];
  fields: number;
  validationRules: number;
  suggestions: string[];
  flowJson: Record<string, unknown>;
  inputTokens?: number;
  outputTokens?: number;
  creditsCharged?: number;
}

@Injectable()
export class AiBuilderService {
  private readonly genAI: GoogleGenerativeAI;

  constructor(private readonly walletService: WalletService) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new InternalServerErrorException('GEMINI_API_KEY is not configured.');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async generateForm(input: AiGenerationInput): Promise<AiGenerationResult> {
    const { prompt, settings = {} } = input;
    const workspace = await this.walletService.ensureWorkspace(input.workspaceId || 'ws_default');
    const workspaceId = workspace.id;

    if (!prompt || prompt.trim().length < 5) {
      throw new BadRequestException('Prompt is too short. Please describe your form in more detail.');
    }

    // Pre-check balance before calling Gemini API
    const balance = await this.walletService.getBalance(workspaceId);
    if (balance.totalBalance < 1) {
      throw new BadRequestException('ai_credits_exhausted');
    }

    const model = this.genAI.getGenerativeModel({
      model: 'gemini-flash-latest',
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    });

    const systemPrompt = this.buildSystemPrompt(prompt, settings);
    const result = await model.generateContent(systemPrompt);
    const responseText = result.response.text();
    
    const usage = result.response.usageMetadata;
    const inputTokens = usage?.promptTokenCount || 0;
    const outputTokens = usage?.candidatesTokenCount || 0;
    
    const deductResult = await this.walletService.deductCredits(workspaceId, inputTokens, outputTokens, { action: 'ai_form_generation' });

    console.log('--- RAW GEMINI RESPONSE ---');
    console.log(responseText);
    console.log('---------------------------');

    const parsed = this.parseAndValidateResponse(responseText);
    return {
      ...parsed,
      inputTokens,
      outputTokens,
      creditsCharged: deductResult.charged,
    };
  }

  private buildSystemPrompt(userPrompt: string, settings: AiGenerationSettings): string {
    const {
      formType = 'Dynamic',
      screens = '4',
      language = 'English',
      tone = 'Professional',
      includeConsent = true,
      includeConfirmation = true,
      includeApiExchange = false,
    } = settings;

    const screenCount = Math.max(1, parseInt(screens, 10) || 4);

    return `# SYSTEM INSTRUCTIONS FOR GEMINI / AI FORM BUILDER

You are an expert AI Assistant specializing in generating official Meta WhatsApp Flow JSON schemas (v6.3 specification). Your goal is to convert user requirements into valid, production-ready WhatsApp Flow JSON objects compatible with Meta Business Platform.

USER REQUEST: "${userPrompt}"
- Form Type: ${formType}
- Target Screens Count: ${screenCount}
- Language: ${language}
- Tone: ${tone}
- Include consent checkbox: ${includeConsent}
- Include confirmation screen: ${includeConfirmation}
- Include API data exchange: ${includeApiExchange}

---

## CRITICAL METADATA RULE
DO NOT include root-level "name" or "categories" properties in the flowJson object. The JSON schema must strictly match Meta's expected Flow structure.

---

## METADATA & ROOT STRUCTURE REQUIREMENT
Every valid WhatsApp Flow JSON MUST follow this exact root structure inside flowJson:

\`\`\`json
{
  "version": "6.3",
  "data_api_version": "3.0",
  "routing_model": {
    "SCREEN_A": ["SCREEN_B"],
    "SCREEN_B": []
  },
  "screens": [
    {
      "id": "SCREEN_A",
      "title": "Screen Title",
      "layout": {
        "type": "SingleColumnLayout",
        "children": []
      }
    }
  ]
}
\`\`\`

---

## ROUTING & NAVIGATION RULES
1. **Screen IDs**: Must be uppercase strings (e.g. SCREEN_A, APPLICANT_DETAILS, LOAN_DETAILS, CONFIRMATION_SCREEN).
2. **Terminal Screen**: The last screen MUST point to an empty array [] in routing_model.
3. **On-Click Actions**: Every navigate action MUST explicitly include "type": "screen" in the next block:
   \`\`\`json
   "on-click-action": {
     "name": "navigate",
     "next": {
       "type": "screen",
       "name": "NEXT_SCREEN_ID"
     }
   }
   \`\`\`
4. **Footer / Complete Action**: The final screen's submit button MUST trigger data payload completion:
   \`\`\`json
   "on-click-action": {
     "name": "complete",
     "payload": {
       "form_id": "generated_form",
       "flow_token": "\${flow_token}"
     }
   }
   \`\`\`

---

## SUPPORTED COMPONENTS & SYNTAX

### 1. Layout Header & Typography
- **TextHeading**: { "type": "TextHeading", "text": "Header Title" }
- **TextSubheading**: { "type": "TextSubheading", "text": "Subheading text" }
- **TextBody**: { "type": "TextBody", "text": "Body description here" }

### 2. Inputs
- **TextInput**:
  {
    "type": "TextInput",
    "name": "full_name",
    "label": "Full Legal Name",
    "input-type": "text",
    "required": true
  }
  Allowed input-type values: "text", "phone", "email", "number", "password", "time".

- **TextArea**:
  {
    "type": "TextArea",
    "name": "comments",
    "label": "Additional Comments",
    "required": false
  }

### 3. Selectors
- **Dropdown**:
  {
    "type": "Dropdown",
    "name": "employment_type",
    "label": "Employment Type",
    "required": true,
    "data-source": [
      { "id": "salaried", "title": "Salaried" },
      { "id": "self_employed", "title": "Self Employed" }
    ]
  }

- **RadioButtonsGroup**:
  {
    "type": "RadioButtonsGroup",
    "name": "loan_term",
    "label": "Loan Term",
    "required": true,
    "data-source": [
      { "id": "12", "title": "12 Months" },
      { "id": "24", "title": "24 Months" }
    ]
  }

- **CheckboxGroup**:
  {
    "type": "CheckboxGroup",
    "name": "preferences",
    "label": "Select Preferences",
    "required": false,
    "data-source": [
      { "id": "email_updates", "title": "Email Updates" },
      { "id": "sms_updates", "title": "SMS Updates" }
    ]
  }

- **DatePicker**:
  {
    "type": "DatePicker",
    "name": "date_of_birth",
    "label": "Date of Birth",
    "required": true
  }

### 4. Buttons & Footer
- **Footer Button**:
  {
    "type": "Footer",
    "label": "Continue",
    "on-click-action": {
      "name": "navigate",
      "next": {
        "type": "screen",
        "name": "NEXT_SCREEN_ID"
      }
    }
  }

---

## OUTPUT FORMAT REQUIREMENTS
Return a single JSON object containing:
{
  "summary": "Brief description of the generated form",
  "screens": [
    { "name": "Screen 1 Title", "fields": 3 }
  ],
  "fields": 10,
  "validationRules": 4,
  "suggestions": [
    "Improvement suggestion 1",
    "Improvement suggestion 2"
  ],
  "flowJson": {
    "version": "6.3",
    "data_api_version": "3.0",
    "routing_model": {},
    "screens": []
  }
}

Return ONLY valid raw JSON. Do not include markdown code block backticks outside of requested formatted JSON responses.`;
  }

  private parseAndValidateResponse(responseText: string): AiGenerationResult {
    let parsed: AiGenerationResult;
    let cleaned = '';

    try {
      cleaned = responseText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

      parsed = JSON.parse(cleaned) as AiGenerationResult;
    } catch (e) {
      console.error('JSON Parse Error:', e);
      console.error('Cleaned string that failed to parse:', cleaned || responseText);
      throw new InternalServerErrorException('AI returned an invalid response format. Please try again.');
    }

    if (!parsed.flowJson || !parsed.summary || !Array.isArray(parsed.screens)) {
      throw new InternalServerErrorException('AI response is missing required fields. Please try again.');
    }

    const flowJson = parsed.flowJson as Record<string, any>;
    flowJson.version = '6.3';
    flowJson.data_api_version = '3.0';

    // DO NOT include root-level name or categories properties
    delete flowJson.name;
    delete flowJson.categories;

    const flowScreens = Array.isArray(flowJson.screens) ? flowJson.screens : [];
    const validComponents = new Set([
      'TextHeading',
      'TextSubheading',
      'TextBody',
      'TextCaption',
      'TextInput',
      'TextArea',
      'Dropdown',
      'RadioButtonsGroup',
      'CheckboxGroup',
      'DatePicker',
      'Image',
      'Footer',
    ]);
    const validInputs = new Set(['text', 'number', 'email', 'phone', 'password', 'time']);

    const routingModel: Record<string, string[]> = {};

    flowScreens.forEach((screen: any, idx: number) => {
      const isLast = idx === flowScreens.length - 1;
      const screenId = (screen.id || `SCREEN_${String.fromCharCode(65 + idx)}`).toUpperCase();
      screen.id = screenId;

      if (!screen.layout || screen.layout.type !== 'SingleColumnLayout') {
        screen.layout = { type: 'SingleColumnLayout', children: screen.layout?.children || [] };
      }

      if (isLast) {
        screen.terminal = true;
        routingModel[screenId] = [];
      } else {
        const nextId = (flowScreens[idx + 1]?.id || `SCREEN_${String.fromCharCode(66 + idx)}`).toUpperCase();
        routingModel[screenId] = [nextId];
      }

      const children = Array.isArray(screen.layout.children) ? screen.layout.children : [];
      let hasFooter = false;

      screen.layout.children = children.filter((child: any) => {
        if (!child || !child.type || !validComponents.has(child.type)) {
          return false;
        }

        if (child.type === 'TextInput') {
          if (!child['input-type'] || !validInputs.has(child['input-type'])) {
            child['input-type'] = 'text';
          }
        }

        if (['Dropdown', 'RadioButtonsGroup', 'CheckboxGroup'].includes(child.type)) {
          if (!Array.isArray(child['data-source']) || child['data-source'].length === 0) {
            child['data-source'] = [
              { id: 'opt_1', title: 'Option 1' },
              { id: 'opt_2', title: 'Option 2' },
            ];
          }
        }

        if (child.type === 'Footer') {
          hasFooter = true;
          if (isLast) {
            child['on-click-action'] = {
              name: 'complete',
              payload: child['on-click-action']?.payload || {
                form_id: 'generated_form',
                flow_token: '${flow_token}',
              },
            };
          } else {
            const nextId = (flowScreens[idx + 1]?.id || `SCREEN_${String.fromCharCode(66 + idx)}`).toUpperCase();
            child['on-click-action'] = {
              name: 'navigate',
              next: {
                type: 'screen',
                name: nextId,
              },
            };
          }
        }

        return true;
      });

      if (!hasFooter) {
        if (isLast) {
          screen.layout.children.push({
            type: 'Footer',
            label: 'Submit',
            'on-click-action': {
              name: 'complete',
              payload: {
                form_id: 'generated_form',
                flow_token: '${flow_token}',
              },
            },
          });
        } else {
          const nextId = (flowScreens[idx + 1]?.id || `SCREEN_${String.fromCharCode(66 + idx)}`).toUpperCase();
          screen.layout.children.push({
            type: 'Footer',
            label: 'Continue',
            'on-click-action': {
              name: 'navigate',
              next: {
                type: 'screen',
                name: nextId,
              },
            },
          });
        }
      }
    });

    flowJson.routing_model = routingModel;

    parsed.screens = flowScreens.map((s: any) => ({
      name: s.title || s.id,
      fields: Array.isArray(s.layout?.children)
        ? s.layout.children.filter((c: any) => c.type !== 'Footer' && !c.type.startsWith('Text')).length
        : 1,
    }));

    if (!parsed.suggestions) {
      parsed.suggestions = [];
    }

    if (typeof parsed.fields !== 'number') {
      parsed.fields = parsed.screens.reduce((sum, s) => sum + (s.fields || 0), 0);
    }

    if (typeof parsed.validationRules !== 'number') {
      parsed.validationRules = Math.ceil(parsed.fields / 2);
    }

    return parsed;
  }
}
