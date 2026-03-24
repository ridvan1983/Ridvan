export type NormalizedIndustry =
  | 'hair_salon'
  | 'restaurant'
  | 'gym'
  | 'legal_firm'
  | 'hotel'
  | 'clinic'
  | 'real_estate'
  | 'bakery'
  | 'beauty'
  | 'ecommerce'
  | 'consultant'
  | 'school'
  | 'saas'
  | 'unknown';

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

  if (contains(['webshop', 'butik', 'näthandel', 'shop', 'store', 'ecommerce', 'e-commerce', 'checkout', 'cart', 'kassa', 'handel'])) {
    return { normalizedIndustry: 'ecommerce', confidence: 0.75, subIndustry: null };
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
