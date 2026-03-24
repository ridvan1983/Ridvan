import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { getAPIKey } from '~/lib/.server/llm/api-key';
import { readBrainContext } from '~/lib/brain/read.server';
import { getVerticalContext } from '~/lib/vertical/context.server';
import { buildOpportunityContext } from '~/lib/opportunity/context.server';
import { supabaseAdmin } from '~/lib/supabase/server';

export type WeeklyDigest = {
  lang: 'sv' | 'tr' | 'en';
  subject: string;
  weekLabel: string;
  businessName: string;
  statusLine: string;
  whatWorked: string;
  whatDidNotWork: string;
  oneThingThisWeek: string;
  cofounderSays: string;
};

function pickLanguage(languageCodes: string[]) {
  const first = (languageCodes[0] ?? '').toLowerCase();
  if (first.startsWith('sv')) return 'sv';
  if (first.startsWith('tr')) return 'tr';
  return 'en';
}

function asObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value.map((item) => asString(item)).filter(Boolean);
}

function startOfLastWeekUtc(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - 7);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function isoWeekLabel(date = new Date()) {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return String(week);
}

function extractProjectAnalysis(activeEntries: Array<{ data: Record<string, unknown>; kind: string; entityKey: string }>) {
  const entry = activeEntries.find(
    (item) =>
      item.kind === 'project_analysis' ||
      item.entityKey.includes('project_analysis') ||
      item.entityKey.includes('project.analyzed') ||
      Boolean(asString(item.data.businessName) || asString(item.data.targetAudience)),
  );

  const data = entry ? asObject(entry.data) : {};
  return {
    businessName: asString(data.businessName),
    whatTheySell: asStringArray(data.whatTheySell),
    activeFeatures: asStringArray(data.activeFeatures),
    missingFeatures: asStringArray(data.missingFeatures),
    targetAudience: asString(data.targetAudience),
    toneOfVoice: asString(data.toneOfVoice),
    revenueOpportunities: asStringArray(data.revenueOpportunities),
  };
}

function extractJsonObject(raw: string) {
  const trimmed = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('[RIDVAN-E1121] Digest model response did not contain valid JSON');
  }

  return trimmed.slice(start, end + 1);
}

function normalizeDigest(lang: WeeklyDigest['lang'], value: unknown, fallbackBusinessName: string): WeeklyDigest {
  const source = asObject(value);
  const businessName = asString(source.businessName) || fallbackBusinessName || 'Ridvan project';
  const weekLabel = asString(source.weekLabel) || isoWeekLabel();
  const statusLine = asString(source.statusLine);
  const whatWorked = asString(source.whatWorked);
  const whatDidNotWork = asString(source.whatDidNotWork);
  const oneThingThisWeek = asString(source.oneThingThisWeek);
  const cofounderSays = asString(source.cofounderSays);
  const subject =
    asString(source.subject) ||
    (lang === 'sv'
      ? `Vecka ${weekLabel} — ${businessName} — din co-founder rapporterar`
      : lang === 'tr'
        ? `Hafta ${weekLabel} — ${businessName} — kurucu ortağın rapor ediyor`
        : `Week ${weekLabel} — ${businessName} — your co-founder reports`);

  return {
    lang,
    subject,
    weekLabel,
    businessName,
    statusLine,
    whatWorked,
    whatDidNotWork,
    oneThingThisWeek,
    cofounderSays,
  };
}

