import { supabaseAdmin } from '~/lib/supabase/server';

export const MENTOR_DEEP_MEMORY_KEY = 'mentor_deep_memory_v1';

export type MentorDecision = {
  id: string;
  decision: string;
  reason: string;
  date: string;
  outcome?: string;
};

export type MentorPivot = {
  id: string;
  from: string;
  to: string;
  reason: string;
  date: string;
};

export type MentorTrackedGoal = {
  id: string;
  goal: string;
  set_date: string;
  status: string;
  progress?: string;
};

export type MentorLearning = {
  id: string;
  learning: string;
  source: string;
  date: string;
};

export type MentorDeepMemoryV1 = {
  v: 1;
  decisions: MentorDecision[];
  pivots: MentorPivot[];
  goals: MentorTrackedGoal[];
  learnings: MentorLearning[];
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function newId() {
  return `mm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyDeepMemory(): MentorDeepMemoryV1 {
  return { v: 1, decisions: [], pivots: [], goals: [], learnings: [] };
}

export function parseDeepMemory(raw: unknown): MentorDeepMemoryV1 {
  const o = asObject(raw);
  if (o.v !== 1) {
    return emptyDeepMemory();
  }

  const decisions = Array.isArray(o.decisions) ? o.decisions : [];
  const pivots = Array.isArray(o.pivots) ? o.pivots : [];
  const goals = Array.isArray(o.goals) ? o.goals : [];
  const learnings = Array.isArray(o.learnings) ? o.learnings : [];

  return {
    v: 1,
    decisions: decisions.filter(Boolean) as MentorDecision[],
    pivots: pivots.filter(Boolean) as MentorPivot[],
    goals: goals.filter(Boolean) as MentorTrackedGoal[],
    learnings: learnings.filter(Boolean) as MentorLearning[],
  };
}

export function formatDeepMemoryForPrompt(mem: MentorDeepMemoryV1): string {
  const lines: string[] = [];

  if (mem.decisions.length > 0) {
    lines.push('Beslut:');
    for (const d of mem.decisions.slice(-12)) {
      lines.push(`- [${d.date}] ${d.decision} (anledning: ${d.reason})${d.outcome ? ` — utfall: ${d.outcome}` : ''}`);
    }
  }

  if (mem.pivots.length > 0) {
    lines.push('Pivoter:');
    for (const p of mem.pivots.slice(-8)) {
      lines.push(`- [${p.date}] Från "${p.from}" till "${p.to}" (anledning: ${p.reason})`);
    }
  }

  if (mem.goals.length > 0) {
    lines.push('Mål (spårade):');
    for (const g of mem.goals.slice(-8)) {
      lines.push(`- [${g.set_date}] ${g.goal} — status: ${g.status}${g.progress ? ` — framsteg: ${g.progress}` : ''}`);
    }
  }

  if (mem.learnings.length > 0) {
    lines.push('Lärdomar:');
    for (const l of mem.learnings.slice(-10)) {
      lines.push(`- [${l.date}] ${l.learning} (källa: ${l.source})`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : 'Ingen spårad besluts-historik ännu. När användaren uttrycker beslut, pivot eller mål — lägg in det via memory-event i events-arrayen.';
}

export type MemoryIngestPayload =
  | { kind: 'decision'; decision: string; reason: string; outcome?: string }
  | { kind: 'pivot'; from: string; to: string; reason: string }
  | { kind: 'goal'; goal: string; status: string; progress?: string }
  | { kind: 'learning'; learning: string; source: string };

export function appendToDeepMemory(prev: MentorDeepMemoryV1, occurredAt: string, patch: MemoryIngestPayload): MentorDeepMemoryV1 {
  const date = occurredAt.slice(0, 10);

  switch (patch.kind) {
    case 'decision':
      return {
        ...prev,
        decisions: [
          ...prev.decisions,
          {
            id: newId(),
            decision: patch.decision.trim(),
            reason: patch.reason.trim(),
            date,
            outcome: patch.outcome?.trim() || undefined,
          },
        ].slice(-40),
      };
    case 'pivot':
      return {
        ...prev,
        pivots: [
          ...prev.pivots,
          {
            id: newId(),
            from: patch.from.trim(),
            to: patch.to.trim(),
            reason: patch.reason.trim(),
            date,
          },
        ].slice(-30),
      };
    case 'goal':
      return {
        ...prev,
        goals: [
          ...prev.goals,
          {
            id: newId(),
            goal: patch.goal.trim(),
            set_date: date,
            status: patch.status.trim(),
            progress: patch.progress?.trim() || undefined,
          },
        ].slice(-25),
      };
    case 'learning':
      return {
        ...prev,
        learnings: [
          ...prev.learnings,
          {
            id: newId(),
            learning: patch.learning.trim(),
            source: patch.source.trim(),
            date,
          },
        ].slice(-40),
      };
    default:
      return prev;
  }
}

export async function loadDeepMemoryForWorkspace(workspaceId: string): Promise<MentorDeepMemoryV1> {
  const { data, error } = await supabaseAdmin
    .from('brain_project_state')
    .select('current_signals')
    .eq('workspace_id', workspaceId)
    .maybeSingle<{ current_signals: Record<string, unknown> | null }>();

  if (error) {
    throw new Error(`[RIDVAN-E1901] loadDeepMemory: ${error.message}`);
  }

  const signals = (data?.current_signals as Record<string, unknown>) ?? {};
  return parseDeepMemory(signals[MENTOR_DEEP_MEMORY_KEY]);
}

export async function appendDeepMemoryInWorkspace(workspaceId: string, occurredAt: string, patch: MemoryIngestPayload): Promise<void> {
  const prev = await loadDeepMemoryForWorkspace(workspaceId);
  const next = appendToDeepMemory(prev, occurredAt, patch);
  await saveDeepMemoryForWorkspace(workspaceId, next);
}

export async function saveDeepMemoryForWorkspace(workspaceId: string, memory: MentorDeepMemoryV1): Promise<void> {
  const { data, error: loadError } = await supabaseAdmin
    .from('brain_project_state')
    .select('current_signals')
    .eq('workspace_id', workspaceId)
    .maybeSingle<{ current_signals: Record<string, unknown> | null }>();

  if (loadError) {
    throw new Error(`[RIDVAN-E1902] saveDeepMemory load: ${loadError.message}`);
  }

  const current = ((data?.current_signals as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const next = { ...current, [MENTOR_DEEP_MEMORY_KEY]: memory };

  const { error } = await supabaseAdmin
    .from('brain_project_state')
    .update({ current_signals: next, current_signals_updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId);

  if (error) {
    throw new Error(`[RIDVAN-E1903] saveDeepMemory: ${error.message}`);
  }
}

export function removeDeepMemoryItemById(mem: MentorDeepMemoryV1, id: string): MentorDeepMemoryV1 {
  return {
    ...mem,
    decisions: mem.decisions.filter((d) => d.id !== id),
    pivots: mem.pivots.filter((p) => p.id !== id),
    goals: mem.goals.filter((g) => g.id !== id),
    learnings: mem.learnings.filter((l) => l.id !== id),
  };
}

export type MentorMemoryCategory = 'decisions' | 'pivots' | 'goals' | 'learnings';

export function updateDeepMemoryEntry(
  mem: MentorDeepMemoryV1,
  category: MentorMemoryCategory,
  id: string,
  updates: Record<string, string | undefined>,
): MentorDeepMemoryV1 {
  if (category === 'decisions') {
    return {
      ...mem,
      decisions: mem.decisions.map((d) => (d.id === id ? { ...d, ...updates } as MentorDecision : d)),
    };
  }
  if (category === 'pivots') {
    return {
      ...mem,
      pivots: mem.pivots.map((p) => (p.id === id ? { ...p, ...updates } as MentorPivot : p)),
    };
  }
  if (category === 'goals') {
    return {
      ...mem,
      goals: mem.goals.map((g) => (g.id === id ? { ...g, ...updates } as MentorTrackedGoal : g)),
    };
  }
  return {
    ...mem,
    learnings: mem.learnings.map((l) => (l.id === id ? { ...l, ...updates } as MentorLearning : l)),
  };
}

