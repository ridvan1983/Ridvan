import { useMemo, useState } from 'react';
import { useAuth } from '~/lib/auth/AuthContext';
import { CREDIT_REFRESH_EVENT } from '~/components/credits/CreditDisplay';
import { generateMentorDocument } from '~/lib/mentor/api.client';

export type MentorDocumentFormat = 'pdf' | 'docx' | 'xlsx' | 'pptx';

export interface MentorDocumentCard {
  title: string;
  documentType: string;
  formats: MentorDocumentFormat[];
  content: string;
}

interface CreditsResponse {
  credits: number;
  dailyCredits?: number;
}

function documentCreditCost(documentType: string) {
  const normalized = documentType.toLowerCase();

  if (normalized.includes('affärsplan') || normalized.includes('affarsplan') || normalized.includes('business_plan')) return 10;
  if (normalized.includes('budget')) return 8;
  if (normalized.includes('cashflow') || normalized.includes('kassaflöde')) return 8;
  if (normalized.includes('pitch') || normalized.includes('invester')) return 15;
  if (normalized.includes('analys') || normalized.includes('analysis')) return 12;
  if (normalized.includes('marknadsplan') || normalized.includes('marketing')) return 10;
  if (normalized.includes('hr') || normalized.includes('policy')) return 6;
  if (normalized.includes('filanalys') || normalized.includes('file analysis')) return 5;

  return 5;
}

async function downloadFromUrl(url: string, filename: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`[RIDVAN-E1608] Download fetch failed (${response.status})`);
  }

  const blob = await response.blob();
  const objectUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = objectUrl;
  a.download = filename;

  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(objectUrl);
  document.body.removeChild(a);
}

type DocBlock =
  | { kind: 'h1'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'table'; headers: string[]; rows: string[][] };

const BRAND_PURPLE = '#7C3AED';
const BRAND_PINK = '#EC4899';

function stripMarkdown(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1')
    .trim();
}

function parseMarkdownToBlocks(markdown: string, fallbackTitle: string): { title: string; blocks: DocBlock[] } {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');

  let title = fallbackTitle.trim();
  const blocks: DocBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? '';
    const line = raw.trimEnd();

    if (line.trim().length === 0) {
      i++;
      continue;
    }

    const hMatch = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (hMatch) {
      const level = hMatch[1].length;
      const text = stripMarkdown(hMatch[2]);
      if (!title && level === 1) {
        title = text;
      }
      blocks.push({ kind: level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3', text });
      i++;
      continue;
    }

    if (/^[-*]\s+/.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test((lines[i] ?? '').trim())) {
        const item = (lines[i] ?? '').trim().replace(/^[-*]\s+/, '');
        items.push(stripMarkdown(item));
        i++;
      }
      if (items.length > 0) {
        blocks.push({ kind: 'ul', items });
      }
      continue;
    }

    if (line.trim().startsWith('|') && line.includes('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        tableLines.push((lines[i] ?? '').trim());
        i++;
      }

      const cleanCells = (row: string) =>
        row
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => stripMarkdown(c.trim()));

      const header = tableLines[0] ? cleanCells(tableLines[0]) : [];
      const body = tableLines
        .slice(1)
        .filter((r) => !/^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(r))
        .map((r) => cleanCells(r));

      if (header.length > 0 && body.length > 0) {
        blocks.push({ kind: 'table', headers: header, rows: body });
        continue;
      }
    }

    const paraLines: string[] = [];
    while (i < lines.length) {
      const candidate = (lines[i] ?? '').trimEnd();
      if (candidate.trim().length === 0) {
        break;
      }
      if (/^(#{1,3})\s+/.test(candidate.trim())) {
        break;
      }
      if (/^[-*]\s+/.test(candidate.trim())) {
        break;
      }
      if (candidate.trim().startsWith('|')) {
        break;
      }
      paraLines.push(candidate.trim());
      i++;
    }

    if (paraLines.length > 0) {
      blocks.push({ kind: 'p', text: stripMarkdown(paraLines.join(' ')) });
      continue;
    }

    i++;
  }

  if (!title) {
    title = fallbackTitle.trim() || 'Document';
  }

  return { title, blocks };
}

export function DocumentCard(props: { doc: MentorDocumentCard }) {
  const [isDownloading, setIsDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  const [creditSummary, setCreditSummary] = useState<number | null>(null);
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;
  const docCost = useMemo(() => documentCreditCost(props.doc.documentType), [props.doc.documentType]);

  const formats = useMemo(() => {
    const uniq = Array.from(new Set(props.doc.formats));
    return uniq;
  }, [props.doc.formats]);

  const readCredits = async () => {
    if (!accessToken) {
      return null;
    }

    const response = await fetch('/api/credits', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('[RIDVAN-E1609] Failed to load credits');
    }

    const payload = (await response.json()) as CreditsResponse;
    return (payload.credits ?? 0) + (payload.dailyCredits ?? 0);
  };

  const downloadFormat = async (format: MentorDocumentFormat) => {
    if (!accessToken) {
      setError('Du måste vara inloggad för att ladda ner dokument.');
      return;
    }

    setIsDownloading(format);
    setError('');
    try {
      const remainingCredits = await readCredits();
      setCreditSummary(remainingCredits);
      if (remainingCredits !== null) {
        const confirmed = window.confirm(`Detta dokument kostar ${docCost} krediter. Du har ${remainingCredits} krediter kvar.`);
        if (!confirmed) {
          return;
        }
      }

      // Mentor route already knows projectId in context; DocumentCard does not.
      // We rely on the server endpoint to validate user + project ownership.
      const projectId = (window as any).__RIDVAN_PROJECT_ID__ as string | undefined;
      if (!projectId) {
        throw new Error('[RIDVAN-E1605] Missing project context');
      }

      const res = await generateMentorDocument({
        accessToken,
        projectId,
        title: props.doc.title,
        documentType: props.doc.documentType,
        format,
        content: props.doc.content,
      });

      await downloadFromUrl(res.url, res.filename);
      window.dispatchEvent(new Event(CREDIT_REFRESH_EVENT));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setIsDownloading(null);
    }
  };

  return (
    <div className="mb-2 rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-4 py-3">
      <div className="text-sm font-semibold text-bolt-elements-textPrimary">{props.doc.title}</div>
      <div className="mt-1 text-[11px] opacity-80 text-bolt-elements-textSecondary">{props.doc.documentType}</div>
      <div className="mt-2 text-[11px] text-bolt-elements-textSecondary">
        {`Detta dokument kostar ${docCost} krediter.${creditSummary !== null ? ` Du har ${creditSummary} krediter kvar.` : ''}`}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {formats.map((format) => (
          <button
            key={format}
            type="button"
            className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm font-semibold text-bolt-elements-textPrimary disabled:opacity-60"
            disabled={Boolean(isDownloading)}
            onClick={() => void downloadFormat(format)}
          >
            {isDownloading === format ? 'Skapar…' : format.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
