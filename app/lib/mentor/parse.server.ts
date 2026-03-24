import type { BrainEventInput } from '~/lib/brain/types';

export interface MentorModelOutput {
  reply: string;
  events: BrainEventInput[];
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

export function parseMentorJson(text: string): MentorModelOutput {
  const cleaned = stripCodeFences(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned) as unknown;
  } catch {
    const extracted = extractFirstJsonObject(cleaned);
    if (!extracted) {
      return { reply: cleaned.trim(), events: [] };
    }
    try {
      parsed = JSON.parse(extracted) as unknown;
    } catch {
      return { reply: cleaned.trim(), events: [] };
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

  const events: BrainEventInput[] = (eventsRaw ?? []).map((e) => {
    if (!e || typeof e !== 'object') {
      throw new Error('[RIDVAN-E863] Mentor output event is not an object');
    }

    const ev = e as Record<string, unknown>;
    const type = typeof ev.type === 'string' ? ev.type.trim() : null;
    const payload = ev.payload && typeof ev.payload === 'object' ? (ev.payload as Record<string, unknown>) : null;
    const idempotencyKey = typeof ev.idempotencyKey === 'string' ? ev.idempotencyKey.trim() : null;
    const source = typeof ev.source === 'string' ? (ev.source as any) : undefined;

    if (!type || type.length === 0 || !payload) {
      throw new Error('[RIDVAN-E864] Mentor event missing type/payload');
    }

    return {
      type,
      payload,
      idempotencyKey,
      source,
    };
  });

  return { reply, events };
}
