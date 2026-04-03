export type MentorAskAttachmentPayload = {
  filename: string;
  mimeType: string;
  url?: string;
  extractedText?: string | null;
  byteSize?: number;
  storage?: {
    bucket?: string;
    path?: string;
  };
};

export async function mentorAsk(
  accessToken: string,
  payload: {
    projectId: string;
    message: string;
    sessionId?: string;
    attachments?: MentorAskAttachmentPayload[];
    systemInstruction?: string;
  },
) {
  const res = await fetch('/api/mentor', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const json = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    // Mentor sometimes returns a user-facing reply even when status is 403 (gating / credits).
    // In that case, surface the reply to the UI so it can be shown in chat.
    if (json && typeof json === 'object' && 'reply' in json && typeof (json as any).reply === 'string') {
      return json as { reply: string; events?: Array<{ type: string; payload: Record<string, unknown> }>; eventsWritten?: number };
    }
    const message =
      json && typeof json === 'object' && 'error' in json && typeof (json as any).error === 'string'
        ? String((json as any).error)
        : `[RIDVAN-E871] Mentor request failed (${res.status})`;
    throw new Error(message);
  }

  return json as { reply: string; events?: Array<{ type: string; payload: Record<string, unknown> }>; eventsWritten?: number };
}

export type MentorStreamHandlers = {
  /** Called once when the HTTP response has a readable SSE body (before first byte). */
  onStreamConnected?: () => void;
  onDelta: (text: string) => void;
  onFirstDelta?: () => void;
};

export type MentorStreamSuccess = {
  ok: true;
  reply: string;
  events: Array<{ type: string; payload: Record<string, unknown> }>;
  eventsWritten?: number;
};

export type MentorStreamFailure = {
  ok: false;
  partialReply: string;
  reason: 'http_error' | 'connection_lost' | 'incomplete_stream' | 'sse_error';
  message: string;
};

export type MentorStreamResult = MentorStreamSuccess | MentorStreamFailure;

export async function mentorAskStream(
  accessToken: string,
  payload: {
    projectId: string;
    message: string;
    sessionId?: string;
    attachments?: MentorAskAttachmentPayload[];
    systemInstruction?: string;
  },
  handlers: MentorStreamHandlers,
): Promise<MentorStreamResult> {
  const res = await fetch('/api/mentor', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...payload, stream: true }),
  });

  if (!res.ok || !res.body) {
    const asJson = (await res.json().catch(() => null)) as unknown;
    if (asJson && typeof asJson === 'object' && 'reply' in asJson) {
      const row = asJson as Record<string, unknown>;
      if (typeof row.reply === 'string') {
        const ev = row.events;
        const events = Array.isArray(ev) ? (ev as Array<{ type: string; payload: Record<string, unknown> }>) : [];
        const eventsWritten = typeof row.eventsWritten === 'number' ? row.eventsWritten : undefined;
        return { ok: true, reply: row.reply, events, eventsWritten };
      }
    }
    const message =
      asJson && typeof asJson === 'object' && 'error' in asJson && typeof (asJson as { error?: unknown }).error === 'string'
        ? String((asJson as { error: string }).error)
        : `[RIDVAN-E1788] Mentor stream failed (${res.status})`;
    return { ok: false, partialReply: '', reason: 'http_error', message };
  }

  handlers.onStreamConnected?.();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let donePayload: {
    reply: string;
    events: Array<{ type: string; payload: Record<string, unknown> }>;
    eventsWritten?: number;
  } | null = null;

  let aggregatedFromDeltas = '';
  let firstDeltaNotified = false;

  const notifyDelta = (d: string) => {
    if (d.length === 0) {
      return;
    }
    aggregatedFromDeltas += d;
    if (!firstDeltaNotified) {
      firstDeltaNotified = true;
      handlers.onFirstDelta?.();
    }
    handlers.onDelta(d);
  };

  try {
    while (true) {
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await reader.read();
      } catch (readErr) {
        const msg = readErr instanceof Error ? readErr.message : String(readErr ?? 'read error');
        return {
          ok: false,
          partialReply: aggregatedFromDeltas,
          reason: 'connection_lost',
          message: msg,
        };
      }

      const { value, done } = readResult;
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const line = part
          .split('\n')
          .map((l) => l.trim())
          .find((l) => l.startsWith('data:'));
        if (!line) {
          continue;
        }
        const raw = line.replace(/^data:\s?/, '').trim();
        if (!raw) {
          continue;
        }
        let parsed: { t?: string; d?: string; reply?: string; events?: unknown; eventsWritten?: number; error?: string; message?: string };
        try {
          parsed = JSON.parse(raw) as typeof parsed;
        } catch {
          continue;
        }
        if (parsed.t === 'delta' && typeof parsed.d === 'string') {
          notifyDelta(parsed.d);
        }
        if (parsed.t === 'done' && typeof parsed.reply === 'string') {
          donePayload = {
            reply: parsed.reply,
            events: Array.isArray(parsed.events) ? (parsed.events as Array<{ type: string; payload: Record<string, unknown> }>) : [],
            eventsWritten: typeof parsed.eventsWritten === 'number' ? parsed.eventsWritten : undefined,
          };
        }
        if (parsed.t === 'error') {
          const msg =
            typeof parsed.message === 'string'
              ? parsed.message
              : typeof parsed.error === 'string'
                ? parsed.error
                : '[RIDVAN-E1789] Mentor stream error';
          return {
            ok: false,
            partialReply: aggregatedFromDeltas,
            reason: 'sse_error',
            message: msg,
          };
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  if (!donePayload) {
    return {
      ok: false,
      partialReply: aggregatedFromDeltas,
      reason: 'incomplete_stream',
      message: '[RIDVAN-E1790] Mentor stream ended without done event',
    };
  }

  return {
    ok: true,
    reply: donePayload.reply,
    events: donePayload.events,
    eventsWritten: donePayload.eventsWritten,
  };
}

export function logMentorStreamError(
  accessToken: string,
  args: { message: string; metadata?: Record<string, unknown> },
): void {
  void fetch('/api/mentor/stream-log', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  }).catch(() => undefined);
}

