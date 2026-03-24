type CountryCode = 'SE' | 'NO' | 'DK' | 'FI' | 'TR' | 'AE' | 'SA';

export type GeoDefaults = {
  countryCode: CountryCode;
  countryName: string;
  currencyCode: string;
  taxModel: string;
  languageCodes: string[];
  vatRate: number;
  paymentPreferences: Record<string, unknown>;
  legalFlags: string[];
  communicationNorms: Record<string, unknown>;
};

const MAP: Record<CountryCode, GeoDefaults> = {
  SE: {
    countryCode: 'SE',
    countryName: 'Sweden',
    currencyCode: 'SEK',
    taxModel: 'vat',
    languageCodes: ['sv-SE'],
    vatRate: 0.25,
    paymentPreferences: { swish: true, klarna: true, card: true },
    legalFlags: ['gdpr', 'pul'],
    communicationNorms: { tone: 'direct', style: 'low_context' },
  },
  NO: {
    countryCode: 'NO',
    countryName: 'Norway',
    currencyCode: 'NOK',
    taxModel: 'vat',
    languageCodes: ['nb-NO'],
    vatRate: 0.25,
    paymentPreferences: { vipps: true, card: true },
    legalFlags: ['gdpr'],
    communicationNorms: { tone: 'direct', style: 'low_context' },
  },
  DK: {
    countryCode: 'DK',
    countryName: 'Denmark',
    currencyCode: 'DKK',
    taxModel: 'vat',
    languageCodes: ['da-DK'],
    vatRate: 0.25,
    paymentPreferences: { mobilepay: true, card: true },
    legalFlags: ['gdpr'],
    communicationNorms: { tone: 'direct', style: 'low_context' },
  },
  FI: {
    countryCode: 'FI',
    countryName: 'Finland',
    currencyCode: 'EUR',
    taxModel: 'vat',
    languageCodes: ['fi-FI'],
    vatRate: 0.24,
    paymentPreferences: { mobilepay: true, card: true },
    legalFlags: ['gdpr'],
    communicationNorms: { tone: 'direct', style: 'low_context' },
  },
  TR: {
    countryCode: 'TR',
    countryName: 'Turkey',
    currencyCode: 'TRY',
    taxModel: 'vat',
    languageCodes: ['tr-TR'],
    vatRate: 0.2,
    paymentPreferences: { iban: true, card: true },
    legalFlags: ['kvkk'],
    communicationNorms: { tone: 'warm', style: 'high_context' },
  },
  AE: {
    countryCode: 'AE',
    countryName: 'United Arab Emirates',
    currencyCode: 'AED',
    taxModel: 'vat',
    languageCodes: ['ar-AE', 'en'],
    vatRate: 0.05,
    paymentPreferences: { card: true, cash: true },
    legalFlags: [],
    communicationNorms: { tone: 'warm', style: 'high_context' },
  },
  SA: {
    countryCode: 'SA',
    countryName: 'Saudi Arabia',
    currencyCode: 'SAR',
    taxModel: 'vat',
    languageCodes: ['ar-SA', 'en'],
    vatRate: 0.15,
    paymentPreferences: { card: true, stc_pay: true },
    legalFlags: [],
    communicationNorms: { tone: 'warm', style: 'high_context' },
  },
};

export function normalizeCountryCode(value: string | null): CountryCode | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  return upper === 'SE' || upper === 'NO' || upper === 'DK' || upper === 'FI' || upper === 'TR' || upper === 'AE' || upper === 'SA'
    ? (upper as CountryCode)
    : null;
}

export function defaultsForCountry(countryCode: string | null): GeoDefaults | null {
  const normalized = normalizeCountryCode(countryCode);
  if (!normalized) return null;
  return MAP[normalized] ?? null;
}

export function priceForCountrySEK(baseSek: number, countryCode: string | null) {
  // Intentionally simple for MVP: local-market anchoring by country.
  // These are placeholders until benchmark/pricing research arrives.
  const c = normalizeCountryCode(countryCode);
  if (!c) {
    return { amount: baseSek, currency: 'SEK' };
  }

  switch (c) {
    case 'SE':
      return { amount: baseSek, currency: 'SEK' };
    case 'NO':
      return { amount: Math.round(baseSek * 1.05), currency: 'NOK' };
    case 'DK':
      return { amount: Math.round(baseSek * 0.7), currency: 'DKK' };
    case 'FI':
      return { amount: Math.round(baseSek * 0.09), currency: 'EUR' };
    case 'TR':
      return { amount: Math.round(baseSek * 3.2), currency: 'TRY' };
    case 'AE':
      return { amount: Math.round(baseSek * 0.35), currency: 'AED' };
    case 'SA':
      return { amount: Math.round(baseSek * 0.33), currency: 'SAR' };
  }
}
