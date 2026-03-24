import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { getAPIKey } from '~/lib/.server/llm/api-key';

export interface ProjectIntelligencePrice {
  item: string;
  price: string;
}

export interface ProjectIntelligenceResult {
  businessName: string;
  industry: string;
  city: string;
  whatTheySell: string[];
  prices: ProjectIntelligencePrice[];
  pages: string[];
  activeFeatures: string[];
  missingFeatures: string[];
  targetAudience: string;
  toneOfVoice: string;
  revenueOpportunities: string[];
}

function asTrimmedString(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .map((item) => asTrimmedString(item))
    .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index)
    .slice(0, 20);
}

function asPriceArray(value: unknown): ProjectIntelligencePrice[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        return null;
      }

      const item = asTrimmedString((row as Record<string, unknown>).item);
      const price = asTrimmedString((row as Record<string, unknown>).price);

      if (!item || !price) {
        return null;
      }

      return { item, price };
    })
    .filter((row): row is ProjectIntelligencePrice => Boolean(row))
    .slice(0, 20);
}

function extractJsonObject(raw: string) {
  const trimmed = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('[RIDVAN-E2011] Project intelligence response did not contain valid JSON');
  }

  return trimmed.slice(start, end + 1);
}

function normalizeProjectIntelligence(value: unknown): ProjectIntelligenceResult {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

  return {
    businessName: asTrimmedString(source.businessName),
    industry: asTrimmedString(source.industry),
    city: asTrimmedString(source.city),
    whatTheySell: asStringArray(source.whatTheySell),
    prices: asPriceArray(source.prices),
    pages: asStringArray(source.pages),
    activeFeatures: asStringArray(source.activeFeatures),
    missingFeatures: asStringArray(source.missingFeatures),
    targetAudience: asTrimmedString(source.targetAudience),
    toneOfVoice: asTrimmedString(source.toneOfVoice),
    revenueOpportunities: asStringArray(source.revenueOpportunities),
  };
}

export async function analyzeProject(args: { projectId: string; userId: string; htmlContent: string; env: Env }) {
  const apiKey = getAPIKey(args.env) ?? '';

  if (!apiKey) {
    throw new Error('[RIDVAN-E2012] Missing ANTHROPIC_API_KEY for project intelligence');
  }

  const anthropic = createAnthropic({ apiKey });
  const htmlContent = args.htmlContent.trim().slice(0, 120_000);

  if (!htmlContent) {
    throw new Error('[RIDVAN-E2013] Missing HTML content for project intelligence');
  }

  const prompt = `Analysera denna webbplats och extrahera som JSON:
{
  "businessName": string,
  "industry": string,
  "city": string,
  "whatTheySell": string[],
  "prices": [{ "item": string, "price": string }],
  "pages": string[],
  "activeFeatures": string[],
  "missingFeatures": string[],
  "targetAudience": string,
  "toneOfVoice": string,
  "revenueOpportunities": string[]
}
Returnera endast JSON, inga backticks.

Projekt-ID: ${args.projectId}
Användar-ID: ${args.userId}

HTML:
${htmlContent}`;

  const result = await generateText({
    model: anthropic('claude-sonnet-4-5-20250929'),
    temperature: 0,
    maxTokens: 1400,
    prompt,
  });

  const parsed = JSON.parse(extractJsonObject(result.text)) as unknown;
  return normalizeProjectIntelligence(parsed);
}
