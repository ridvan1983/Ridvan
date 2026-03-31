import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import { getAPIKey } from '~/lib/.server/llm/api-key';

export type NormalizedIndustry =
  | 'hair_salon'
  | 'restaurant'
  | 'gym'
  | 'legal_firm'
  | 'law_firm'
  | 'hotel'
  | 'clinic'
  | 'real_estate'
  | 'bakery'
  | 'beauty'
  | 'ecommerce'
  | 'e_commerce'
  | 'food_delivery'
  | 'consultant'
  | 'school'
  | 'education'
  | 'auto_repair'
  | 'accounting'
  | 'event_planning'
  | 'photography'
  | 'saas'
  | 'unknown';

const ALLOWED_INDUSTRIES = [
  'hair_salon',
  'restaurant',
  'gym',
  'legal_firm',
  'law_firm',
  'hotel',
  'clinic',
  'real_estate',
  'bakery',
  'beauty',
  'ecommerce',
  'e_commerce',
  'food_delivery',
  'consultant',
  'school',
  'education',
  'auto_repair',
  'accounting',
  'event_planning',
  'photography',
  'saas',
] as const satisfies readonly NormalizedIndustry[];

function extractJsonObject(raw: string) {
  const trimmed = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('[RIDVAN-E1256] AI extraction response did not contain valid JSON');
  }

  return trimmed.slice(start, end + 1);
}

function normalizeIndustryLabel(value: unknown): NormalizedIndustry | null {
  const lower = typeof value === 'string' ? value.trim().toLowerCase() : '';

  if (!lower) {
    return null;
  }

  if ((ALLOWED_INDUSTRIES as readonly string[]).includes(lower)) {
    return lower as NormalizedIndustry;
  }

  if (lower === 'e-commerce') {
    return 'e_commerce';
  }

  if (lower === 'legal') {
    return 'law_firm';
  }

  if (
    lower === 'restaurant' ||
    lower === 'italian restaurant' ||
    lower === 'food service' ||
    lower === 'food-service' ||
    lower === 'dining' ||
    lower === 'cafe' ||
    lower === 'café' ||
    lower === 'bistro' ||
    lower === 'pizzeria'
  ) {
    return 'restaurant';
  }

  if (lower === 'hair salon' || lower === 'salon' || lower === 'hairdresser' || lower === 'barbershop' || lower === 'barber') {
    return 'hair_salon';
  }

  if (lower === 'law office' || lower === 'lawyer' || lower === 'attorney' || lower === 'legal services') {
    return 'law_firm';
  }

  if (lower === 'medical clinic' || lower === 'doctor' || lower === 'dentist' || lower === 'healthcare') {
    return 'clinic';
  }

  if (lower === 'fitness' || lower === 'fitness center' || lower === 'fitness studio' || lower === 'training gym') {
    return 'gym';
  }

  if (lower === 'real estate agency' || lower === 'property' || lower === 'property agency' || lower === 'brokerage') {
    return 'real_estate';
  }

  if (lower === 'online store' || lower === 'webshop' || lower === 'ecommerce store') {
    return 'e_commerce';
  }

  if (lower === 'accountant' || lower === 'bookkeeping' || lower === 'bookkeeper') {
    return 'accounting';
  }

  if (lower === 'event planner' || lower === 'events' || lower === 'wedding planner') {
    return 'event_planning';
  }

  if (lower === 'photographer' || lower === 'photo studio') {
    return 'photography';
  }

  return null;
}

