/**
 * Static vertical expert packs for Mentor system prompts (additive).
 */

export type ExpertVerticalKey =
  | 'restaurant'
  | 'beauty_salon'
  | 'healthcare_clinic'
  | 'ecommerce'
  | 'saas_b2b'
  | 'real_estate'
  | 'fitness_gym'
  | 'education'
  | 'finance_fintech'
  | 'legal_professional'
  | 'general';

type Competitor = { name: string; strengths: string; weaknesses: string };

type ExpertPack = {
  label: string;
  competitors: Competitor[];
  marketSize: string;
  commonModels: string[];
  scalingChallenges: string[];
  successFactors: string[];
};

const PACKS: Record<ExpertVerticalKey, ExpertPack> = {
  restaurant: {
    label: 'Restaurant / Food',
    competitors: [
      { name: 'Yelp', strengths: 'Discovery, reviews at scale', weaknesses: 'Weak on real-time reservations; noisy review signal' },
      { name: 'OpenTable', strengths: 'Reservation network for premium dining', weaknesses: 'Costly for independents; US-centric legacy UX' },
      { name: 'Tripadvisor', strengths: 'Tourism-driven traffic', weaknesses: 'Broad travel focus; less operational depth for locals' },
    ],
    marketSize: 'Global restaurant tech TAM is tens of billions USD with mid–high single-digit CAGR; local delivery and bookings still fragment by city.',
    commonModels: ['Commission per cover', 'SaaS subscription per venue', 'Marketplace take rate on orders', 'White-label for chains'],
    scalingChallenges: ['Thin margins', 'POS integrations', 'Peak-hour reliability', 'Multi-language menus', 'Staff churn and training'],
    successFactors: ['Instant booking confirmation', 'No-show reduction', 'CRM and repeat visits', 'Clear SEO for "[city] + cuisine]"', 'Partnerships with local influencers'],
  },
  beauty_salon: {
    label: 'Beauty / Salon',
    competitors: [
      { name: 'Bokadirekt', strengths: 'Dominant Nordic discovery + booking', weaknesses: 'UX debt; pricing pressure on small salons' },
      { name: 'Treatwell', strengths: 'Broad EU marketplace', weaknesses: 'Take rate and promo dependency' },
      { name: 'Timma', strengths: 'Nordic SMB focus', weaknesses: 'Smaller network than incumbents' },
    ],
    marketSize: 'Beauty services software is a multi-billion EUR market in Europe with steady growth in online booking share.',
    commonModels: ['Monthly SaaS per chair/location', 'Marketplace fee per booking', 'Retail product upsell', 'Staff commission tools'],
    scalingChallenges: ['Calendar complexity', 'Staff permissions', 'Reminders and no-shows', 'Retail inventory', 'Brand vs chain rollouts'],
    successFactors: ['Salon-grade calendar UX', 'Deposit or card-on-file', 'Instagram-ready visuals', 'Clear packages and add-ons', 'Local SEO for neighborhood'],
  },
  healthcare_clinic: {
    label: 'Healthcare / Clinic',
    competitors: [
      { name: 'Doctrin', strengths: 'Triage and async flows in Nordic systems', weaknesses: 'Integration-heavy procurement' },
      { name: 'Kry', strengths: 'Consumer brand and scale', weaknesses: 'Regulatory and margin pressure' },
      { name: 'Doktor.se', strengths: 'Swedish primary-care positioning', weaknesses: 'Competition with public flows' },
    ],
    marketSize: 'Digital front-door and patient engagement spend is growing high single digits to low teens CAGR in Nordics/EU.',
    commonModels: ['Per-clinic SaaS', 'Per-provider seats', 'Transaction fees for video visits', 'B2B2C via insurers'],
    scalingChallenges: ['HIPAA/GDPR and journaling', 'EHR integration', 'Identity and referrals', 'Clinical safety copy', 'Locale-specific billing'],
    successFactors: ['Trust-first UX', 'Clear wait-time expectations', 'Reminder automation', 'Secure messaging', 'Transparent pricing where allowed'],
  },
  ecommerce: {
    label: 'E-commerce',
    competitors: [
      { name: 'Shopify', strengths: 'Ecosystem, apps, payments', weaknesses: 'Fees stack; theme constraints' },
      { name: 'WooCommerce', strengths: 'WordPress flexibility', weaknesses: 'Security/ops burden on merchant' },
      { name: 'Klarna', strengths: 'BNPL conversion', weaknesses: 'Dependency on lender economics' },
    ],
    marketSize: 'Global e-com platform and payments adjacent software is hundreds of billions USD TAM; SMB tools grow with GMV.',
    commonModels: ['Subscription platform', 'Transaction + payment markup', 'Marketplace take rate', 'Fulfillment/3PL upsell'],
    scalingChallenges: ['Returns and CX', 'Cross-border VAT', 'Ad CAC inflation', 'Site speed and Core Web Vitals', 'Fraud'],
    successFactors: ['Fast PDP and checkout', 'Strong merchandising', 'Email/SMS flows', 'Trust badges and reviews', 'Inventory accuracy'],
  },
  saas_b2b: {
    label: 'SaaS / B2B',
    competitors: [
      { name: 'Salesforce', strengths: 'Enterprise CRM depth', weaknesses: 'Cost and complexity' },
      { name: 'HubSpot', strengths: 'Inbound + CRM suite', weaknesses: 'Price ramps at scale' },
      { name: 'Pipedrive', strengths: 'SMB sales simplicity', weaknesses: 'Less extensible than SFDC' },
    ],
    marketSize: 'B2B SaaS spend is large and resilient; vertical SaaS often outgrows horizontal in niche ICPs.',
    commonModels: ['Per-seat ARR', 'Usage-based', 'Hybrid platform + services', 'Partner/channel'],
    scalingChallenges: ['Onboarding time-to-value', 'Churn and expansion', 'Security reviews', 'Multi-tenant roadmap', 'Pricing packaging'],
    successFactors: ['Clear ICP', 'PLG or tight sales motion', 'Integrations', 'SOC2/GDPR story', 'Expansion metrics (NDR)'],
  },
  real_estate: {
    label: 'Real Estate',
    competitors: [
      { name: 'Hemnet', strengths: 'Swedish listing dominance', weaknesses: 'Premium placement costs' },
      { name: 'Booli', strengths: 'Consumer price insight', weaknesses: 'Dependent on listing feeds' },
      { name: 'Blocket', strengths: 'Broad classifieds traffic', weaknesses: 'Generalist, not deep transaction stack' },
    ],
    marketSize: 'Prop-tech in Nordics is niche but high ARPA per agency; portals capture most consumer attention.',
    commonModels: ['SaaS per agent/office', 'Lead resale', 'Premium listings', 'Mortgage/insurance referrals'],
    scalingChallenges: ['MLS/feed access', 'Regulation on ads', 'Mobile map UX', 'Long sales cycles with brokers', 'Data freshness'],
    successFactors: ['Instant valuation hooks', 'Saved searches and alerts', 'Broker workflows', 'High-quality imagery', 'Local SEO'],
  },
  fitness_gym: {
    label: 'Fitness / Gym',
    competitors: [
      { name: 'Wondr', strengths: 'Nordic gym software footprint', weaknesses: 'Feature parity race' },
      { name: 'Mindbody', strengths: 'Wellness scheduling scale', weaknesses: 'US-centric pricing/support perception' },
      { name: 'Gympass', strengths: 'Corporate wellness demand', weaknesses: 'Gym margin tension' },
    ],
    marketSize: 'Gym and studio software market grows with hybrid memberships and corporate wellness.',
    commonModels: ['Monthly SaaS per location', 'Per-member fees', 'Marketplace for classes', 'Hardware upsell'],
    scalingChallenges: ['Access control integrations', 'Class waitlists', 'Churn', 'Multi-location reporting', 'Trainer payroll'],
    successFactors: ['Frictionless booking', 'Retention automations', 'Challenges and community', 'Clear trial offers', 'Wearables optional'],
  },
  education: {
    label: 'Education',
    competitors: [
      { name: 'Skolon', strengths: 'Swedish school licensing', weaknesses: 'Institutional sales cycles' },
      { name: 'Google Classroom', strengths: 'Free distribution', weaknesses: 'Limited monetization for third parties' },
      { name: 'Canvas', strengths: 'Higher-ed LMS depth', weaknesses: 'Heavy implementation' },
    ],
    marketSize: 'EdTech is large globally; Nordics favor procurement-compliant vendors with strong privacy posture.',
    commonModels: ['Per-student licensing', 'Institution site license', 'Freemium to paid content', 'B2B training'],
    scalingChallenges: ['Privacy (students)', 'Accessibility', 'SSO and rostering', 'Seasonal usage', 'Content moderation'],
    successFactors: ['Teacher time savings', 'Parent communication', 'Clear learning outcomes', 'Offline/low-bandwidth modes', 'Regional compliance'],
  },
  finance_fintech: {
    label: 'Finance / Fintech',
    competitors: [
      { name: 'Klarna', strengths: 'BNPL brand and checkout', weaknesses: 'Regulatory and funding costs' },
      { name: 'Swish', strengths: 'Instant P2P/business pay in Sweden', weaknesses: 'Not a full acquiring stack alone' },
      { name: 'Tink', strengths: 'Open banking aggregation', weaknesses: 'Bank API variance' },
    ],
    marketSize: 'Embedded finance and open banking grow double digits; Nordics are early adopters of account-to-account flows.',
    commonModels: ['Interchange + SaaS', 'API usage fees', 'FX spread', 'Credit risk share'],
    scalingChallenges: ['Licensing', 'KYC/AML', 'Fraud models', 'Partner bank SLAs', 'Explainability to users'],
    successFactors: ['Trust and transparency', 'Low-latency payments', 'Strong auth UX', 'Compliance-by-design', 'Clear dispute flows'],
  },
  legal_professional: {
    label: 'Legal / Professional services',
    competitors: [
      { name: 'Clio', strengths: 'Practice management for SMB law', weaknesses: 'Less common in Nordics than US' },
      { name: 'DocuSign', strengths: 'E-sign ubiquity', weaknesses: 'Not matter-centric workflow alone' },
      { name: 'Local bar directories', strengths: 'Trust and referrals', weaknesses: 'Poor digital intake' },
    ],
    marketSize: 'Professional services software is sticky; high LTV per firm with slow switching.',
    commonModels: ['Per-seat SaaS', 'Matter-based billing', 'Retainer + utilization tracking', 'Template marketplace'],
    scalingChallenges: ['Ethics and advertising rules', 'Confidentiality', 'Conflict checks', 'Time tracking adoption', 'Multi-jurisdiction content'],
    successFactors: ['Intake speed', 'Clear scope and pricing', 'Template quality', 'Audit trails', 'Calendar/deadline alerts'],
  },
  general: {
    label: 'General / mixed',
    competitors: [
      { name: 'Horizontal SaaS leaders', strengths: 'Ecosystem', weaknesses: 'Not tailored to niche ICP' },
      { name: 'Local agencies', strengths: 'Relationships', weaknesses: 'Poor product velocity' },
      { name: 'DIY spreadsheets', strengths: 'Zero marginal cost', weaknesses: 'No scale or reliability' },
    ],
    marketSize: 'Varies by niche — assume you must size TAM bottom-up from ICP count × ACV.',
    commonModels: ['SaaS subscription', 'Usage-based', 'Marketplace take rate', 'Services + software'],
    scalingChallenges: ['ICP drift', 'CAC payback', 'Retention', 'Hiring', 'Regulatory surprises'],
    successFactors: ['Sharp positioning', 'Repeatable acquisition', 'Onboarding', 'Customer success', 'Unit economics discipline'],
  },
};

