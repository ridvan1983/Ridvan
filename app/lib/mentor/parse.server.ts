import type { BrainEventInput } from '~/lib/brain/types';
import { parseMentorInsightPayload, type MentorInsightPayload } from '~/lib/mentor/proactive-message';

export interface MentorModelOutput {
  reply: string;
  events: BrainEventInput[];
  insight: MentorInsightPayload | null;
}

function stripCodeFences(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '').trim();
  }
  return trimmed;
}

function extractFirstJsonObject(text: string) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}

const RIDVAN_EVENTS_MARK = '\n---RIDVAN_EVENTS---\n';
const RIDVAN_INSIGHT_MARK = '\n---RIDVAN_INSIGHT---\n';

function parseInsightSection(tail: string): MentorInsightPayload | null {
  const idx = tail.indexOf(RIDVAN_INSIGHT_MARK);
  if (idx === -1) {
    return null;
  }
  const jsonPart = tail.slice(idx + RIDVAN_INSIGHT_MARK.length).trim();
  if (!jsonPart) {
    return null;
  }
  try {
    return parseMentorInsightPayload(JSON.parse(jsonPart) as unknown);
  } catch {
    return null;
  }
}

function eventsSegmentOnly(afterEventsMark: string): string {
  const idx = afterEventsMark.indexOf(RIDVAN_INSIGHT_MARK);
  return (idx === -1 ? afterEventsMark : afterEventsMark.slice(0, idx)).trim();
}

function parseEventsArray(raw: unknown): BrainEventInput[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((e) => {
    if (!e || typeof e !== 'object') {
      throw new Error('[RIDVAN-E865] Mentor events array item is not an object');
    }
    const ev = e as Record<string, unknown>;
    const type = typeof ev.type === 'string' ? ev.type.trim() : null;
    const payload = ev.payload && typeof ev.payload === 'object' ? (ev.payload as Record<string, unknown>) : null;
    const idempotencyKey = typeof ev.idempotencyKey === 'string' ? ev.idempotencyKey.trim() : null;
    const source = typeof ev.source === 'string' ? (ev.source as any) : undefined;
    if (!type || type.length === 0 || !payload) {
      throw new Error('[RIDVAN-E866] Mentor event missing type/payload');
    }
    return { type, payload, idempotencyKey, source };
  });
}

/**
 * Supports (1) legacy full JSON {"reply","events"} or (2) markdown reply + ---RIDVAN_EVENTS--- + {"events":[]}.
 */
export function parseMentorUnifiedOutput(text: string): MentorModelOutput {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('[RIDVAN-E867] Mentor output empty');
  }

  const idx = trimmed.indexOf(RIDVAN_EVENTS_MARK);
  if (idx !== -1) {
    const reply = trimmed.slice(0, idx).trim();
    const afterEvents = trimmed.slice(idx + RIDVAN_EVENTS_MARK.length);
    const insight = parseInsightSection(afterEvents);
    const eventsBlock = eventsSegmentOnly(afterEvents);
    const jsonLine = eventsBlock.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
    if (!reply) {
      throw new Error('[RIDVAN-E868] Mentor segmented output missing reply');
    }
    let events: BrainEventInput[] = [];
    if (jsonLine.length > 0) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonLine) as unknown;
      } catch {
        throw new Error('[RIDVAN-E869] Mentor events JSON invalid after separator');
      }
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('[RIDVAN-E870] Mentor events JSON not an object');
      }
      const obj = parsed as Record<string, unknown>;
      events = parseEventsArray(obj.events);
    }
    return { reply, events, insight };
  }

  try {
    return parseMentorJson(trimmed);
  } catch {
    return { reply: trimmed, events: [], insight: null };
  }
}

export function parseMentorJson(text: string): MentorModelOutput {
  const cleaned = stripCodeFences(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned) as unknown;
  } catch {
    const extracted = extractFirstJsonObject(cleaned);
    if (!extracted) {
      return { reply: cleaned.trim(), events: [], insight: null };
    }
    try {
      parsed = JSON.parse(extracted) as unknown;
    } catch {
      return { reply: cleaned.trim(), events: [], insight: null };
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('[RIDVAN-E861] Mentor output is not an object');
  }

  const obj = parsed as Record<string, unknown>;
  const reply = typeof obj.reply === 'string' ? obj.reply : null;
  const eventsRaw = Array.isArray(obj.events) ? obj.events : null;

  if (!reply) {
    throw new Error('[RIDVAN-E862] Mentor output missing reply');
  }

  const events = parseEventsArray(eventsRaw ?? []);

  const insightRaw = obj.insight;
  const insight = parseMentorInsightPayload(insightRaw);

  return { reply, events, insight };
}
