import { type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { ensureBrainWorkspace } from '~/lib/brain/server';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import {
  loadDeepMemoryForWorkspace,
  saveDeepMemoryForWorkspace,
  removeDeepMemoryItemById,
  updateDeepMemoryEntry,
  type MentorMemoryCategory,
} from '~/lib/mentor/memory.server';
import { supabaseAdmin } from '~/lib/supabase/server';

function isCategory(value: unknown): value is MentorMemoryCategory {
  return value === 'decisions' || value === 'pivots' || value === 'goals' || value === 'learnings';
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const { user } = await requireUserFromBearerToken(request);
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');
  if (!projectId?.trim()) {
    return Response.json({ error: '[RIDVAN-E1921] Missing projectId' }, { status: 400 });
  }

  const { data: projectRow, error: projectError } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .maybeSingle<{ id: string }>();

  if (projectError) {
    return Response.json({ error: `[RIDVAN-E1922] ${projectError.message}` }, { status: 500 });
  }

  if (!projectRow) {
    return Response.json({ error: '[RIDVAN-E1923] Unauthorized project' }, { status: 403 });
  }

  const workspace = await ensureBrainWorkspace(projectId, user.id);
  const memory = await loadDeepMemoryForWorkspace(workspace.id);

  return Response.json({ ok: true as const, memory });
}

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const { user } = await requireUserFromBearerToken(request);
  const body = (await request.json().catch(() => null)) as
    | {
        projectId?: string;
        op?: 'remove' | 'patch';
        id?: string;
        category?: string;
        updates?: Record<string, string>;
      }
    | null;

  const projectId = body?.projectId?.trim();
  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E1924] Missing projectId' }, { status: 400 });
  }

  const { data: projectRow, error: projectError } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .maybeSingle<{ id: string }>();

  if (projectError) {
    return Response.json({ error: `[RIDVAN-E1925] ${projectError.message}` }, { status: 500 });
  }

  if (!projectRow) {
    return Response.json({ error: '[RIDVAN-E1926] Unauthorized project' }, { status: 403 });
  }

  const workspace = await ensureBrainWorkspace(projectId, user.id);
  const op = body?.op;
  const id = typeof body?.id === 'string' ? body.id.trim() : '';

  if (op === 'remove') {
    if (!id) {
      return Response.json({ error: '[RIDVAN-E1927] Missing id' }, { status: 400 });
    }
    const prev = await loadDeepMemoryForWorkspace(workspace.id);
    const next = removeDeepMemoryItemById(prev, id);
    await saveDeepMemoryForWorkspace(workspace.id, next);
    return Response.json({ ok: true as const, memory: next });
  }

  if (op === 'patch') {
    if (!id || !isCategory(body?.category)) {
      return Response.json({ error: '[RIDVAN-E1928] Missing id or invalid category' }, { status: 400 });
    }
    const updates = body?.updates && typeof body.updates === 'object' ? body.updates : {};
    const stringUpdates: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(updates)) {
      stringUpdates[k] = typeof v === 'string' ? v : undefined;
    }
    const prev = await loadDeepMemoryForWorkspace(workspace.id);
    const next = updateDeepMemoryEntry(prev, body.category, id, stringUpdates);
    await saveDeepMemoryForWorkspace(workspace.id, next);
    return Response.json({ ok: true as const, memory: next });
  }

  return Response.json({ error: '[RIDVAN-E1929] Unknown op' }, { status: 400 });
}
