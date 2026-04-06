import { supabaseAdmin } from '~/lib/supabase/server';

const STOP = new Set([
  'och',
  'att',
  'det',
  'som',
  'för',
  'med',
  'är',
  'på',
  'av',
  'inte',
  'the',
  'and',
  'for',
  'you',
  'that',
  'this',
  'with',
  'have',
  'from',
  'what',
  'how',
  'can',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 4 && !STOP.has(t));
}

export type AdminMentorStats = {
  totalMentorMessages: number;
  distinctSessions: number;
  avgMessagesPerSession: number | null;
  topUsers: Array<{ user_id: string; message_count: number }>;
  topicHints: Array<{ term: string; count: number }>;
};

export async function computeAdminMentorStats(): Promise<AdminMentorStats> {
  const { count: totalCount, error: countError } = await supabaseAdmin
    .from('mentor_messages')
    .select('*', { count: 'exact', head: true });

  if (countError) {
    throw new Error(`[RIDVAN-E1920b] mentor count: ${countError.message}`);
  }

  const { data: rows, error } = await supabaseAdmin
    .from('mentor_messages')
    .select('user_id, session_id, role, content')
    .order('created_at', { ascending: false })
    .limit(8000)
    .returns<Array<{ user_id: string; session_id: string | null; role: string; content: string }>>();

  if (error) {
    throw new Error(`[RIDVAN-E1920] mentor admin stats: ${error.message}`);
  }

  const list = rows ?? [];
  const sessionKeys = new Set<string>();
  const sessionCounts = new Map<string, number>();
  const userCounts = new Map<string, number>();
  const wordCounts = new Map<string, number>();

  for (const row of list) {
    userCounts.set(row.user_id, (userCounts.get(row.user_id) ?? 0) + 1);
    if (row.session_id && row.session_id.trim().length > 0) {
      const sk = `${row.user_id}:${row.session_id}`;
      sessionKeys.add(sk);
      sessionCounts.set(sk, (sessionCounts.get(sk) ?? 0) + 1);
    }
    if (row.role === 'user' && typeof row.content === 'string') {
      for (const w of tokenize(row.content)) {
        wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
      }
    }
  }

  const distinctSessions = sessionKeys.size;
  let totalInSessions = 0;
  for (const c of sessionCounts.values()) {
    totalInSessions += c;
  }
  const avgMessagesPerSession = distinctSessions > 0 ? totalInSessions / distinctSessions : null;

  const topUsers = [...userCounts.entries()]
    .map(([user_id, message_count]) => ({ user_id, message_count }))
    .sort((a, b) => b.message_count - a.message_count)
    .slice(0, 12);

  const topicHints = [...wordCounts.entries()]
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return {
    totalMentorMessages: typeof totalCount === 'number' ? totalCount : list.length,
    distinctSessions,
    avgMessagesPerSession,
    topUsers,
    topicHints,
  };
}