export async function buildWeeklyDigestInsights(args: { projectId: string; userId: string; env?: Env }) {
  const brain = await readBrainContext({ projectId: args.projectId, userId: args.userId });
  if (!brain) return null;

  const vertical = await getVerticalContext({ projectId: args.projectId, userId: args.userId });
  const opportunity = await buildOpportunityContext({ projectId: args.projectId, userId: args.userId });

  const geoLangs = brain.geoProfile?.languageCodes ?? [];
  const lang = pickLanguage(geoLangs) as WeeklyDigest['lang'];
  const industry = brain.industryProfile?.normalizedIndustry ?? (vertical as any)?.industryProfile?.normalizedIndustry ?? 'unknown';
  const analysis = extractProjectAnalysis(brain.activeEntries);

  const since = startOfLastWeekUtc();

  const workspaceId = brain.state.workspaceId;

  const [{ data: events }, { data: milestoneRows }, { data: healthRows }] = await Promise.all([
    supabaseAdmin
      .from('brain_events')
      .select('source, type, occurred_at')
      .eq('project_id', args.projectId)
      .eq('user_id', args.userId)
      .gte('occurred_at', since.toISOString())
      .order('occurred_at', { ascending: false })
      .limit(200),
    supabaseAdmin
      .from('brain_memory_entries')
      .select('kind, title, created_at')
      .eq('workspace_id', workspaceId)
      .eq('kind', 'milestone')
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(20),
    supabaseAdmin
      .from('mentor_health_metrics')
      .select('metric, status, recorded_at')
      .eq('project_id', args.projectId)
      .eq('user_id', args.userId)
      .gte('recorded_at', since.toISOString())
      .order('recorded_at', { ascending: false })
      .limit(50),
  ]);

  const builderEvents = (events ?? []).filter((event: any) => event?.source === 'builder');
  const mentorEvents = (events ?? []).filter((event: any) => event?.source === 'mentor');
  const publishEvents = (events ?? []).filter((event: any) => event?.type === 'project.published');
  const analyzedEvents = (events ?? []).filter((event: any) => event?.type === 'project.analyzed');
  const changedEvents = (events ?? []).filter((event: any) => event?.type === 'project.files_changed');
  const milestoneTitles = (milestoneRows ?? []).map((m: any) => (typeof m?.title === 'string' ? m.title : null)).filter(Boolean) as string[];
  const healthStatuses = Array.from(
    new Set((healthRows ?? []).map((r: any) => (r?.status === 'green' || r?.status === 'yellow' || r?.status === 'red' ? r.status : null)).filter(Boolean)),
  ) as Array<'green' | 'yellow' | 'red'>;

  const businessName = analysis.businessName || analysis.whatTheySell[0] || 'Ridvan project';
  const weekLabel = isoWeekLabel();
  const apiKey = getAPIKey(args.env ?? ((globalThis as any)?.env ?? undefined));

  if (!apiKey) {
    return {
      lang,
      subject:
        lang === 'sv'
          ? `Vecka ${weekLabel} — ${businessName} — din co-founder rapporterar`
          : lang === 'tr'
            ? `Hafta ${weekLabel} — ${businessName} — kurucu ortağın rapor ediyor`
            : `Week ${weekLabel} — ${businessName} — your co-founder reports`,
      weekLabel,
      businessName,
      statusLine:
        lang === 'sv'
          ? `Den här veckan såg vi ${builderEvents.length} byggaktiviteter, ${mentorEvents.length} Mentor-interaktioner och ${publishEvents.length} publiceringar.`
          : lang === 'tr'
            ? `Bu hafta ${builderEvents.length} build aktivitesi, ${mentorEvents.length} Mentor etkileşimi ve ${publishEvents.length} yayın gördük.`
            : `This week we saw ${builderEvents.length} build activities, ${mentorEvents.length} Mentor interactions, and ${publishEvents.length} publish events.`,
      whatWorked: milestoneTitles[0] || analysis.activeFeatures[0] || analysis.revenueOpportunities[0] || 'Momentum increased in a concrete part of the business.',
      whatDidNotWork:
        analysis.missingFeatures[0] ||
        (healthStatuses.includes('red')
          ? 'A critical risk signal remained unresolved.'
          : 'The company still has one unresolved bottleneck holding back growth.'),
      oneThingThisWeek: (opportunity?.opportunities?.[0] as any)?.reasoning ?? analysis.revenueOpportunities[0] ?? 'Remove the single biggest friction point in the main conversion flow.',
      cofounderSays:
        lang === 'sv'
          ? 'Du har momentum, men bara om du använder veckan till att stänga den tydligaste luckan i flödet. Jag skulle fokusera på en sak som påverkar omsättning direkt och mäta resultatet samma vecka.'
          : lang === 'tr'
            ? 'Momentumu var ama bu hafta en net darboğazı kapatırsan gerçek etki görürsün. Ben doğrudan geliri etkileyen tek bir hamleye odaklanır ve sonucu aynı hafta ölçerdim.'
            : 'You have momentum, but only if you use this week to close the clearest gap in the flow. I would focus on the one move that affects revenue directly and measure the result this week.',
    };
  }

  const anthropic = createAnthropic({ apiKey });
  const prompt = `Create a weekly co-founder email digest for exactly one company.
Return ONLY valid JSON with this shape:
{
  "subject": string,
  "weekLabel": string,
  "businessName": string,
  "statusLine": string,
  "whatWorked": string,
  "whatDidNotWork": string,
  "oneThingThisWeek": string,
  "cofounderSays": string
}

Rules:
- Never be generic.
- Write in the target language only: ${lang}.
- Subject should follow this structure in the target language: Week/Vecka/Hafta [X] — [BusinessName] — your co-founder reports.
- LÄGET/statusLine must be one sentence.
- VAD SOM FUNKADE/whatWorked must be specific to positive activity from the last 7 days.
- VAD SOM INTE FUNKADE/whatDidNotWork must be honest and specific.
- EN SAK DENNA VECKA/oneThingThisWeek must be one concrete action, not a list.
- DIN CO-FOUNDER SÄGER/cofounderSays must be 2-3 sentences and sound like a direct partner speaking to the founder.

Company context:
- project_id: ${args.projectId}
- user_id: ${args.userId}
- business_name: ${businessName}
- industry: ${industry}
- geo: ${brain.geoProfile ? JSON.stringify(brain.geoProfile) : 'unknown'}
- project_analysis: ${JSON.stringify(analysis)}
- state: ${JSON.stringify(brain.state)}
- active_entries: ${JSON.stringify(
    brain.activeEntries.map((entry) => ({
      kind: entry.kind,
      title: entry.title,
      summary: entry.summary,
      assertedAt: entry.assertedAt,
      createdAt: entry.createdAt,
      data: entry.data,
    })),
  )}
- vertical_context: ${JSON.stringify(vertical ?? null)}
- opportunity_context: ${JSON.stringify(opportunity ?? null)}
- last_7_days_summary: ${JSON.stringify({
    builder_event_count: builderEvents.length,
    mentor_event_count: mentorEvents.length,
    published_event_count: publishEvents.length,
    analyzed_event_count: analyzedEvents.length,
    file_change_event_count: changedEvents.length,
    milestone_titles: milestoneTitles,
    health_statuses: healthStatuses,
    health_rows: healthRows ?? [],
    events: events ?? [],
  })}

Return only JSON.`;

  const result = await generateText({
    model: anthropic('claude-sonnet-4-5-20250929'),
    temperature: 0.2,
    maxTokens: 1400,
    prompt,
  });

  return normalizeDigest(lang, JSON.parse(extractJsonObject(result.text)), businessName);
}
