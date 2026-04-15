import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { getOrBuildProjectDashboard } from '~/lib/brain/project-dashboard-intelligence.server';
import { supabaseAdmin } from '~/lib/supabase/server';

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const projectId = typeof params.projectId === 'string' ? params.projectId.trim() : '';
  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E2110] Missing projectId' }, { status: 400 });
  }

  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get('refresh') === '1' || url.searchParams.get('refresh') === 'true';

  const { user } = await requireUserFromBearerToken(request);

  const { data: project, error: projectError } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .maybeSingle<{ id: string }>();

  if (projectError) {
    return Response.json({ error: '[RIDVAN-E2111] Failed to verify project' }, { status: 500 });
  }

  if (!project) {
    return Response.json({ error: '[RIDVAN-E2112] Project not found' }, { status: 404 });
  }

  try {
    const result = await getOrBuildProjectDashboard({
      projectId,
      userId: user.id,
      env: context.cloudflare.env,
      forceRefresh,
    });

    return Response.json({
      projectId,
      dashboard: result.dashboard,
      cached: result.cached,
      brainMissing: result.brainMissing,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: `[RIDVAN-E2113] ${message}` }, { status: 500 });
  }
}
