import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { supabaseAdmin } from '~/lib/supabase/server';

type Metric = 'Tillväxt' | 'Cashflow' | 'Kundnöjdhet' | 'Team' | 'Marknad';
const METRICS: Metric[] = ['Tillväxt', 'Cashflow', 'Kundnöjdhet', 'Team', 'Marknad'];

type Row = {
  id: string;
  project_id: string;
  user_id: string;
  metric: string;
  status: 'green' | 'yellow' | 'red';
  value: string | null;
  notes: string | null;
  recorded_at: string;
};

export async function loader({ request }: ActionFunctionArgs) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const { user } = await requireUserFromBearerToken(request);
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');
  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E1301] Missing projectId' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('mentor_health_metrics')
    .select('id, project_id, user_id, metric, status, value, notes, recorded_at')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .order('recorded_at', { ascending: false })
    .limit(200)
    .returns<Row[]>();

  if (error) {
    return Response.json({ error: `[RIDVAN-E1302] Failed to load health metrics: ${error.message}` }, { status: 500 });
  }

  const latestByMetric = new Map<string, Row>();
  for (const row of data ?? []) {
    if (!latestByMetric.has(row.metric)) {
      latestByMetric.set(row.metric, row);
    }
  }

  const latest = METRICS.map((m) => latestByMetric.get(m) ?? null);
  return Response.json({ ok: true, metrics: latest, allMetrics: METRICS });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const { user } = await requireUserFromBearerToken(request);
  const body = (await request.json().catch(() => null)) as
    | { projectId?: string; metric?: string; status?: 'green' | 'yellow' | 'red'; value?: string; notes?: string }
    | null;

  const projectId = body?.projectId;
  const metric = body?.metric;
  const status = body?.status;

  if (!projectId || !metric || !status) {
    return Response.json({ error: '[RIDVAN-E1303] Missing fields' }, { status: 400 });
  }

  if (!METRICS.includes(metric as Metric)) {
    return Response.json({ error: '[RIDVAN-E1304] Invalid metric' }, { status: 400 });
  }

  const value = typeof body?.value === 'string' ? body.value.trim().slice(0, 240) : null;
  const notes = typeof body?.notes === 'string' ? body.notes.trim().slice(0, 1000) : null;

  const { data, error } = await supabaseAdmin
    .from('mentor_health_metrics')
    .insert({ project_id: projectId, user_id: user.id, metric, status, value, notes })
    .select('id, project_id, user_id, metric, status, value, notes, recorded_at')
    .single<Row>();

  if (error || !data) {
    return Response.json({ error: `[RIDVAN-E1305] Failed to write metric: ${error?.message ?? 'unknown error'}` }, { status: 500 });
  }

  return Response.json({ ok: true, metric: data });
}