function parseGeoHint(text: string) {
  const regexes = [
    /\bi\s+([\p{L}][\p{L}\p{M}'’\-\s]{1,60})/iu,
    /\bin\s+([\p{L}][\p{L}\p{M}'’\-\s]{1,60})/iu,
    /\bdi\s+([\p{L}][\p{L}\p{M}'’\-\s]{1,60})/iu,
    /\bв\s+([\p{L}][\p{L}\p{M}'’\-\s]{1,60})/iu,
  ];

  for (const regex of regexes) {
    const match = text.match(regex);
    const value = match?.[1]?.trim();

    if (value) {
      return value.replace(/[,.!?;:]+$/g, '').trim();
    }
  }

  return null;
}

async function runAiExtraction(prompt: string) {
  const apiKey = getAPIKey() ?? '';

  if (!apiKey) {
    return null;
  }

  const anthropic = createAnthropic({ apiKey });
  const result = await generateText({
    model: anthropic('claude-sonnet-4-5-20250929'),
    temperature: 0,
    maxTokens: 220,
    prompt,
  });

  return JSON.parse(extractJsonObject(result.text)) as Record<string, unknown>;
}

export async function extractGeo(text: string): Promise<string | null> {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  const regexGeo = parseGeoHint(trimmed);

  try {
    const parsed = await runAiExtraction(`Extract the city and country from this text.
Return only valid JSON with this shape:
{ "city": string | null, "country": string | null }
If unknown, use null.
Text: ${JSON.stringify(trimmed)}`);

    const city = typeof parsed?.city === 'string' ? parsed.city.trim() : '';
    const country = typeof parsed?.country === 'string' ? parsed.country.trim() : '';

    if (city && country) {
      return `${city}, ${country}`;
    }

    if (city) {
      return city;
    }

    if (country) {
      return country;
    }
  } catch {
    // ignore and use regex fallback below
  }

  return regexGeo;
}

export async function extractIndustryAndGeo(prompt: string): Promise<{ industry: NormalizedIndustry | null; geo: string | null }> {
  const trimmed = prompt.trim();

  if (!trimmed) {
    return { industry: null, geo: null };
  }

  const heuristicIndustry = normalizeIndustry(trimmed);

  try {
    const parsed = await runAiExtraction(`Identify the business type and location from this text.
Return only valid JSON with this shape:
{ "industry": string | null, "geo": string | null }
Use simple English industry names from this allowed set only:
hair_salon, restaurant, gym, clinic, e_commerce, ecommerce, hotel, law_firm, legal_firm, real_estate, bakery, beauty, food_delivery, consultant, school, education, auto_repair, accounting, event_planning, photography, saas.
If unknown, use null.
Text: ${JSON.stringify(trimmed)}`);

    const mappedIndustry = normalizeIndustryLabel(parsed?.industry);

    return {
      industry: mappedIndustry ?? (heuristicIndustry.normalizedIndustry !== 'unknown' ? heuristicIndustry.normalizedIndustry : null),
      geo: typeof parsed?.geo === 'string' && parsed.geo.trim().length > 0 ? parsed.geo.trim() : await extractGeo(trimmed),
    };
  } catch {
    return {
      industry: heuristicIndustry.normalizedIndustry !== 'unknown' ? heuristicIndustry.normalizedIndustry : null,
      geo: await extractGeo(trimmed),
    };
  }
}

export function normalizeIndustry(raw: string): { normalizedIndustry: NormalizedIndustry; confidence: number; subIndustry: string | null } {
  const text = raw.toLowerCase();

  const contains = (terms: string[]) => terms.some((t) => text.includes(t));

  if (contains(['frisör', 'frisörsalong', 'hair salon', 'hairdresser', 'salong', 'salon', 'klippning', 'klippa håret', 'haircut'])) {
    const sub =
      contains(['barber', 'barbershop', 'herrfrisör'])
        ? 'barber'
        : contains(['nails', 'naglar', 'manikyr', 'pedikyr'])
          ? 'nail_salon'
          : contains(['lash', 'lashes', 'brow', 'brows', 'fransar', 'bryn'])
            ? 'lash_brow'
            : contains(['spa', 'massage', 'beauty'])
              ? 'beauty_spa'
              : null;

    return { normalizedIndustry: 'hair_salon', confidence: 0.86, subIndustry: sub };
  }

  if (contains(['hotel', 'hotell', 'boende', 'logi', 'bed and breakfast', 'bnb', 'hostel', 'guesthouse', 'gästhus'])) {
    const sub =
      contains(['bed and breakfast', 'bnb'])
        ? 'bed_and_breakfast'
        : contains(['hostel'])
          ? 'hostel'
          : contains(['boutique'])
            ? 'boutique_hotel'
            : null;

    return { normalizedIndustry: 'hotel', confidence: 0.84, subIndustry: sub };
  }

  if (
    contains([
      'clinic',
      'klinik',
      'vårdcentral',
      'läkare',
      'doktor',
      'tandläkare',
      'dentist',
      'fysioterapeut',
      'naprapat',
      'kiropraktor',
      'physio',
      'chiropractor',
      'medical practice',
    ])
  ) {
    const sub =
      contains(['tandläkare', 'dentist'])
        ? 'dentistry'
        : contains(['fysioterapeut', 'physio'])
          ? 'physiotherapy'
          : contains(['naprapat', 'kiropraktor', 'chiropractor'])
            ? 'manual_therapy'
            : contains(['vårdcentral', 'läkare', 'doktor'])
              ? 'primary_care'
              : null;

    return { normalizedIndustry: 'clinic', confidence: 0.84, subIndustry: sub };
  }

  if (contains(['mäklare', 'fastighet', 'bostad', 'hyresvärd', 'property', 'real estate', 'listing', 'valuation'])) {
    const sub =
      contains(['hyresvärd'])
        ? 'property_management'
        : contains(['mäklare', 'real estate'])
          ? 'brokerage'
          : null;

    return { normalizedIndustry: 'real_estate', confidence: 0.82, subIndustry: sub };
  }

  if (contains(['bageri', 'konditori', 'fika', 'tårta', 'pastry', 'bakery'])) {
    const sub =
      contains(['konditori', 'pastry', 'tårta'])
        ? 'pastry_shop'
        : contains(['café', 'cafe', 'kafé', 'fika'])
          ? 'bakery_cafe'
          : null;

    return { normalizedIndustry: 'bakery', confidence: 0.8, subIndustry: sub };
  }

  if (
    contains([
      'skönhet',
      'naglar',
      'nagelstudio',
      'makeup',
      'ögonfransar',
      'lash',
      'spa',
      'massage',
      'hudvård',
      'beauty',
      'wellness',
    ])
  ) {
    const sub =
      contains(['naglar', 'nagelstudio'])
        ? 'nail_studio'
        : contains(['ögonfransar', 'lash'])
          ? 'lash_studio'
          : contains(['spa', 'massage'])
            ? 'spa'
            : contains(['hudvård'])
              ? 'skincare'
              : contains(['makeup'])
                ? 'makeup_studio'
                : null;

    return { normalizedIndustry: 'beauty', confidence: 0.84, subIndustry: sub };
  }

  if (
    contains([
      'restaurant',
      'restaurang',
      'cafe',
      'café',
      'kafé',
      'pizzeria',
      'pizza',
      'bistro',
      'brunch',
      'table booking',
      'bordsbokning',
      'reservation',
      'book a table',
      'takeaway',
      'take away',
      'take-out',
      'pickup',
      'delivery',
      'leverans',
    ])
  ) {
    const sub =
      contains(['pizzeria', 'pizza'])
        ? 'pizzeria'
        : contains(['cafe', 'café', 'kafé'])
          ? 'cafe'
          : contains(['fine dining', 'tasting menu', 'avsmakningsmeny'])
            ? 'fine_dining'
            : contains(['takeaway', 'take away', 'pickup'])
              ? 'takeaway'
              : contains(['delivery', 'leverans'])
                ? 'delivery'
                : null;

    return { normalizedIndustry: 'restaurant', confidence: 0.86, subIndustry: sub };
  }

  if (contains(['matleverans', 'food delivery', 'foodora', 'matbud', 'leverans', 'uber eats', 'wolt'])) {
    const sub = contains(['foodora', 'uber eats', 'wolt']) ? 'marketplace_delivery' : contains(['matbud']) ? 'courier_delivery' : null;

    return { normalizedIndustry: 'food_delivery', confidence: 0.82, subIndustry: sub };
  }

  if (
    contains([
      'gym',
      'fitness',
      'pt',
      'personal trainer',
      'personlig tränare',
      'träning',
      'träningsstudio',
      'classes',
      'klass',
      'klasser',
      'yoga',
      'pilates',
      'crossfit',
      'boxing',
      'bokning',
      'pass',
    ])
  ) {
    const sub =
      contains(['yoga'])
        ? 'yoga_studio'
        : contains(['pilates'])
          ? 'pilates_studio'
          : contains(['crossfit'])
            ? 'crossfit_box'
            : contains(['boxing'])
              ? 'boxing_gym'
              : contains(['pt', 'personal trainer', 'personlig tränare'])
                ? 'pt_studio'
                : null;

    return { normalizedIndustry: 'gym', confidence: 0.82, subIndustry: sub };
  }

  if (
    contains([
      'law',
      'legal',
      'attorney',
      'advokat',
      'jurist',
      'law firm',
      'advokatbyrå',
      'compliance',
      'contract',
      'kontrakt',
      'immigration',
      'migration',
      'family law',
      'familjerätt',
      'employment law',
      'arbetsrätt',
      'corporate',
      'bolagsrätt',
    ])
  ) {
    const sub =
      contains(['immigration', 'migration'])
        ? 'immigration'
        : contains(['family law', 'familjerätt'])
          ? 'family'
          : contains(['employment law', 'arbetsrätt'])
            ? 'employment'
            : contains(['corporate', 'bolagsrätt', 'contract', 'kontrakt'])
              ? 'corporate'
              : null;

    return { normalizedIndustry: 'legal_firm', confidence: 0.84, subIndustry: sub };
  }

  if (contains(['advokat', 'jurist', 'law firm', 'juridik', 'rättshjälp', 'lawyer'])) {
    return { normalizedIndustry: 'law_firm', confidence: 0.84, subIndustry: null };
  }

  if (contains(['e-handel', 'webshop', 'nätbutik', 'online store', 'ecommerce', 'e-commerce', 'klädbutik', 'modebutik'])) {
    const sub = contains(['klädbutik', 'modebutik']) ? 'fashion_retail' : contains(['online store']) ? 'online_store' : null;

    return { normalizedIndustry: 'e_commerce', confidence: 0.8, subIndustry: sub };
  }

  if (contains(['webshop', 'butik', 'näthandel', 'shop', 'store', 'ecommerce', 'e-commerce', 'checkout', 'cart', 'kassa', 'handel'])) {
    return { normalizedIndustry: 'ecommerce', confidence: 0.75, subIndustry: null };
  }

  if (contains(['utbildning', 'kurs', 'skola', 'lärande', 'education', 'academy', 'elearning', 'e-learning'])) {
    const sub = contains(['academy']) ? 'academy' : contains(['kurs']) ? 'course_business' : contains(['elearning', 'e-learning']) ? 'digital_learning' : null;

    return { normalizedIndustry: 'education', confidence: 0.78, subIndustry: sub };
  }

  if (contains(['bilverkstad', 'mekaniker', 'bilservice', 'däck', 'verkstad', 'auto repair'])) {
    const sub = contains(['däck']) ? 'tire_service' : contains(['bilservice']) ? 'car_service' : null;

    return { normalizedIndustry: 'auto_repair', confidence: 0.8, subIndustry: sub };
  }

  if (contains(['redovisning', 'bokföring', 'revisor', 'accounting', 'lönehantering', 'moms'])) {
    const sub = contains(['revisor']) ? 'audit' : contains(['lönehantering']) ? 'payroll' : null;

    return { normalizedIndustry: 'accounting', confidence: 0.8, subIndustry: sub };
  }

  if (contains(['event', 'bröllop', 'konferens', 'fest', 'evenemang', 'eventplanering'])) {
    const sub = contains(['bröllop']) ? 'wedding' : contains(['konferens']) ? 'conference' : contains(['fest']) ? 'private_event' : null;

    return { normalizedIndustry: 'event_planning', confidence: 0.8, subIndustry: sub };
  }

  if (contains(['fotograf', 'photography', 'bröllopsfoton', 'porträtt', 'fotostudio', 'wedding photographer'])) {
    const sub = contains(['bröllopsfoton', 'wedding photographer']) ? 'wedding' : contains(['porträtt']) ? 'portrait' : contains(['fotostudio']) ? 'studio' : null;

    return { normalizedIndustry: 'photography', confidence: 0.8, subIndustry: sub };
  }

  if (contains(['konsult', 'byrå', 'agency', 'reklambyrå', 'pr', 'kommunikation', 'consultant', 'consulting'])) {
    const sub =
      contains(['pr', 'kommunikation'])
        ? 'communications_agency'
        : contains(['reklambyrå', 'agency'])
          ? 'creative_agency'
          : null;

    return { normalizedIndustry: 'consultant', confidence: 0.78, subIndustry: sub };
  }

  if (contains(['skola', 'utbildning', 'kurs', 'coaching', 'mentor', 'academy', 'school', 'education', 'training program'])) {
    const sub =
      contains(['coaching', 'mentor'])
        ? 'coaching'
        : contains(['academy'])
          ? 'academy'
          : contains(['kurs'])
            ? 'course_business'
            : null;

    return { normalizedIndustry: 'school', confidence: 0.76, subIndustry: sub };
  }

  if (contains(['saas', 'subscription', 'b2b', 'dashboard'])) {
    return { normalizedIndustry: 'saas', confidence: 0.6, subIndustry: null };
  }

  return { normalizedIndustry: 'unknown', confidence: 0.4, subIndustry: null };
}
