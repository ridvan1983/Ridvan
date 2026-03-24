import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { supabaseAdmin } from '~/lib/supabase/server';

export async function loader({ request, params }: LoaderFunctionArgs) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const projectId = params.projectId;

  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E891] Missing projectId' }, { status: 400 });
  }

  const { user } = await requireUserFromBearerToken(request);

  const { data: workspace, error: wsError } = await supabaseAdmin
    .from('brain_workspaces')
    .select('id, project_id, user_id')
    .eq('project_id', projectId)
    .maybeSingle<{ id: string; project_id: string; user_id: string }>();

  if (wsError) {
    return Response.json({ error: `[RIDVAN-E892] Failed to load workspace: ${wsError.message}` }, { status: 500 });
  }

  if (!workspace || workspace.user_id !== user.id) {
    return Response.json({ error: '[RIDVAN-E893] Workspace not found' }, { status: 404 });
  }

  const [eventsRes, entriesRes, stateRes] = await Promise.all([
    supabaseAdmin
      .from('brain_events')
      .select('id, type, source, occurred_at, payload')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .order('occurred_at', { ascending: false })
      .limit(10),
    supabaseAdmin
      .from('brain_memory_entries')
      .select('id, kind, category, entity_key, revision, is_current, created_at, source_event_id')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabaseAdmin
      .from('brain_project_state')
      .select('workspace_id, project_id, user_id, active_goal_entry_ids, active_priority_entry_ids, active_challenge_entry_ids, primary_goal_summary, top_priority_summary, main_challenge_summary')
      .eq('workspace_id', workspace.id)
      .maybeSingle(),
  ]);

  if (eventsRes.error) {
    return Response.json({ error: `[RIDVAN-E894] Failed to load events: ${eventsRes.error.message}` }, { status: 500 });
  }

  if (entriesRes.error) {
    return Response.json({ error: `[RIDVAN-E895] Failed to load entries: ${entriesRes.error.message}` }, { status: 500 });
  }

  if (stateRes.error) {
    return Response.json({ error: `[RIDVAN-E896] Failed to load state: ${stateRes.error.message}` }, { status: 500 });
  }

  return Response.json({
    workspaceId: workspace.id,
    projectId,
    counts: {
      events: (eventsRes.data ?? []).length,
      entries: (entriesRes.data ?? []).length,
    },
    latestEvents: eventsRes.data ?? [],
    latestEntries: entriesRes.data ?? [],
    state: stateRes.data ?? null,
  });
}
