export interface GeoExtractionResult {
  shouldEmit: boolean;
  payload?: {
    country_code: string;
    city?: string;
    language_codes?: string[];
    currency_code?: string;
    tax_model?: string;
    payment_preferences?: Record<string, unknown>;
    legal_flags?: string[];
    communication_norms?: Record<string, unknown>;
    confidence?: number;
    assertion_source: 'user_stated' | 'system_inferred' | 'externally_researched';
  };
  question?: string;
}

function detectCountryCode(textRaw: string): string | null {
  const text = textRaw.toLowerCase();

  const pairs: Array<[string[], string]> = [
    [['sweden', 'sverige'], 'SE'],
    [['turkey', 'turkiet', 'türkiye', 'turkiye'], 'TR'],
  ];

  for (const [terms, code] of pairs) {
    if (terms.some((t) => text.includes(t))) {
      return code;
    }
  }

  return null;
}

function defaultGeoForCountry(countryCode: string) {
  switch (countryCode) {
    case 'SE':
      return {
        language_codes: ['sv-SE'],
        currency_code: 'SEK',
        tax_model: 'vat',
        payment_preferences: { swish: true, klarna: true, cards: true },
        legal_flags: ['gdpr'],
        communication_norms: { tone: 'direct', formality: 'medium' },
      };
    case 'TR':
      return {
        language_codes: ['tr-TR'],
        currency_code: 'TRY',
        tax_model: 'vat',
        payment_preferences: { iyzico: true, cash: true, cards: true },
        legal_flags: [],
        communication_norms: { tone: 'warm', formality: 'medium' },
      };
    case 'US':
      return {
        language_codes: ['en-US'],
        currency_code: 'USD',
        tax_model: 'sales_tax',
        payment_preferences: { cards: true, apple_pay: true, google_pay: true },
        legal_flags: [],
        communication_norms: { tone: 'direct', formality: 'low' },
      };
    default:
      return {
        language_codes: [],
        payment_preferences: {},
        legal_flags: [],
        communication_norms: {},
      };
  }
}

export function extractGeoFromText(text: string): GeoExtractionResult {
  const countryCode = detectCountryCode(text);

  if (!countryCode) {
    return {
      shouldEmit: false,
      question: 'Which country are you operating in? (Use ISO code like SE / TR / US, or just say the country name.)',
    };
  }

  const defaults = defaultGeoForCountry(countryCode);

  return {
    shouldEmit: true,
    payload: {
      country_code: countryCode,
      ...defaults,
      confidence: 0.7,
      assertion_source: 'system_inferred',
    },
  };
}
