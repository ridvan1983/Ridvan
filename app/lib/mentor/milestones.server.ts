import { supabaseAdmin } from '~/lib/supabase/server';

export type MentorMilestoneKey =
  | 'first_project_built'
  | 'first_mentor_conversation'
  | 'days_7'
  | 'days_30'
  | 'days_365'
  | 'first_customer'
  | 'revenue_100k_sek'
  | 'first_employee';

export type MentorMilestone = {
  key: MentorMilestoneKey;
  title: string;
  message: string;
  occurredAt: string;
};

function nowIso() {
  return new Date().toISOString();
}

function daysBetweenUtc(aIso: string, bIso: string) {
  const a = new Date(aIso);
  const b = new Date(bIso);
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

async function hasMilestoneMemory(args: { workspaceId: string; key: MentorMilestoneKey }) {
  const entityKey = `milestone:${args.key}`;
  const { data, error } = await supabaseAdmin
    .from('brain_memory_entries')
    .select('id')
    .eq('workspace_id', args.workspaceId)
    .eq('entity_key', entityKey)
    .eq('is_current', true)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (error) {
    throw new Error(`[RIDVAN-E1401] Failed to check milestone memory: ${error.message}`);
  }

  return Boolean(data);
}

async function recordMilestone(args: { workspaceId: string; projectId: string; userId: string; milestone: MentorMilestone }) {
  await supabaseAdmin.from('brain_events').insert({
    workspace_id: args.workspaceId,
    project_id: args.projectId,
    user_id: args.userId,
    source: 'mentor',
    type: 'mentor.milestone_logged',
    idempotency_key: null,
    payload: {
      milestone_key: args.milestone.key,
      title: args.milestone.title,
      message: args.milestone.message,
      occurred_at: args.milestone.occurredAt,
      entity_key: `milestone:${args.milestone.key}`,
      assertion_source: 'system_inferred',
    },
  });
}

function messageSv(args: { key: MentorMilestoneKey; days?: number }) {
  if (args.key === 'days_30') {
    return 'Du har varit här i 30 dagar. Vet du vad det säger? Att du faktiskt dyker upp och gör jobbet när det är oklart. Vad har förändrats i bolaget sen dag 1?';
  }
  if (args.key === 'days_7') {
    return 'En vecka in. Det är exakt nu de flesta tappar fokus — men du är kvar. Vad är den viktigaste saken du borde göra den här veckan för att flytta intäkt eller risk?';
  }
  if (args.key === 'days_365') {
    return 'Ett år. Det är på riktigt. De flesta pratar — du har byggt vanan att driva. Vad är nästa nivå för bolaget nu?';
  }
  if (args.key === 'first_mentor_conversation') {
    return 'Första Mentor-samtalet. Det låter litet, men det är en signal om att du tar hjälp på rätt sätt. Vad vill du att vi vinner de kommande 7 dagarna?';
  }
  if (args.key === 'first_project_built') {
    return 'Du byggde din första grej här. Det betyder att du är en doer — inte en drömmare. Vad är det viktigaste du ska få ut i marknaden härnäst?';
  }
  if (args.key === 'first_customer') {
    return 'Din första kund. Det är inte bara intäkt — det är bevis. Vad var det som gjorde att de sa ja?';
  }
  if (args.key === 'revenue_100k_sek') {
    return '100k SEK i intäkt. Det är en riktig tröskel — nu är frågan: vad gör du för att göra det reproducerbart varje månad?';
  }
  if (args.key === 'first_employee') {
    return 'Första anställda. Nu blir bolaget större än du själv. Vad är den viktigaste rollen du precis fyllde — och vilket ansvar måste du släppa taget om nu?';
  }
  return 'Bra jobbat. Vad är nästa steg?';
}

function titleSv(key: MentorMilestoneKey) {
  if (key === 'first_project_built') return 'Första projektet byggt';
  if (key === 'first_mentor_conversation') return 'Första Mentor-samtalet';
  if (key === 'days_7') return '7 dagar på plattformen';
  if (key === 'days_30') return '30 dagar på plattformen';
  if (key === 'days_365') return '1 år på plattformen';
  if (key === 'first_customer') return 'Första kunden';
  if (key === 'revenue_100k_sek') return '100k SEK i intäkt';
  if (key === 'first_employee') return 'Första anställda';
  return 'Milstolpe';
}

function extractAnyText(payload: any) {
  const parts: string[] = [];
  for (const key of ['title', 'summary', 'goal', 'priority', 'challenge', 'text', 'note']) {
    const v = payload?.[key];
    if (typeof v === 'string' && v.trim().length > 0) {
      parts.push(v.trim());
    }
  }
  return parts.join(' ').toLowerCase();
}

export async function detectNewMilestones(args: { workspaceId: string; projectId: string; userId: string }) {
  const { data: projectRow, error: projError } = await supabaseAdmin
    .from('projects')
    .select('created_at')
    .eq('id', args.projectId)
    .eq('user_id', args.userId)
    .maybeSingle<{ created_at: string }>();

  if (projError || !projectRow) {
    throw new Error('[RIDVAN-E1402] Failed to load project for milestone detection');
  }

  const createdAt = projectRow.created_at;
  const days = daysBetweenUtc(createdAt, nowIso());

  const candidates: Array<{ key: MentorMilestoneKey; occurredAt: string }> = [];
  if (days >= 7) candidates.push({ key: 'days_7', occurredAt: createdAt });
  if (days >= 30) candidates.push({ key: 'days_30', occurredAt: createdAt });
  if (days >= 365) candidates.push({ key: 'days_365', occurredAt: createdAt });

  // Look at recent Brain events to detect first Mentor convo and first build.
  const { data: events, error: evError } = await supabaseAdmin
    .from('brain_events')
    .select('source, type, payload, occurred_at')
    .eq('project_id', args.projectId)
    .eq('user_id', args.userId)
    .order('occurred_at', { ascending: true })
    .limit(500);

  if (evError) {
    throw new Error(`[RIDVAN-E1403] Failed to load brain events: ${evError.message}`);
  }

  const firstMentor = (events ?? []).find((e: any) => e?.source === 'mentor');
  if (firstMentor) {
    candidates.push({ key: 'first_mentor_conversation', occurredAt: firstMentor.occurred_at });
  }

  const firstBuilder = (events ?? []).find((e: any) => e?.source === 'builder');
  if (firstBuilder) {
    candidates.push({ key: 'first_project_built', occurredAt: firstBuilder.occurred_at });
  }

  // Heuristic user-reported milestones from business events text.
  for (const ev of events ?? []) {
    const type = typeof (ev as any)?.type === 'string' ? String((ev as any).type) : '';
    if (!type.startsWith('business.')) {
      continue;
    }
    const txt = extractAnyText((ev as any).payload);

    if (txt.includes('första kund') || txt.includes('first customer') || txt.includes('first client')) {
      candidates.push({ key: 'first_customer', occurredAt: (ev as any).occurred_at });
    }
    if (txt.includes('100k') || txt.includes('100 000') || txt.includes('100000')) {
      if (txt.includes('sek') || txt.includes('kr') || txt.includes('revenue') || txt.includes('intäkt') || txt.includes('omsättning')) {
        candidates.push({ key: 'revenue_100k_sek', occurredAt: (ev as any).occurred_at });
      }
    }
    if (txt.includes('första anställd') || txt.includes('anställd') || txt.includes('hired') || txt.includes('employee')) {
      candidates.push({ key: 'first_employee', occurredAt: (ev as any).occurred_at });
    }
  }

  const dedupedKeys = Array.from(new Set(candidates.map((c) => c.key)));
  const newOnes: MentorMilestone[] = [];

  for (const key of dedupedKeys) {
    if (await hasMilestoneMemory({ workspaceId: args.workspaceId, key })) {
      continue;
    }

    const occurredAt = candidates.find((c) => c.key === key)?.occurredAt ?? nowIso();
    const milestone: MentorMilestone = {
      key,
      title: titleSv(key),
      message: messageSv({ key }),
      occurredAt,
    };

    await recordMilestone({ workspaceId: args.workspaceId, projectId: args.projectId, userId: args.userId, milestone });
    newOnes.push(milestone);
  }

  return newOnes;
}
