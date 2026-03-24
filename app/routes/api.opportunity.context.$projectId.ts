import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { buildOpportunityContext } from '~/lib/opportunity/context.server';

export async function loader({ request, params }: LoaderFunctionArgs) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const projectId = params.projectId;
  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E981] Missing projectId' }, { status: 400 });
  }

  const { user } = await requireUserFromBearerToken(request);
  const ctx = await buildOpportunityContext({ projectId, userId: user.id });

  if (!ctx) {
    return Response.json({ error: '[RIDVAN-E982] Opportunity context not found' }, { status: 404 });
  }

  return Response.json(ctx);
}
