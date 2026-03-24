import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { readBrainContext } from '~/lib/brain/read.server';

export async function loader({ request, params }: LoaderFunctionArgs) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const projectId = params.projectId;
  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E1011] Missing projectId' }, { status: 400 });
  }

  const { user } = await requireUserFromBearerToken(request);
  const brain = await readBrainContext({ projectId, userId: user.id });

  if (!brain) {
    return Response.json({ error: '[RIDVAN-E1012] Brain state not found' }, { status: 404 });
  }

  const profile = {
    industry: {
      normalized: brain.industryProfile?.normalizedIndustry ?? 'unknown',
      sub: brain.industryProfile?.subIndustry ?? null,
      confidence: brain.industryProfile?.confidence ?? 0,
    },
    geo: {
      countryCode: brain.geoProfile?.countryCode ?? null,
      city: brain.geoProfile?.city ?? null,
      currencyCode: brain.geoProfile?.currencyCode ?? null,
      taxModel: brain.geoProfile?.taxModel ?? 'unknown',
      languageCodes: brain.geoProfile?.languageCodes ?? [],
      vatRate:
        brain.geoProfile && typeof (brain.geoProfile.paymentPreferences as any)?.vat_rate === 'number'
          ? Number((brain.geoProfile.paymentPreferences as any).vat_rate)
          : null,
    },
  };

  return Response.json({ ok: true, projectId, business_profile: profile });
}
