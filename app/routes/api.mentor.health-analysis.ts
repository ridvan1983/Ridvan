import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { streamText as aiStreamText, convertToCoreMessages } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { FEATURE_FLAGS } from '~/config/feature-flags';
import { getAPIKey } from '~/lib/.server/llm/api-key';
import { MAX_TOKENS } from '~/lib/.server/llm/constants';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { readBrainContext } from '~/lib/brain/read.server';
import { supabaseAdmin } from '~/lib/supabase/server';

type HealthCategory = 'Pengarna' | 'Kunderna' | 'Fokus' | 'Energin' | 'Riskerna';
type HealthEmoji = '💰' | '👥' | '🎯' | '⚡' | '🛡️';
type HealthStatus = 'good' | 'warning' | 'risk';
type StoredStatus = 'green' | 'yellow' | 'red';

type HealthMetric = {
  category: HealthCategory;
  emoji: HealthEmoji;
  status: HealthStatus;
  message: string;
};

type HealthAnalysisResponse = {
  metrics: HealthMetric[];
  topAction: string;
};

type HealthMetricRow = {
  id: string;
  project_id: string;
  user_id: string;
  metric: string;
  status: StoredStatus;
  value: string | null;
  notes: string | null;
  recorded_at: string;
};

const EXPECTED_METRICS: Array<{ category: HealthCategory; emoji: HealthEmoji }> = [
  { category: 'Pengarna', emoji: '💰' },
  { category: 'Kunderna', emoji: '👥' },
  { category: 'Fokus', emoji: '🎯' },
  { category: 'Energin', emoji: '⚡' },
  { category: 'Riskerna', emoji: '🛡️' },
];

function mapStoredStatus(status: StoredStatus): HealthStatus {
  if (status === 'green') return 'good';
  if (status === 'red') return 'risk';
  return 'warning';
}

function mapHealthStatus(status: HealthStatus): StoredStatus {
  if (status === 'good') return 'green';
  if (status === 'risk') return 'red';
  return 'yellow';
}

function normalizeMessage(value: unknown) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.slice(0, 220);
}

function normalizeTopAction(value: unknown) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.slice(0, 260);
}

function extractFirstJsonObject(text: string) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return text.slice(start, end + 1);
}

function parseHealthAnalysis(text: string): HealthAnalysisResponse | null {
  const cleaned = text.trim().replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '').trim();
  const rawJson = extractFirstJsonObject(cleaned) ?? cleaned;

  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const obj = parsed as Record<string, unknown>;
    const metricsRaw = Array.isArray(obj.metrics) ? obj.metrics : [];
    const topAction = normalizeTopAction(obj.topAction);

    const metrics: HealthMetric[] = EXPECTED_METRICS.map(({ category, emoji }) => {
      const match = metricsRaw.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).category === category) as
        | Record<string, unknown>
        | undefined;

      const statusRaw = typeof match?.status === 'string' ? match.status : 'warning';
      const status: HealthStatus = statusRaw === 'good' || statusRaw === 'risk' ? statusRaw : 'warning';
      const message = normalizeMessage(match?.message) || 'Jag ser inget akut här, men det är värt att följa upp lugnt och konkret.';
      const emojiValue = typeof match?.emoji === 'string' && match.emoji.trim().length > 0 ? (match.emoji as HealthEmoji) : emoji;

      return {
        category,
        emoji: emojiValue,
        status,
        message,
      };
    });

    if (metrics.length === 0 || !topAction) {
      return null;
    }

    return {
      metrics,
      topAction,
    };
  } catch {
    return null;
  }
}

