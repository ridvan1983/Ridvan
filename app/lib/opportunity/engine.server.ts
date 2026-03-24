import type { BrainProjectState } from '~/lib/brain/types';
import type { Opportunity } from './types.server';

type SignalValue = { value?: unknown; window?: unknown; source?: unknown; as_of?: unknown };

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readSignal(state: BrainProjectState, key: string): SignalValue {
  const signals = asObject(state.currentSignals);
  const raw = signals[key];
  return (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as SignalValue) : {}) as SignalValue;
}

function readSignalNumber(state: BrainProjectState, key: string): number | null {
  const s = readSignal(state, key);
  const v = s.value;
  const num = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(num) ? num : null;
}

function readSignalBoolean(state: BrainProjectState, key: string): boolean | null {
  const s = readSignal(state, key);
  return typeof s.value === 'boolean' ? s.value : null;
}

function readSignalString(state: BrainProjectState, key: string): string | null {
  const s = readSignal(state, key);
  return typeof s.value === 'string' ? s.value : null;
}

function clamp01(value: number) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function computeOpportunities(args: {
  state: BrainProjectState;
  industry: string | null;
  geoCountryCode: string | null;
  verticalModules: Array<{ module_key?: string }>; 
}) {
  const opportunities: Opportunity[] = [];

  const visitors = readSignalNumber(args.state, 'visitors');
  const leads = readSignalNumber(args.state, 'leads');
  const bookings = readSignalNumber(args.state, 'bookings');
  const orders = readSignalNumber(args.state, 'orders');
  const conversionRate = readSignalNumber(args.state, 'conversion_rate');
  const paymentEnabled = readSignalBoolean(args.state, 'payment_enabled');
  const publishedStatus = readSignalString(args.state, 'published_status');
  const returningCustomers = readSignalNumber(args.state, 'returning_customers');

  const hasModule = (key: string) => args.verticalModules.some((m) => m?.module_key === key);

  const industry = args.industry ?? 'unknown';

  const bookingModule = (() => {
    if (industry === 'hair_salon') return 'booking_system';
    if (industry === 'restaurant') return 'table_booking';
    if (industry === 'gym') return 'class_booking';
    if (industry === 'legal_firm') return 'appointment_booking';
    return null;
  })();

  const hasTraffic = typeof visitors === 'number' && visitors > 50;
  const bookingCount = bookings ?? 0;
  const orderCount = orders ?? 0;

  if (bookingModule && hasTraffic && bookingCount === 0) {
    opportunities.push({
      type: 'missing_capability',
      problem_detected: 'traffic_but_no_booking_flow',
      why_now: 'You have visitors but essentially zero bookings.',
      suggested_module: bookingModule,
      reasoning: `For ${industry.replace('_', ' ')}, a clear booking path is the main conversion mechanism. Without it, traffic can’t turn into revenue.`,
      confidence: 0.92,
      priority: 'high',
      source: 'signals+vertical',
    });
  }

  if (hasTraffic && typeof conversionRate === 'number' && conversionRate < 0.005 && bookingModule) {
    opportunities.push({
      type: 'growth',
      problem_detected: 'low_conversion',
      why_now: 'Traffic exists, but conversion is very low.',
      suggested_module: bookingModule,
      reasoning: 'The fastest win is usually simplifying the primary action (book/reserve) and removing steps.',
      confidence: clamp01(0.75 + (0.005 - conversionRate) * 20),
      priority: 'high',
      source: 'signals',
    });
  }

  if (publishedStatus === 'published' && paymentEnabled === false) {
    opportunities.push({
      type: 'missing_capability',
      problem_detected: 'published_without_payments',
      why_now: 'You’re live, but payments aren’t enabled.',
      suggested_module: 'payment_flow',
      reasoning: 'If customers can’t pay or confirm financially, revenue collection is blocked even if demand exists.',
      confidence: 0.85,
      priority: 'high',
      source: 'signals',
    });
  }

  if ((industry === 'hair_salon' || industry === 'gym') && typeof returningCustomers === 'number' && returningCustomers > 0 && hasModule('customer_profiles')) {
    opportunities.push({
      type: 'growth',
      problem_detected: 'retention_needs_customer_memory',
      why_now: 'You have returning customers — retention is now a measurable lever.',
      suggested_module: 'customer_profiles',
      reasoning: 'Basic customer memory (preferences + history) improves rebooking and increases LTV without needing more traffic.',
      confidence: 0.78,
      priority: 'medium',
      source: 'signals+vertical',
    });
  }

  if (industry === 'legal_firm' && typeof leads === 'number' && leads > 0) {
    opportunities.push({
      type: 'missing_capability',
      problem_detected: 'leads_without_triage',
      why_now: 'Leads exist; speed-to-response and qualification decide revenue.',
      suggested_module: 'case_triage',
      reasoning: 'Legal firms win by responding fast and filtering low-fit cases before partner time is spent.',
      confidence: 0.8,
      priority: 'medium',
      source: 'signals+vertical',
    });
  }

  if (industry === 'restaurant' && hasTraffic && orderCount > 0 && publishedStatus !== 'published') {
    opportunities.push({
      type: 'signal_gap',
      problem_detected: 'orders_signal_without_clear_publish_state',
      why_now: 'Orders exist but published status is unclear.',
      suggested_module: null,
      reasoning: 'If the product isn’t reliably live, you can’t trust conversion signals.',
      confidence: 0.6,
      priority: 'low',
      source: 'signals',
    });
  }

  const deduped: Opportunity[] = [];
  const seen = new Set<string>();
  for (const opp of opportunities) {
    const key = `${opp.type}:${opp.problem_detected}:${opp.suggested_module ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(opp);
  }

  const score = (o: Opportunity) => {
    const p = o.priority === 'high' ? 3 : o.priority === 'medium' ? 2 : 1;
    return p * 10 + o.confidence;
  };

  return deduped.sort((a, b) => score(b) - score(a)).slice(0, 3);
}
