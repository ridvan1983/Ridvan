import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { ensureBrainWorkspace, insertBrainEvent } from '~/lib/brain/server';
import { ingestBrainEventsById } from '~/lib/brain/ingest.server';
import { defaultsForCountry } from '~/lib/vertical/geo-adapter.server';
import { readBrainContext } from '~/lib/brain/read.server';

function parseAcceptLanguage(value: string | null) {
  if (!value) return [] as string[];
  return value
    .split(',')
    .map((part) => part.split(';')[0]?.trim())
    .filter(Boolean)
    .slice(0, 3);
}

export async function action({ request, params, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const projectId = params.projectId;
  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E1041] Missing projectId' }, { status: 400 });
  }

  const { user } = await requireUserFromBearerToken(request);

  const existing = await readBrainContext({ projectId, userId: user.id });
  if (existing?.geoProfile?.countryCode) {
    return Response.json({ ok: true, wroteEvent: false, alreadySet: true, countryCode: existing.geoProfile.countryCode });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        locale?: string;
        languageCodes?: string[];
        cityOverride?: string | null;
        countryOverride?: string | null;
      }
    | null;

  const headerCountry = request.headers.get('cf-ipcountry') ?? (context.cloudflare as any)?.cf?.country ?? null;
  const countryCode = (body?.countryOverride ?? headerCountry ?? null) as string | null;

  const defaults = defaultsForCountry(countryCode);

  if (!defaults) {
    // Ambiguous: we don't ask upfront, but caller may choose to confirm with 1 yes/no question later.
    return Response.json({ ok: true, wroteEvent: false, ambiguous: true });
  }

  const acceptLang = parseAcceptLanguage(request.headers.get('accept-language'));
  const clientLangs = Array.isArray(body?.languageCodes) ? body!.languageCodes.filter((x) => typeof x === 'string') : [];
  const locale = typeof body?.locale === 'string' ? body!.locale : null;

  const mergedLangs = Array.from(new Set([...(clientLangs.length ? clientLangs : []), ...(locale ? [locale] : []), ...acceptLang, ...defaults.languageCodes]))
    .filter(Boolean)
    .slice(0, 4);

  const city = typeof body?.cityOverride === 'string' ? body!.cityOverride : null;

  const workspace = await ensureBrainWorkspace(projectId, user.id);

  const eventId = await insertBrainEvent({
    workspaceId: workspace.id,
    projectId,
    userId: user.id,
    source: 'system',
    type: 'world.geo_set',
    payload: {
      country_code: defaults.countryCode,
      country_name: defaults.countryName,
      city,
      language_codes: mergedLangs,
      currency_code: defaults.currencyCode,
      tax_model: defaults.taxModel,
      payment_preferences: {
        ...defaults.paymentPreferences,
        vat_rate: defaults.vatRate,
      },
      legal_flags: defaults.legalFlags,
      communication_norms: defaults.communicationNorms,
      confidence: 0.55,
      assertion_source: 'system_inferred',
    },
  });

  void ingestBrainEventsById([eventId]).catch((error) => {
    console.error('[RIDVAN-E1042] Geo bootstrap ingestion failed', error);
  });

  return Response.json({ ok: true, wroteEvent: true, eventId, countryCode: defaults.countryCode });
}