function buildBrainSummary(brain: Awaited<ReturnType<typeof readBrainContext>>) {
  if (!brain) {
    return 'Brain är tomt.';
  }

  return JSON.stringify(
    {
      project: {
        currentStage: brain.state.currentStage,
        businessModel: brain.state.currentBusinessModel,
        primaryGoalSummary: brain.state.primaryGoalSummary,
        topPrioritySummary: brain.state.topPrioritySummary,
        mainChallengeSummary: brain.state.mainChallengeSummary,
        publishedStatus: brain.state.publishedStatus,
        currentSignals: brain.state.currentSignals,
      },
      industry: brain.industryProfile,
      geo: brain.geoProfile,
      activeEntries: brain.activeEntries.slice(0, 12).map((entry) => ({
        kind: entry.kind,
        title: entry.title,
        summary: entry.summary,
        data: entry.data,
      })),
    },
    null,
    2,
  );
}

function buildFallbackAnalysis(): HealthAnalysisResponse {
  return {
    metrics: [
      { category: 'Pengarna', emoji: '💰', status: 'warning', message: 'Pengarna verkar inte vara i akut fara, men du tjänar på att hålla extra koll på vad som faktiskt kommer in och går ut.' },
      { category: 'Kunderna', emoji: '👥', status: 'good', message: 'Det finns sannolikt relationer att bygga vidare på, så fortsätt hålla nära kontakt med de kunder som redan visar intresse.' },
      { category: 'Fokus', emoji: '🎯', status: 'warning', message: 'Det viktigaste nu är att välja ett tydligt nästa steg, så du inte sprider energi på för många saker samtidigt.' },
      { category: 'Energin', emoji: '⚡', status: 'good', message: 'Tempot känns hållbart just nu, så länge du prioriterar bort sådant som inte flyttar bolaget framåt.' },
      { category: 'Riskerna', emoji: '🛡️', status: 'warning', message: 'Jag ser inget alarmerande direkt, men små problem blir snabbt stora om de lämnas utan uppföljning.' },
    ],
    topAction: 'Ta 20 minuter idag och bestäm vad som är den enda viktigaste saken som måste bli klar den här veckan.',
  };
}

function tryParseStoredNotes(notes: string | null) {
  if (!notes) {
    return null;
  }

  try {
    const parsed = JSON.parse(notes) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    return parsed as { message?: string; topAction?: string };
  } catch {
    return null;
  }
}

function buildCachedAnalysis(rows: HealthMetricRow[]): HealthAnalysisResponse | null {
  if (rows.length === 0) {
    return null;
  }

  const recordedAt = rows[0]?.recorded_at;
  const sameBatch = rows.filter((row) => row.recorded_at === recordedAt);
  if (sameBatch.length < EXPECTED_METRICS.length) {
    return null;
  }

  const metrics: HealthMetric[] = [];
  let topAction = '';

  for (const expected of EXPECTED_METRICS) {
    const row = sameBatch.find((item) => item.metric === expected.category);
    if (!row) {
      return null;
    }

    const stored = tryParseStoredNotes(row.notes);
    const message = normalizeMessage(stored?.message) || 'Jag ser inget akut här, men det är värt att följa upp lugnt och konkret.';
    const action = normalizeTopAction(stored?.topAction);
    if (action) {
      topAction = action;
    }

    metrics.push({
      category: expected.category,
      emoji: (row.value as HealthEmoji) || expected.emoji,
      status: mapStoredStatus(row.status),
      message,
    });
  }

  if (!topAction) {
    return null;
  }

  return { metrics, topAction };
}

