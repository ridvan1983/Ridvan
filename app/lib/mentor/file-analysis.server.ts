import * as XLSX from 'xlsx';
import { supabaseAdmin } from '~/lib/supabase/server';

export type MentorAttachmentReference = {
  filename: string;
  mimeType: string;
  url?: string | null;
  extractedText?: string | null;
  byteSize?: number | null;
  storage?: {
    bucket?: string | null;
    path?: string | null;
  } | null;
};

export type MentorDocumentKind = 'financial' | 'marketing' | 'hr_legal' | 'investor' | 'legal' | 'general';

export type MentorAttachmentAnalysis = {
  filename: string;
  mimeType: string;
  extractedText: string | null;
  documentKind: MentorDocumentKind;
  expertRole: string;
  readError?: string | null;
  contentParts: Array<Record<string, unknown>>;
};

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? 'unknown error');
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }

  return btoa(binary);
}

function decodeUtf8(bytes: Uint8Array) {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function decodeLatin1(bytes: Uint8Array) {
  return new TextDecoder('latin1', { fatal: false }).decode(bytes);
}

function trimText(text: string | null | undefined, max = 50_000) {
  if (typeof text !== 'string') {
    return null;
  }

  const trimmed = text.replace(/\u0000/g, ' ').replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.slice(0, max);
}

export function extractTextFromAttachmentBytes(filename: string, mimeType: string, bytes: Uint8Array) {
  try {
    const lowerName = filename.toLowerCase();
    const lowerMime = mimeType.toLowerCase();

    if (
      lowerMime.startsWith('text/') ||
      lowerMime === 'application/json' ||
      lowerMime === 'application/xml' ||
      lowerMime === 'text/csv' ||
      lowerName.endsWith('.txt') ||
      lowerName.endsWith('.md') ||
      lowerName.endsWith('.csv') ||
      lowerName.endsWith('.json') ||
      lowerName.endsWith('.xml')
    ) {
      return trimText(decodeUtf8(bytes));
    }

    if (
      lowerMime.includes('spreadsheet') ||
      lowerMime.includes('excel') ||
      lowerName.endsWith('.xlsx') ||
      lowerName.endsWith('.xls') ||
      lowerName.endsWith('.xlsm')
    ) {
      const workbook = XLSX.read(bytes, { type: 'array' });
      const sheetTexts = workbook.SheetNames.slice(0, 5)
        .map((sheetName) => {
          const sheet = workbook.Sheets[sheetName];
          if (!sheet) {
            return null;
          }

          const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
          return csv.trim().length > 0 ? `Sheet: ${sheetName}\n${csv}` : null;
        })
        .filter((value): value is string => Boolean(value));

      return trimText(sheetTexts.join('\n\n'));
    }

    if (lowerMime === 'application/pdf' || lowerName.endsWith('.pdf')) {
      const raw = decodeLatin1(bytes);
      const textFromParens = Array.from(raw.matchAll(/\(([^()]|\\.){1,400}\)/g))
        .map((match) => match[0].slice(1, -1).replace(/\\([nrtbf()\\])/g, '$1'))
        .join(' ');

      if (textFromParens.trim().length > 0) {
        return trimText(textFromParens);
      }

      const readable = raw
        .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      return trimText(readable);
    }
  } catch (error) {
    console.error('[RIDVAN-E997] extractTextFromAttachmentBytes failed', {
      filename,
      mimeType,
      byteLength: bytes.byteLength,
      error: toErrorMessage(error),
    });
    return null;
  }

  return null;
}

function detectDocumentKind(filename: string, mimeType: string, text: string | null): { documentKind: MentorDocumentKind; expertRole: string } {
  const haystack = `${filename}\n${mimeType}\n${text ?? ''}`.toLowerCase();
  const contains = (terms: string[]) => terms.some((term) => haystack.includes(term));

  if (contains(['balansräkning', 'resultaträkning', 'kassaflöde', 'budget', 'bokslut', 'likviditet', 'p&l', 'profit and loss', 'cash flow', 'balance sheet'])) {
    return { documentKind: 'financial', expertRole: 'CFO — finansiell analys' };
  }

  if (contains(['marknadsplan', 'kampanj', 'content plan', 'content', 'brand', 'seo', 'annonsering', 'meta ads', 'google ads', 'marketing'])) {
    return { documentKind: 'marketing', expertRole: 'CMO — marknadsstrategi' };
  }

  if (contains(['anställningsavtal', 'policy', 'rekrytering', 'org', 'medarbetare', 'employee handbook', 'hr policy', 'onboarding'])) {
    return { documentKind: 'hr_legal', expertRole: 'HR + Legal' };
  }

  if (contains(['pitch deck', 'investerare', 'investor', 'cap table', 'term sheet', 'fundraising', 'seed round'])) {
    return { documentKind: 'investor', expertRole: 'CEO + CFO' };
  }

  if (contains(['avtal', 'kontrakt', 'villkor', 'terms', 'agreement', 'dpa', 'nda', 'gdpr', 'compliance'])) {
    return { documentKind: 'legal', expertRole: 'Legal' };
  }

  return { documentKind: 'general', expertRole: 'CEO — generell analys' };
}

async function loadAttachmentBytes(attachment: MentorAttachmentReference) {
  const bucket = attachment.storage?.bucket?.trim();
  const path = attachment.storage?.path?.trim();

  console.error('[RIDVAN-ATTACHMENT] loadAttachmentBytes:start', {
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    bucket: bucket ?? null,
    path: path ?? null,
    hasUrl: Boolean(attachment.url),
  });

  if (bucket && path) {
    const { data, error } = await supabaseAdmin.storage.from(bucket).download(path);
    if (error) {
      throw new Error(`[RIDVAN-E998] Failed to download attachment: ${error.message}`);
    }

    const bytes = new Uint8Array(await data.arrayBuffer());
    console.error('[RIDVAN-ATTACHMENT] loadAttachmentBytes:storage_success', {
      filename: attachment.filename,
      byteLength: bytes.byteLength,
    });
    return bytes;
  }

  const url = attachment.url?.trim();
  if (!url) {
    return null;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`[RIDVAN-E999] Failed to fetch attachment URL (${response.status})`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  console.error('[RIDVAN-ATTACHMENT] loadAttachmentBytes:url_success', {
    filename: attachment.filename,
    byteLength: bytes.byteLength,
  });
  return bytes;
}

export async function analyzeMentorAttachments(attachments: MentorAttachmentReference[]) {
  const results: MentorAttachmentAnalysis[] = [];

  for (const attachment of attachments) {
    console.error('[RIDVAN-ATTACHMENT] analyze:start', {
      filename: attachment.filename,
      mimeType: attachment.mimeType,
    });

    let bytes: Uint8Array | null = null;
    let extractedText: string | null = attachment.extractedText ?? null;

    try {
      bytes = await loadAttachmentBytes(attachment);
    } catch (error) {
      console.error('[RIDVAN-ATTACHMENT] analyze:load_failed', {
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        error: toErrorMessage(error),
      });
    }

    try {
      if (!extractedText && bytes) {
        extractedText = extractTextFromAttachmentBytes(attachment.filename, attachment.mimeType, bytes);
      }
      console.error('[RIDVAN-ATTACHMENT] analyze:text_extraction_done', {
        filename: attachment.filename,
        hasExtractedText: Boolean(extractedText),
      });
    } catch (error) {
      console.error('[RIDVAN-ATTACHMENT] analyze:text_extraction_failed', {
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        error: toErrorMessage(error),
      });
      extractedText = attachment.extractedText ?? null;
    }

    try {
      const detection = detectDocumentKind(attachment.filename, attachment.mimeType, extractedText);
      const readError = bytes || extractedText ? null : 'Attachment content could not be read. Analyze from filename and metadata only.';
      const isPdf = attachment.mimeType === 'application/pdf' || attachment.filename.toLowerCase().endsWith('.pdf');

      const contentParts: Array<Record<string, unknown>> = [];
      const overview = [
        `Filename: ${attachment.filename}`,
        `Mime type: ${attachment.mimeType}`,
        `Detected mode: ${detection.documentKind}`,
        readError ? `Read status: ${readError}` : 'Read status: Attachment content loaded successfully.',
      ].join('\n');
      contentParts.push({ type: 'text', text: overview });

      if (extractedText) {
        contentParts.push({ type: 'text', text: `Document text:\n${extractedText}` });
      } else if (bytes && isPdf) {
        contentParts.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: bytesToBase64(bytes),
          },
        });
        contentParts.push({
          type: 'text',
          text: 'PDF text extraction was empty or unavailable. Inspect the native PDF document directly before drawing conclusions.',
        });
      } else {
        contentParts.push({
          type: 'text',
          text: 'Document text was not available. Use filename, document type cues, and any available business context to analyze cautiously without inventing unseen content.',
        });
      }

      results.push({
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        extractedText,
        documentKind: detection.documentKind,
        expertRole: detection.expertRole,
        readError,
        contentParts,
      });

      console.error('[RIDVAN-ATTACHMENT] analyze:done', {
        filename: attachment.filename,
        documentKind: detection.documentKind,
        expertRole: detection.expertRole,
        degraded: Boolean(readError),
      });
    } catch (error) {
      console.error('[RIDVAN-ATTACHMENT] analyze:fallback_failed', {
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        error: toErrorMessage(error),
      });

      results.push({
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        extractedText: null,
        documentKind: 'general',
        expertRole: 'CEO — generell analys',
        readError: 'Attachment analysis failed completely. Use filename only and avoid claims about unread content.',
        contentParts: [
          {
            type: 'text',
            text: `Filename: ${attachment.filename}\nMime type: ${attachment.mimeType}\nDetected mode: general\nRead status: Attachment analysis failed. Use filename only and state that content could not be read safely.`,
          },
        ],
      });
    }
  }

  return results;
}

export function buildAttachmentPromptContext(analyses: MentorAttachmentAnalysis[]) {
  if (analyses.length === 0) {
    return null;
  }

  return analyses
    .map((analysis, index) => {
      const excerpt = analysis.extractedText ? analysis.extractedText.slice(0, 1_200) : 'No extracted text available.';
      return [
        `Attachment ${index + 1}: ${analysis.filename}`,
        `- mime_type: ${analysis.mimeType}`,
        `- document_type: ${analysis.documentKind}`,
        `- expert_role: ${analysis.expertRole}`,
        `- excerpt: ${excerpt}`,
      ].join('\n');
    })
    .join('\n\n');
}