export async function runMentorBuilderSeed(accessToken: string, payload: { projectId: string; initialPrompt: string }) {
  const res = await fetch('/api/brain/builder-seed', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json && typeof (json as { error?: unknown }).error === 'string'
        ? String((json as { error: string }).error)
        : `[RIDVAN-E1791] Builder seed failed (${res.status})`;
    throw new Error(message);
  }

  return json as { ok: true; wroteEvents: number };
}

export async function generateMentorDocument(args: {
  accessToken: string;
  projectId: string;
  title: string;
  documentType: string;
  format: 'pdf' | 'docx' | 'xlsx' | 'pptx';
  content: string;
}) {
  const res = await fetch('/api/mentor/document/generate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      projectId: args.projectId,
      title: args.title,
      documentType: args.documentType,
      format: args.format,
      content: args.content,
    }),
  });

  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json && typeof (json as any).error === 'string'
        ? String((json as any).error)
        : `[RIDVAN-E1601] Mentor document generate failed (${res.status})`;
    throw new Error(message);
  }

  return json as { ok: true; url: string; filename: string };
}

export async function readMentorUnread(accessToken: string) {
  const res = await fetch('/api/mentor/unread', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json && typeof (json as any).error === 'string'
        ? String((json as any).error)
        : `[RIDVAN-E1704] Mentor unread request failed (${res.status})`;
    throw new Error(message);
  }

  return json as { ok: true; unreadByProject: Record<string, boolean> };
}

export async function setMentorUnreadState(accessToken: string, projectId: string, hasUnread: boolean) {
  const res = await fetch('/api/mentor/unread', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ projectId, hasUnread }),
  });

  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json && typeof (json as any).error === 'string'
        ? String((json as any).error)
        : `[RIDVAN-E1705] Mentor unread update failed (${res.status})`;
    throw new Error(message);
  }

  return json as { ok: true };
}

export async function readMentorMessages(accessToken: string, projectId: string) {
  const res = await fetch(`/api/mentor/messages?projectId=${encodeURIComponent(projectId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json && typeof (json as any).error === 'string'
        ? String((json as any).error)
        : `[RIDVAN-E1505] Mentor messages request failed (${res.status})`;
    throw new Error(message);
  }

  return json as {
    ok: true;
    messages: Array<{ id: string; role: 'user' | 'mentor'; content: string; created_at: string; session_id?: string | null }>;
  };
}

export async function appendMentorMessage(
  accessToken: string,
  args: { projectId: string; role: 'user' | 'mentor'; content: string; createdAt?: string; sessionId?: string },
) {
  const res = await fetch('/api/mentor/messages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });

  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json && typeof (json as any).error === 'string'
        ? String((json as any).error)
        : `[RIDVAN-E1506] Mentor message write failed (${res.status})`;
    throw new Error(message);
  }

  return json as { ok: true; message: unknown };
}

export async function readBrainState(accessToken: string, projectId: string) {
  const res = await fetch(`/api/brain/state/${encodeURIComponent(projectId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(`[RIDVAN-E872] Brain state request failed (${res.status})`);
  }

  return (await res.json()) as unknown;
}

export type MentorHealthAnalysisMetric = {
  category: 'Pengarna' | 'Kunderna' | 'Fokus' | 'Energin' | 'Riskerna';
  emoji: '💰' | '👥' | '🎯' | '⚡' | '🛡️';
  status: 'good' | 'warning' | 'risk';
  message: string;
};

export async function runMentorHealthAnalysis(accessToken: string, projectId: string) {
  const res = await fetch('/api/mentor/health-analysis', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ projectId }),
  });

  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json && typeof (json as any).error === 'string'
        ? String((json as any).error)
        : `[RIDVAN-E1360] Health analysis failed (${res.status})`;
    throw new Error(message);
  }

  return json as {
    ok: true;
    metrics: MentorHealthAnalysisMetric[];
    topAction: string;
    recordedAt: string;
    cached: boolean;
  };
}

