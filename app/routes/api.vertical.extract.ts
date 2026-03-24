import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { ensureBrainWorkspace, insertBrainEventsBatch } from '~/lib/brain/server';
import { ingestBrainEventsById } from '~/lib/brain/ingest.server';
import { normalizeIndustry } from '~/lib/vertical/taxonomy.server';
import { extractGeoFromText } from '~/lib/vertical/geo.server';

function humanizeIndustry(industry: string) {
  switch (industry) {
    case 'hair_salon':
      return 'frisörsalong';
    case 'restaurant':
      return 'restaurang';
    case 'gym':
      return 'gym';
    case 'legal_firm':
      return 'juristbyrå';
    case 'hotel':
      return 'hotell';
    case 'clinic':
      return 'klinik';
    case 'real_estate':
      return 'fastighetsverksamhet';
    case 'bakery':
      return 'bageri';
    case 'beauty':
      return 'skönhetsverksamhet';
    case 'ecommerce':
      return 'e-handel';
    case 'consultant':
      return 'konsultverksamhet';
    case 'school':
      return 'utbildningsverksamhet';
    case 'saas':
      return 'SaaS-bolag';
    default:
      return 'verksamhet';
  }
}

function suggestedFeaturesForIndustry(industry: string) {
  switch (industry) {
    case 'hair_salon':
      return ['bokningskalender', 'tjänstemeny med priser', 'personalprofiler'];
    case 'restaurant':
      return ['bordsbokning', 'digital meny', 'öppettider'];
    case 'gym':
      return ['medlemskap', 'klasschema', 'prova-på CTA'];
    case 'legal_firm':
      return ['praktikområden', 'teamprofiler', 'bokning av konsultation'];
    case 'hotel':
      return ['rumstyper med priser', 'tillgänglighetskalender', 'bokningsformulär'];
    case 'clinic':
      return ['tjänstelista', 'behandlarprofiler', 'tidsbokning'];
    case 'real_estate':
      return ['objektslistor', 'sökfilter', 'värderingsformulär'];
    case 'bakery':
      return ['meny med priser', 'beställningsformulär', 'specialbeställningar'];
    case 'beauty':
      return ['servicemeny', 'bokningskalender', 'före-och-efter-galleri'];
    case 'ecommerce':
      return ['produktgrid', 'kategorifilter', 'checkout-flöde'];
    case 'consultant':
      return ['tjänstepaket', 'case studies', 'brief-formulär'];
    case 'school':
      return ['kurskatalog', 'anmälan', 'instruktörsprofiler'];
    case 'saas':
      return ['prisplaner', 'produktfördelar', 'demo CTA'];
    default:
      return [] as string[];
  }
}

function buildConfirmation(industry: ReturnType<typeof normalizeIndustry>, geo: ReturnType<typeof extractGeoFromText>) {
  if (industry.normalizedIndustry === 'unknown') {
    return null;
  }

  const city = typeof geo.payload?.city === 'string' && geo.payload.city.trim().length > 0 ? geo.payload.city.trim() : null;
  const features = suggestedFeaturesForIndustry(industry.normalizedIndustry).slice(0, 3);
  const featureList = features.join(', ');

  return {
    understood: city
      ? `Jag förstår att du bygger för ${humanizeIndustry(industry.normalizedIndustry)} i ${city}.`
      : `Jag förstår att du bygger för ${humanizeIndustry(industry.normalizedIndustry)}.`,
    suggestedFeatures: features,
    message:
      features.length > 0
        ? `Jag bygger nu med ${featureList} — passar det?`
        : 'Jag bygger nu med de viktigaste vertikala funktionerna — passar det?',
  };
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const { user } = await requireUserFromBearerToken(request);

  const body = (await request.json().catch(() => null)) as { projectId?: string; text?: string } | null;
  const projectId = body?.projectId;
  const text = body?.text?.trim();

  if (!projectId || !text) {
    return Response.json({ error: '[RIDVAN-E931] Missing projectId or text' }, { status: 400 });
  }

  const workspace = await ensureBrainWorkspace(projectId, user.id);

  const industry = normalizeIndustry(text);
  const geo = extractGeoFromText(text);
  const confirmation = buildConfirmation(industry, geo);

  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];

  if (industry.normalizedIndustry !== 'unknown') {
    events.push({
      type: 'world.industry_set',
      payload: {
        raw_input: text,
        normalized_industry: industry.normalizedIndustry,
        sub_industry: industry.subIndustry,
        confidence: industry.confidence,
        assertion_source: 'system_inferred',
      },
    });
  }

  if (geo.shouldEmit) {
    events.push({
      type: 'world.geo_set',
      payload: geo.payload as Record<string, unknown>,
    });
  }

  if (!geo.shouldEmit) {
    return Response.json({
      ok: true,
      wroteEvents: 0,
      needsUserInput: {
        geo: geo.question,
      },
      industryDetected: industry,
      confirmation,
    });
  }

  const eventIds = await insertBrainEventsBatch({
    workspaceId: workspace.id,
    projectId,
    userId: user.id,
    source: 'vertical',
    events: events.map((e) => ({ type: e.type, payload: e.payload })),
  });

  void ingestBrainEventsById(eventIds).catch((error) => {
    console.error('[RIDVAN-E932] Vertical ingestion failed', error);
  });

  return Response.json({ ok: true, wroteEvents: events.length, eventIds, industryDetected: industry, geoDetected: geo.payload, confirmation });
}