async function drainReadableStream(stream: ReadableStream) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) {
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  if (!FEATURE_FLAGS.mentorHealth) {
    return Response.json({ error: '[RIDVAN-E1360] Health analysis is disabled for MVP' }, { status: 404 });
  }

  try {
    const { user } = await requireUserFromBearerToken(request);
    const body = (await request.json().catch(() => null)) as { projectId?: string } | null;
    const projectId = typeof body?.projectId === 'string' ? body.projectId.trim() : '';

    if (!projectId) {
      return Response.json({ error: '[RIDVAN-E1361] Missing projectId' }, { status: 400 });
    }

    const cacheCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: cachedRows, error: cacheError } = await supabaseAdmin
      .from('mentor_health_metrics')
      .select('id, project_id, user_id, metric, status, value, notes, recorded_at')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .gte('recorded_at', cacheCutoff)
      .order('recorded_at', { ascending: false })
      .limit(25)
      .returns<HealthMetricRow[]>();

    if (cacheError) {
      return Response.json({ error: `[RIDVAN-E1362] Failed to load cached health analysis: ${cacheError.message}` }, { status: 500 });
    }

    const cachedAnalysis = buildCachedAnalysis(cachedRows ?? []);
    if (cachedAnalysis) {
      return Response.json({
        ok: true,
        metrics: cachedAnalysis.metrics,
        topAction: cachedAnalysis.topAction,
        recordedAt: (cachedRows ?? [])[0]?.recorded_at ?? new Date().toISOString(),
        cached: true,
      });
    }

    const brain = await readBrainContext({ projectId, userId: user.id }).catch(() => null);
    const apiKey = getAPIKey(context.cloudflare.env) ?? '';
    if (!apiKey) {
      const fallback = buildFallbackAnalysis();
      return Response.json({ ok: true, metrics: fallback.metrics, topAction: fallback.topAction, recordedAt: new Date().toISOString(), cached: false });
    }

    const anthropic = createAnthropic({ apiKey });
    let finalText = '';

    const result = await aiStreamText({
      model: anthropic('claude-sonnet-4-5-20250929'),
      system:
        'Du är en vänlig co-founder som analyserar ett bolag. Returnera ENDAST JSON, inga backticks, inget annat: {"metrics":[{"category":"Pengarna","emoji":"💰","status":"good|warning|risk","message":"En mening på enkelt svenska"},{"category":"Kunderna","emoji":"👥","status":"good|warning|risk","message":"En mening på enkelt svenska"},{"category":"Fokus","emoji":"🎯","status":"good|warning|risk","message":"En mening på enkelt svenska"},{"category":"Energin","emoji":"⚡","status":"good|warning|risk","message":"En mening på enkelt svenska"},{"category":"Riskerna","emoji":"🛡️","status":"good|warning|risk","message":"En mening på enkelt svenska"}],"topAction":"En konkret enkel sak entreprenören ska göra idag"}. Använd Brain-data för att göra analysen personlig. Om Brain är tom, gör en generell uppmuntrande analys. Skriv på enkel svenska utan jargong.',
      maxTokens: Math.min(MAX_TOKENS, 900),
      temperature: 0.4,
      messages: convertToCoreMessages([
        {
          role: 'user',
          content: `Här är Brain-data för projektet:\n${buildBrainSummary(brain)}\n\nAnalysera bolaget nu.`,
        },
      ]),
      onFinish: async (event) => {
        const { text } = event as { text: string };
        finalText = text;
      },
    });

    await drainReadableStream(result.toAIStream());

    const analysis = parseHealthAnalysis(finalText) ?? buildFallbackAnalysis();
    const recordedAt = new Date().toISOString();

    const insertRows = analysis.metrics.map((metric) => ({
      project_id: projectId,
      user_id: user.id,
      metric: metric.category,
      status: mapHealthStatus(metric.status),
      value: metric.emoji,
      notes: JSON.stringify({ message: metric.message, topAction: analysis.topAction }),
      recorded_at: recordedAt,
    }));

    const { error: insertError } = await supabaseAdmin.from('mentor_health_metrics').insert(insertRows);
    if (insertError) {
      return Response.json({ error: `[RIDVAN-E1363] Failed to store health analysis: ${insertError.message}` }, { status: 500 });
    }

    return Response.json({
      ok: true,
      metrics: analysis.metrics,
      topAction: analysis.topAction,
      recordedAt,
      cached: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return Response.json({ error: `[RIDVAN-E1364] Health analysis failed: ${message}` }, { status: 500 });
  }
}
