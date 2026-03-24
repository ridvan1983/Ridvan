import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { getVerticalContext } from '~/lib/vertical/context.server';

export async function loader({ request, params }: LoaderFunctionArgs) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const projectId = params.projectId;
  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E921] Missing projectId' }, { status: 400 });
  }

  const { user } = await requireUserFromBearerToken(request);
  const ctx = await getVerticalContext({ projectId, userId: user.id });

  if (!ctx) {
    return Response.json({ error: '[RIDVAN-E922] Brain state not found' }, { status: 404 });
  }

  return Response.json(ctx);
}