export async function readDailyPriority(accessToken: string, projectId: string) {
  const res = await fetch(`/api/mentor/daily-priority?projectId=${encodeURIComponent(projectId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const json = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json && typeof (json as any).error === 'string'
        ? String((json as any).error)
        : `[RIDVAN-E1208] Daily priority request failed (${res.status})`;
    throw new Error(message);
  }

  return json as { ok: true; priority: null | { id: string; priority_text: string; date: string; completed: boolean }; date: string };
}

export async function generateDailyPriority(accessToken: string, projectId: string) {
  const res = await fetch('/api/mentor/daily-priority', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ projectId, op: 'generate' }),
  });

  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json && typeof (json as any).error === 'string'
        ? String((json as any).error)
        : `[RIDVAN-E1209] Daily priority generate failed (${res.status})`;
    throw new Error(message);
  }

  return json as { ok: true; priority: { id: string; priority_text: string; date: string; completed: boolean }; date: string };
}

export async function toggleDailyPriority(accessToken: string, projectId: string, completed: boolean) {
  const res = await fetch('/api/mentor/daily-priority', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ projectId, op: 'toggle', completed }),
  });

  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json && typeof (json as any).error === 'string'
        ? String((json as any).error)
        : `[RIDVAN-E1210] Daily priority toggle failed (${res.status})`;
    throw new Error(message);
  }

  return json as { ok: true; priority: null | { id: string; priority_text: string; date: string; completed: boolean }; date: string };
}

export async function readMentorHealth(accessToken: string, projectId: string) {
  const res = await fetch(`/api/mentor/health?projectId=${encodeURIComponent(projectId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json && typeof (json as any).error === 'string'
        ? String((json as any).error)
        : `[RIDVAN-E1310] Mentor health request failed (${res.status})`;
    throw new Error(message);
  }

  return json as {
    ok: true;
    metrics: Array<
      | null
      | {
          id: string;
          metric: string;
          status: 'green' | 'yellow' | 'red';
          value: string | null;
          notes: string | null;
          recorded_at: string;
        }
    >;
    allMetrics: string[];
  };
}

export async function writeMentorHealth(accessToken: string, args: { projectId: string; metric: string; status: 'green' | 'yellow' | 'red'; value?: string; notes?: string }) {
  const res = await fetch('/api/mentor/health', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });

  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json && typeof (json as any).error === 'string'
        ? String((json as any).error)
        : `[RIDVAN-E1311] Mentor health write failed (${res.status})`;
    throw new Error(message);
  }

  return json as { ok: true; metric: unknown };
}

export async function runMilestoneCheck(accessToken: string, projectId: string) {
  const res = await fetch('/api/mentor/milestones', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ projectId }),
  });

  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json && typeof (json as any).error === 'string'
        ? String((json as any).error)
        : `[RIDVAN-E1412] Milestone check failed (${res.status})`;
    throw new Error(message);
  }

  return json as { ok: true; milestones: Array<{ key: string; title: string; message: string; occurredAt: string }> };
}

export async function runHealthCheckIn(accessToken: string, projectId: string) {
  const res = await fetch('/api/mentor/health/checkin', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ projectId }),
  });

  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json && typeof (json as any).error === 'string'
        ? String((json as any).error)
        : `[RIDVAN-E1353] Health check-in failed (${res.status})`;
    throw new Error(message);
  }

  return json as {
    ok: true;
    messages: string[];
    missingMetrics: string[];
    alreadySentRecently: boolean;
  };
}

export async function runVerticalExtract(accessToken: string, payload: { projectId: string; text: string }) {
  const res = await fetch('/api/vertical/extract', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const json = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json && typeof (json as any).error === 'string'
        ? String((json as any).error)
        : `[RIDVAN-E875] Vertical extract failed (${res.status})`;
    throw new Error(message);
  }

  return json as unknown;
}

export async function readVerticalContext(accessToken: string, projectId: string) {
  const res = await fetch(`/api/vertical/context/${encodeURIComponent(projectId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const json = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json && typeof (json as any).error === 'string'
        ? String((json as any).error)
        : `[RIDVAN-E876] Vertical context failed (${res.status})`;
    throw new Error(message);
  }

  return json as unknown;
}

export async function runBrainIngestion(accessToken: string, projectId: string) {
  const res = await fetch(`/api/brain/ingest/${encodeURIComponent(projectId)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const json = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json && typeof (json as any).error === 'string'
        ? String((json as any).error)
        : `[RIDVAN-E873] Ingestion request failed (${res.status})`;
    throw new Error(message);
  }

  return json as { ok: true; ingested: number };
}

export async function readBrainDebug(accessToken: string, projectId: string) {
  const res = await fetch(`/api/brain/debug/${encodeURIComponent(projectId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(`[RIDVAN-E874] Brain debug request failed (${res.status})`);
  }

  return (await res.json()) as unknown;
}
