import { tool } from 'ai';
import { z } from 'zod';

export type MentorSearchStatus = {
  query: string;
  reason: string;
};

/**
 * Serper.dev Google search. Set SEARCH_API_KEY in env (same key as Serper dashboard).
 */
export async function runSerperWebSearch(query: string, apiKey: string): Promise<string> {
  const q = query.trim();
  if (!q) {
    return 'Ingen sökfråga angiven.';
  }

  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
    },
    body: JSON.stringify({ q, num: 8 }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return `Sökning misslyckades (${res.status}). ${t.slice(0, 200)}`;
  }

  const json = (await res.json()) as {
    organic?: Array<{ title?: string; snippet?: string; link?: string }>;
    answerBox?: { answer?: string; title?: string };
    knowledgeGraph?: { title?: string; description?: string };
  };

  const lines: string[] = [];
  if (json.answerBox?.answer) {
    lines.push(`Snabb svar: ${json.answerBox.answer}`);
  }
  if (json.knowledgeGraph?.title) {
    lines.push(`Kunskapsgraf: ${json.knowledgeGraph.title}${json.knowledgeGraph.description ? ` — ${json.knowledgeGraph.description}` : ''}`);
  }
  const organic = Array.isArray(json.organic) ? json.organic : [];
  for (const row of organic.slice(0, 8)) {
    const title = row.title?.trim() || 'Resultat';
    const snippet = row.snippet?.trim() || '';
    const link = row.link?.trim() || '';
    lines.push(`- ${title}${snippet ? `: ${snippet}` : ''}${link ? ` (${link})` : ''}`);
  }

  return lines.length > 0 ? lines.join('\n') : 'Inga tydliga träffar — formulera om frågan eller försök med engelska nyckelord.';
}

export function createMentorSearchWebTool(args: {
  searchApiKey: string;
  onSearchStatus?: (status: MentorSearchStatus) => void | Promise<void>;
}) {
  return {
    search_web: tool({
      description:
        'Sök efter aktuell information om marknaden, konkurrenter, trender, funding eller regler. Använd när användaren frågar om något som kan ha ändrats nyligen (t.ex. "vad gör Bokadirekt nu?", marknadsstorlek, investeringar, branschtrender). Sök sparsamt — max en–två gånger per svar.',
      parameters: z.object({
        query: z.string().describe('Konkret sökfråga, gärna på engelska för bättre träffar'),
        reason: z.string().describe('Kort motivering till användaren om varför du söker (internt underlag)'),
      }),
      execute: async ({ query, reason }) => {
        await args.onSearchStatus?.({ query, reason });
        return await runSerperWebSearch(query, args.searchApiKey);
      },
    }),
  };
}
