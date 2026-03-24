export type SignalKey =
  | 'visitors'
  | 'leads'
  | 'bookings'
  | 'orders'
  | 'conversion_rate'
  | 'returning_customers'
  | 'active_channels'
  | 'payment_enabled'
  | 'published_status';

export type SignalSource = 'user' | 'system' | 'integration' | 'derived' | 'vertical';

export interface SignalPatchInput {
  key: SignalKey;
  value: unknown;
  window?: string;
  as_of?: string;
  source?: SignalSource;
}

export interface NormalizedSignalPatch {
  key: SignalKey;
  payload: {
    value: number | boolean | string | string[];
    window?: string;
    source: SignalSource;
    as_of: string;
  };
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function normalizeWindow(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (!/^(\d+)(m|h|d|w|mo)$/i.test(trimmed)) {
    throw new Error('[RIDVAN-E941] Invalid window format');
  }

  return trimmed;
}

function requireNonNegativeInt(value: unknown, code: string) {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) {
    throw new Error(code);
  }
  return num;
}

function requireRate(value: unknown) {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(num) || num < 0 || num > 1) {
    throw new Error('[RIDVAN-E942] conversion_rate must be between 0 and 1');
  }
  return num;
}

function requireStringArray(value: unknown) {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v.trim().length === 0)) {
    throw new Error('[RIDVAN-E943] active_channels must be string[]');
  }
  return (value as string[]).map((s) => s.trim());
}

function requirePublishedStatus(value: unknown) {
  if (value === 'not_published' || value === 'published' || value === 'unknown') {
    return value;
  }
  throw new Error('[RIDVAN-E944] published_status must be not_published | published | unknown');
}

function normalizeSource(value: unknown): SignalSource {
  if (value === 'user' || value === 'system' || value === 'integration' || value === 'derived' || value === 'vertical') {
    return value;
  }
  return 'vertical';
}

export function normalizeSignalPatches(patches: SignalPatchInput[]): NormalizedSignalPatch[] {
  const nowIso = new Date().toISOString();

  return patches.map((patch) => {
    const asOf = isIsoDateString(patch.as_of) ? patch.as_of : nowIso;
    const source = normalizeSource(patch.source);
    const window = normalizeWindow(patch.window);

    switch (patch.key) {
      case 'visitors':
        return { key: patch.key, payload: { value: requireNonNegativeInt(patch.value, '[RIDVAN-E945] visitors must be >= 0 int'), window, source, as_of: asOf } };
      case 'leads':
        return { key: patch.key, payload: { value: requireNonNegativeInt(patch.value, '[RIDVAN-E946] leads must be >= 0 int'), window, source, as_of: asOf } };
      case 'bookings':
        return { key: patch.key, payload: { value: requireNonNegativeInt(patch.value, '[RIDVAN-E947] bookings must be >= 0 int'), window, source, as_of: asOf } };
      case 'orders':
        return { key: patch.key, payload: { value: requireNonNegativeInt(patch.value, '[RIDVAN-E948] orders must be >= 0 int'), window, source, as_of: asOf } };
      case 'returning_customers':
        return {
          key: patch.key,
          payload: { value: requireNonNegativeInt(patch.value, '[RIDVAN-E949] returning_customers must be >= 0 int'), window, source, as_of: asOf },
        };
      case 'conversion_rate':
        return { key: patch.key, payload: { value: requireRate(patch.value), window, source, as_of: asOf } };
      case 'active_channels':
        return { key: patch.key, payload: { value: requireStringArray(patch.value), window, source, as_of: asOf } };
      case 'payment_enabled':
        if (typeof patch.value !== 'boolean') {
          throw new Error('[RIDVAN-E950] payment_enabled must be boolean');
        }
        return { key: patch.key, payload: { value: patch.value, window, source, as_of: asOf } };
      case 'published_status':
        return { key: patch.key, payload: { value: requirePublishedStatus(patch.value), window, source, as_of: asOf } };
      default: {
        const neverKey: never = patch.key;
        throw new Error(`[RIDVAN-E999] Unknown signal key: ${String(neverKey)}`);
      }
    }
  });
}