export function mapIndustryToExpertVertical(normalizedIndustry: string | null | undefined): ExpertVerticalKey {
  const slug = (normalizedIndustry ?? 'unknown').toLowerCase().trim();
  const map: Record<string, ExpertVerticalKey> = {
    restaurant: 'restaurant',
    bakery: 'restaurant',
    hair_salon: 'beauty_salon',
    beauty: 'beauty_salon',
    clinic: 'healthcare_clinic',
    ecommerce: 'ecommerce',
    consultant: 'saas_b2b',
    saas: 'saas_b2b',
    real_estate: 'real_estate',
    hotel: 'real_estate',
    gym: 'fitness_gym',
    fitness: 'fitness_gym',
    school: 'education',
    legal_firm: 'legal_professional',
    fintech: 'finance_fintech',
    finance: 'finance_fintech',
  };
  return map[slug] ?? 'general';
}

function formatCompetitors(list: Competitor[]): string {
  return list
    .map((c, i) => `${i + 1}. ${c.name} — strengths: ${c.strengths}; weaknesses: ${c.weaknesses}`)
    .join('\n');
}

export function getVerticalExpertContext(vertical: ExpertVerticalKey): string {
  const pack = PACKS[vertical] ?? PACKS.general;
  return [
    `VERTICAL: ${pack.label}`,
    '',
    'TOP COMPETITORS (landscape):',
    formatCompetitors(pack.competitors),
    '',
    `MARKET SIZE / GROWTH (orientation): ${pack.marketSize}`,
    '',
    'COMMON BUSINESS MODELS THAT WORK:',
    ...pack.commonModels.map((m) => `- ${m}`),
    '',
    'TYPICAL SCALING CHALLENGES:',
    ...pack.scalingChallenges.map((m) => `- ${m}`),
    '',
    'SUCCESS FACTORS:',
    ...pack.successFactors.map((m) => `- ${m}`),
  ].join('\n');
}
