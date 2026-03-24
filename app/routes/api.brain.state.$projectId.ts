import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { ensureBrainWorkspace } from '~/lib/brain/server';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { readBrainContext } from '~/lib/brain/read.server';

export async function loader({ request, params }: LoaderFunctionArgs) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const projectId = params.projectId;

  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E841] Missing projectId' }, { status: 400 });
  }

  const { user } = await requireUserFromBearerToken(request);

  await ensureBrainWorkspace(projectId, user.id);

  const context = await readBrainContext({ projectId, userId: user.id });

  if (!context) {
    return Response.json({ error: '[RIDVAN-E842] Brain state not found' }, { status: 404 });
  }

  return Response.json(context);
}
