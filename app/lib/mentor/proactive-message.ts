export const RIDVAN_MENTOR_TRIGGER_MARK = '__RIDVAN_MENTOR_TRIGGER__=';
export const RIDVAN_MENTOR_INSIGHT_MARK = '__RIDVAN_MENTOR_INSIGHT__=';

export type MentorInsightKind = 'warning' | 'opportunity' | 'milestone' | 'tip';

export type MentorInsightPayload = {
  type: MentorInsightKind;
  title: string;
  description: string;
  action: string;
};

export type ParsedProactiveMentorMessage = {
  triggerType: string | null;
  insight: MentorInsightPayload | null;
  body: string;
};

function isInsightKind(value: unknown): value is MentorInsightKind {
  return value === 'warning' || value === 'opportunity' || value === 'milestone' || value === 'tip';
}

export function parseMentorInsightPayload(raw: unknown): MentorInsightPayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const type = o.type;
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const description = typeof o.description === 'string' ? o.description.trim() : '';
  const action = typeof o.action === 'string' ? o.action.trim() : '';
  if (!isInsightKind(type) || !title || !description || !action) {
    return null;
  }
  return { type, title, description, action };
}

/** Proactive system messages: trigger header + optional insight JSON + body. */
export function buildProactiveMentorStorage(args: {
  triggerType: string;
  insight: MentorInsightPayload | null;
  bodyMarkdown: string;
}): string {
  const insightLine =
    args.insight != null ? `${RIDVAN_MENTOR_INSIGHT_MARK}${JSON.stringify(args.insight)}\n` : '';
  return `${RIDVAN_MENTOR_TRIGGER_MARK}${args.triggerType}\n${insightLine}---\n${args.bodyMarkdown.trim()}`;
}

export function parseProactiveMentorStorage(content: string): ParsedProactiveMentorMessage {
  const trimmed = content.trim();
  if (!trimmed.startsWith(RIDVAN_MENTOR_TRIGGER_MARK)) {
    return { triggerType: null, insight: null, body: content };
  }

  const lines = trimmed.split('\n');
  const first = lines[0] ?? '';
  const triggerType = first.startsWith(RIDVAN_MENTOR_TRIGGER_MARK)
    ? first.slice(RIDVAN_MENTOR_TRIGGER_MARK.length).trim() || null
    : null;

  let i = 1;
  let insight: MentorInsightPayload | null = null;
  if (lines[i]?.startsWith(RIDVAN_MENTOR_INSIGHT_MARK)) {
    const jsonPart = lines[i].slice(RIDVAN_MENTOR_INSIGHT_MARK.length).trim();
    try {
      insight = parseMentorInsightPayload(JSON.parse(jsonPart) as unknown);
    } catch {
      insight = null;
    }
    i += 1;
  }

  if (lines[i]?.trim() === '---') {
    i += 1;
  }

  const body = lines.slice(i).join('\n').trim();
  return { triggerType, insight, body: body || trimmed };
}

const RIDVAN_INSIGHT_TRAILER = '\n---RIDVAN_INSIGHT---\n';

/** Strip trailing ---RIDVAN_INSIGHT--- JSON from streamed/stored mentor replies. */
export function splitMentorInsightTrailer(content: string): { visible: string; insight: MentorInsightPayload | null } {
  const idx = content.lastIndexOf(RIDVAN_INSIGHT_TRAILER);
  if (idx === -1) {
    return { visible: content, insight: null };
  }

  const visible = content.slice(0, idx).trimEnd();
  const jsonPart = content.slice(idx + RIDVAN_INSIGHT_TRAILER.length).trim();
  try {
    return { visible, insight: parseMentorInsightPayload(JSON.parse(jsonPart) as unknown) };
  } catch {
    return { visible: content, insight: null };
  }
}

export function appendMentorInsightTrailer(visibleReply: string, insight: MentorInsightPayload | null): string {
  if (!insight) {
    return visibleReply;
  }
  return `${visibleReply.trimEnd()}${RIDVAN_INSIGHT_TRAILER}${JSON.stringify(insight)}`;
}
