import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { FEATURE_FLAGS } from '~/config/feature-flags';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { ensureBrainWorkspace, insertBrainEvent } from '~/lib/brain/server';
import { supabaseAdmin } from '~/lib/supabase/server';

const METRICS = ['Tillväxt', 'Cashflow', 'Kundnöjdhet', 'Team', 'Marknad'] as const;

function daysAgoIso(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function metricQuestion(metric: (typeof METRICS)[number]) {
  if (metric === 'Tillväxt') return 'Hur går tillväxten just nu (t.ex. nya leads/kunder/vecka)?';
  if (metric === 'Cashflow') return 'Hur ser cashen ut just nu (runway i månader eller kassa i SEK)?';
  if (metric === 'Kundnöjdhet') return 'Hur nöjda är kunderna just nu (en mening + ev. NPS/feedback)?';
  if (metric === 'Team') return 'Hur mår teamet just nu (kapacitet, stress, rekryteringsbehov)?';
  return 'Hur ser marknaden ut just nu (efterfrågan, konkurrens, prispress)?';
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  if (!FEATURE_FLAGS.mentorHealthCheckIn) {
    return Response.json({ error: '[RIDVAN-E1353] Health check-in is disabled for MVP' }, { status: 404 });
  }

  const { user } = await requireUserFromBearerToken(request);
  const body = (await request.json().catch(() => null)) as { projectId?: string } | null;
  const projectId = body?.projectId;
  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E1351] Missing projectId' }, { status: 400 });
  }

  const workspace = await ensureBrainWorkspace(projectId, user.id);

  // Load latest per metric.
  const { data: rows, error } = await supabaseAdmin
    .from('mentor_health_metrics')
    .select('metric, status, recorded_at')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .order('recorded_at', { ascending: false })
    .limit(200);

  if (error) {
    return Response.json({ error: `[RIDVAN-E1352] Failed to load metrics: ${error.message}` }, { status: 500 });
  }

  const latestByMetric = new Map<string, { recorded_at: string; status: string }>();
  for (const r of rows ?? []) {
    if (!latestByMetric.has((r as any).metric)) {
      latestByMetric.set((r as any).metric, { recorded_at: (r as any).recorded_at, status: (r as any).status });
    }
  }

  const missing = METRICS.filter((m) => !latestByMetric.has(m));

  // Dedup weekly check-in using a Brain event.
  const since = daysAgoIso(6);
  const { data: existingCheckins } = await supabaseAdmin
    .from('brain_events')
    .select('id, occurred_at')
    .eq('workspace_id', workspace.id)
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .eq('source', 'system')
    .eq('type', 'mentor.health_checkin_sent')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(1);

  const alreadySentRecently = Boolean((existingCheckins ?? []).length > 0);

  const messages: string[] = [];

  // Baseline: one question per missing metric, but avoid dumping all at once.
  if (missing.length > 0) {
    const first = missing[0];
    messages.push(`Hälsokoll — snabb baseline. ${metricQuestion(first)}`);
  } else {
    // Weekly check-in: if no updates in last 7 days on any metric.
    const cutoff = daysAgoIso(7);
    const hasRecent = Array.from(latestByMetric.values()).some((v) => v.recorded_at >= cutoff);

    if (!hasRecent && !alreadySentRecently) {
      messages.push('Hälsokoll — snabb check-in för veckan. Vad har förändrats senaste 7 dagarna i tillväxt eller cash?');
    }
  }

  if (messages.length > 0 && !alreadySentRecently) {
    try {
      await insertBrainEvent({
        workspaceId: workspace.id,
        projectId,
        userId: user.id,
        source: 'system',
        type: 'mentor.health_checkin_sent',
        payload: { at: new Date().toISOString(), missing_metrics: missing, assertion_source: 'system_inferred' },
        idempotencyKey: null,
      });
    } catch {
      // best effort
    }
  }

  return Response.json({ ok: true, messages, missingMetrics: missing, alreadySentRecently });
}
