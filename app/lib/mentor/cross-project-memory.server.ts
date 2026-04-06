import { readBrainContext } from '~/lib/brain/read.server';
import { formatDeepMemoryForPrompt, loadDeepMemoryForWorkspace, type MentorDeepMemoryV1 } from '~/lib/mentor/memory.server';
import { supabaseAdmin } from '~/lib/supabase/server';

async function listOtherProjectIds(userId: string, excludeProjectId: string, limit: number): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('user_id', userId)
    .neq('id', excludeProjectId)
    .order('updated_at', { ascending: false })
    .limit(limit)
    .returns<Array<{ id: string }>>();

  if (error) {
    throw new Error(`[RIDVAN-E1910] list projects: ${error.message}`);
  }

  return (data ?? []).map((r) => r.id).filter(Boolean);
}

async function getWorkspaceId(projectId: string, userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('brain_workspaces')
    .select('id')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle<{ id: string }>();

  if (error) {
    return null;
  }

  return data?.id ?? null;
}

/**
 * Compact summary of other projects for cross-learning in Mentor system prompt.
 */
export async function buildCrossProjectMemorySummary(args: {
  userId: string;
  currentProjectId: string;
  maxOtherProjects?: number;
}): Promise<string> {
  const max = Math.min(Math.max(args.maxOtherProjects ?? 4, 1), 8);
  const others = await listOtherProjectIds(args.userId, args.currentProjectId, max);

  if (others.length === 0) {
    return '';
  }

  const blocks: string[] = [];

  for (const pid of others) {
    try {
      const brain = await readBrainContext({ projectId: pid, userId: args.userId });
      if (!brain) {
        continue;
      }

      const ws = await getWorkspaceId(pid, args.userId);
      let deep: MentorDeepMemoryV1 | null = null;
      if (ws) {
        try {
          deep = await loadDeepMemoryForWorkspace(ws);
        } catch {
          deep = null;
        }
      }

      const title = brain.state.primaryGoalSummary || brain.industryProfile?.normalizedIndustry || pid.slice(0, 8);
      const stage = brain.state.currentStage || 'okänd fas';
      const model = brain.state.currentBusinessModel || 'okänd modell';
      const decisionsN = deep?.decisions.length ?? 0;
      const goalsN = deep?.goals.length ?? 0;

      let extra = '';
      if (deep && (deep.decisions.length > 0 || deep.learnings.length > 0)) {
        const snippet = formatDeepMemoryForPrompt({
          ...deep,
          decisions: deep.decisions.slice(-2),
          pivots: deep.pivots.slice(-1),
          goals: deep.goals.slice(-2),
          learnings: deep.learnings.slice(-2),
        });
        if (snippet.length > 80) {
          extra = ` Kort minne från det projektet: ${snippet.replace(/\n/g, ' ').slice(0, 320)}`;
        }
      }

      blocks.push(
        `- Projekt ${pid.slice(0, 8)}…: ${String(title).slice(0, 60)} | fas ${stage} | modell ${model} | ${decisionsN} beslut spårade, ${goalsN} mål.${extra}`,
      );
    } catch {
      // skip project on error
    }
  }

  if (blocks.length === 0) {
    return '';
  }

  return [
    'ANDRA PROJEKT SAMMA ANVÄNDARE (använd försiktigt för mönster, aldrig för att blanda ihop bolag):',
    ...blocks,
    'Om du ser upprepade mönster (t.ex. tid till första kund, återkommande pivot), nämn det som hypotes — inte som fakta om detta projekt.',
  ].join('\n');
}
