import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';

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
}

@Injectable()
export class AiBuilderService {
  private readonly genAI: GoogleGenerativeAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new InternalServerErrorException('GEMINI_API_KEY is not configured.');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async generateForm(input: AiGenerationInput): Promise<AiGenerationResult> {
    const { prompt, settings = {} } = input;

    if (!prompt || prompt.trim().length < 5) {
      throw new BadRequestException('Prompt is too short. Please describe your form in more detail.');
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
    console.log('--- RAW GEMINI RESPONSE ---');
    console.log(responseText);
    console.log('---------------------------');

    return this.parseAndValidateResponse(responseText);
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

    const screenCount = parseInt(screens, 10) || 4;

    return `You are an expert WhatsApp Flow form designer. Generate a valid WhatsApp Flow JSON (version 6.3) based on the user's request.

USER REQUEST: "${userPrompt}"

GENERATION SETTINGS:
- Form Type: ${formType}
- Number of screens: ${screenCount}
- Language: ${language}
- Tone: ${tone}
- Include consent checkbox: ${includeConsent}
- Include confirmation screen: ${includeConfirmation}
- Include API data exchange: ${includeApiExchange}

WHATSAPP FLOW JSON RULES:
1. Version must be "6.3"
2. data_api_version must be "3.0"
3. Each screen needs: id (UPPER_SNAKE_CASE), title, layout with type "SingleColumnLayout"
4. Valid component types: TextHeading, TextSubheading, TextBody, TextInput, TextArea, CheckboxGroup, RadioButtonsGroup, Dropdown, DatePicker, Image, Footer
5. Footer is REQUIRED on every screen - last screen uses on-click-action name "complete", others use "navigate"
6. For navigate: include "next": {"name": "NEXT_SCREEN_ID"} in on-click-action
7. TextInput requires: label, input-type (text/number/email/phone/password), name (unique)
8. Dropdown requires: label, name, data-source array with id/title pairs
9. RadioButtonsGroup requires: label, name, data-source array with id/title pairs
10. CheckboxGroup requires: label, name, data-source array with id/title pairs
11. DatePicker requires: label, name
12. routing_model maps each screen ID to an array of next screen IDs
13. The last screen must have "terminal": true
14. All field "name" values must be unique across all screens

Return ONLY a valid JSON object with this EXACT structure (no markdown, no extra text):
{
  "summary": "Brief description of the generated form",
  "screens": [
    { "name": "Screen Name", "fields": 3 }
  ],
  "fields": 12,
  "validationRules": 4,
  "suggestions": [
    "Improvement suggestion 1",
    "Improvement suggestion 2",
    "Improvement suggestion 3"
  ],
  "flowJson": {
    "version": "6.3",
    "data_api_version": "3.0",
    "name": "Form Name",
    "categories": ["APPOINTMENT_BOOKING"],
    "routing_model": {},
    "screens": []
  }
}

IMPORTANT: The flowJson must be a complete, valid WhatsApp Flow JSON. Generate real fields relevant to the user's request. Do not use placeholder content.`;
  }

  private parseAndValidateResponse(responseText: string): AiGenerationResult {
    let parsed: AiGenerationResult;
    let cleaned = '';

    try {
      // Strip any accidental markdown fences if present
      cleaned = responseText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

      parsed = JSON.parse(cleaned) as AiGenerationResult;
    } catch (e) {
      console.error('JSON Parse Error:', e);
      console.error('Cleaned string that failed to parse:', cleaned || responseText);
      throw new InternalServerErrorException('AI returned an invalid response. Please try again.');
    }

    // Basic validation
    if (!parsed.flowJson || !parsed.summary || !Array.isArray(parsed.screens)) {
      throw new InternalServerErrorException('AI response is missing required fields. Please try again.');
    }

    // Ensure screens array matches flowJson screens
    const flowScreens = (parsed.flowJson.screens as Array<{ id: string; title: string }>) || [];
    if (parsed.screens.length === 0 && flowScreens.length > 0) {
      parsed.screens = flowScreens.map((s) => ({ name: s.title || s.id, fields: 1 }));
    }

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
