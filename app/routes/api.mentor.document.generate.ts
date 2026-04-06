import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { FEATURE_FLAGS } from '~/config/feature-flags';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { ensureBrainWorkspace, insertBrainEvent } from '~/lib/brain/server';
import { ingestBrainEventsById } from '~/lib/brain/ingest.server';
import { checkCredits } from '~/lib/credits/check';
import { deductCredit } from '~/lib/credits/deduct';
import { supabaseAdmin } from '~/lib/supabase/server';

import {
  AlignmentType,
  BorderStyle,
  Document as DocxDocument,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import ExcelJS from 'exceljs';
import { Marked } from 'marked';
import PptxGenJS from 'pptxgenjs';
import puppeteer from 'puppeteer';

const BUCKET = 'mentor-documents';

type MentorDocumentFormat = 'pdf' | 'docx' | 'xlsx' | 'pptx';
type RenderedDocumentType = 'investor_pitch' | 'business_plan' | 'spreadsheet' | 'presentation';

type DocBlock =
  | { kind: 'h1'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'table'; headers: string[]; rows: string[][] };

const BRAND_PURPLE = '#7C3AED';
const BRAND_PINK = '#EC4899';
const BRAND_TEXT = '#0A0A0A';
const BRAND_MUTED = '#F8F7F4';
const BRAND_BORDER = '#E7E5E4';
const BRAND_GREEN = '#16A34A';
const BRAND_RED = '#DC2626';

function disabledResponse() {
  return Response.json({ error: '[RIDVAN-E1601] Mentor document generation is disabled for MVP' }, { status: 404 });
}

function noCreditsResponse() {
  return Response.json(
    {
      error: 'RIDVAN_NO_CREDITS',
      message: 'Du har inga krediter kvar. Uppgradera till PRO för obegränsad access.',
    },
    { status: 403 },
  );
}

function documentCreditCost(documentType: string) {
  const value = documentType.trim().toLowerCase();

  if (value === 'business_plan' || value === 'affärsplan' || value === 'affarsplan' || value === 'annual_roadmap') {
    return 10;
  }
  if (value === 'budget' || value === 'quarterly_budget') return 8;
  if (value === 'cashflow' || value === 'kassaflöde' || value === 'kassaflode') return 8;
  if (value === 'investor_pitch' || value === 'pitch' || value === 'pitch_deck') return 15;
  if (value === 'financial_analysis' || value === 'finansiell_analys' || value === 'finansiell analys') return 12;
  if (value === 'marketing_plan' || value === 'marknadsplan') return 10;
  if (value === 'hr_policy' || value === 'hr-policy' || value === 'hr policy') return 6;
  if (value === 'file_analysis' || value === 'filanalys') return 5;

  return 0;
}

function stripMarkdown(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1')
    .trim();
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inferDocumentType(documentType: string, title: string): RenderedDocumentType {
  const haystack = `${documentType} ${title}`.toLowerCase();

  if (haystack.includes('pitch') || haystack.includes('invester')) {
    return 'investor_pitch';
  }

  if (
    haystack.includes('affärsplan') ||
    haystack.includes('affarsplan') ||
    haystack.includes('business plan') ||
    haystack.includes('årsplan') ||
    haystack.includes('arsplan') ||
    haystack.includes('roadmap') ||
    haystack.includes('annual_roadmap') ||
    haystack.includes('marknadsplan') ||
    haystack.includes('marketing plan') ||
    haystack.includes('hr-policy') ||
    haystack.includes('hr policy') ||
    haystack.includes('policy')
  ) {
    return 'business_plan';
  }

  if (haystack.includes('budget') || haystack.includes('cashflow') || haystack.includes('kassaflöde') || haystack.includes('excel')) {
    return 'spreadsheet';
  }

  return 'presentation';
}

function formatDateLabel() {
  return new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
}

function normalizeCompanyName(title: string) {
  const clean = stripMarkdown(title).trim();
  return clean.length > 0 ? clean : 'Ridvan Company';
}

function groupBlocksIntoSections(blocks: DocBlock[], fallbackTitle: string) {
  const sections: Array<{ id: string; title: string; blocks: DocBlock[] }> = [];
  let current = { id: 'section-1', title: fallbackTitle, blocks: [] as DocBlock[] };
  let index = 1;

  for (const block of blocks) {
    if (block.kind === 'h1' || block.kind === 'h2') {
      if (current.blocks.length > 0) {
        sections.push(current);
      }

      current = {
        id: `section-${index + 1}`,
        title: block.text,
        blocks: [],
      };
      index += 1;
      continue;
    }

    current.blocks.push(block);
  }

  if (current.blocks.length > 0 || sections.length === 0) {
    sections.push(current);
  }

  return sections.map((section, sectionIndex) => ({
    ...section,
    id: `section-${sectionIndex + 1}`,
    title: section.title || `${fallbackTitle} ${sectionIndex + 1}`,
  }));
}

function extractStats(blocks: DocBlock[]) {
  const stats: Array<{ label: string; value: string }> = [];
  const rx = /([A-Za-zÅÄÖåäö\s\/]{2,40})[:\-]\s*([\d\s.,]+%?|[\d\s.,]+\s*(?:kr|mkr|mnkr|sek|kpi|arr|mrr))/gi;

  for (const block of blocks) {
    if (block.kind !== 'p') {
      continue;
    }

    for (const match of block.text.matchAll(rx)) {
      const label = stripMarkdown(match[1] ?? '').trim();
      const value = stripMarkdown(match[2] ?? '').trim();

      if (label && value) {
        stats.push({ label, value });
      }

      if (stats.length >= 6) {
        return stats;
      }
    }
  }

  return stats;
}

function tryParseNumber(input: string) {
  const normalized = input.replace(/\s+/g, '').replace(/kr|sek|mkr|mnkr|%/gi, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function formatCurrencyNumber(value: number) {
  return new Intl.NumberFormat('sv-SE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function inferSpreadsheetPeriod(title: string, blocks: DocBlock[]) {
  const haystack = `${title} ${blocks
    .filter((block): block is Extract<DocBlock, { kind: 'p' }> => block.kind === 'p')
    .slice(0, 2)
    .map((block) => block.text)
    .join(' ')}`.toLowerCase();

  if (haystack.includes('kvartal') || haystack.includes('q1') || haystack.includes('q2') || haystack.includes('q3') || haystack.includes('q4')) {
    return 'Kvartalsöversikt';
  }

  if (haystack.includes('vecka') || haystack.includes('weekly')) {
    return 'Veckovis översikt';
  }

  if (haystack.includes('månad') || haystack.includes('monthly')) {
    return 'Månadsöversikt';
  }

  return formatDateLabel();
}

function wrapStatNumbers(text: string) {
  return text.replace(/(^|[\s(])((?:\d[\d\s.,]*)(?:\s?(?:kr|sek|mkr|mnkr|%|x|kpi|arr|mrr))?)(?=$|[\s),.:;])/gi, (_match, prefix: string, value: string) => {
    const clean = String(value ?? '').trim();
    const parsed = tryParseNumber(clean);
    if (parsed === null && !/%|kr|sek|mkr|mnkr|arr|mrr|kpi/i.test(clean)) {
      return `${prefix}${clean}`;
    }

    return `${prefix}<span class="stat-number">${clean}</span>`;
  });
}

function renderMarkdownHtml(markdown: string) {
  const marked = new Marked({ gfm: true, breaks: false });
  const rawHtml = marked.parse(markdown) as string;

  return wrapStatNumbers(rawHtml)
    .replace(/<h1>([\s\S]*?)<\/h1>/gi, '<h2 class="section-title">$1</h2><div class="gradient-line"></div>')
    .replace(/<h2>([\s\S]*?)<\/h2>/gi, '<h2 class="section-title">$1</h2><div class="gradient-line"></div>')
    .replace(/<h3>([\s\S]*?)<\/h3>/gi, '<h3 class="subheading">$1</h3>')
    .replace(/<p>/gi, '<p class="body-copy">')
    .replace(/<ul>/gi, '<ul class="elegant-list">')
    .replace(/<ol>/gi, '<ol class="elegant-list ordered-list">')
    .replace(/<li>/gi, '<li><span class="check">—</span><span>')
    .replace(/<\/li>/gi, '</span></li>')
    .replace(/<blockquote>/gi, '<blockquote class="pull-quote">')
    .replace(/<table>/gi, '<table class="doc-table">')
    .replace(/<ol class="elegant-list ordered-list">([\s\S]*?)<\/ol>/gi, (_match, body: string) => {
      let index = 0;
      const normalized = body.replace(/<li><span class="check">—<\/span><span>/gi, () => {
        index += 1;
        return `<li><span class="ordered-index">${index}.</span><span>`;
      });
      return `<ol class="elegant-list ordered-list">${normalized}</ol>`;
    });
}

function renderBlocksHtml(blocks: DocBlock[]) {
  return blocks
    .map((block) => {
      if (block.kind === 'h3') {
        return `<h3 class="subheading">${escapeHtml(block.text)}</h3>`;
      }

      if (block.kind === 'p') {
        return `<p class="body-copy">${escapeHtml(block.text)}</p>`;
      }

      if (block.kind === 'ul') {
        const items = block.items
          .map((item) => `<li><span class="check">—</span><span>${escapeHtml(item)}</span></li>`)
          .join('');
        return `<ul class="elegant-list">${items}</ul>`;
      }

      if (block.kind === 'table') {
        const head = block.headers.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('');
        const rows = block.rows
          .map(
            (row) =>
              `<tr>${row
                .map((cell) => `<td>${escapeHtml(cell)}</td>`)
                .join('')}</tr>`,
          )
          .join('');
        return `<table class="doc-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
      }

      return '';
    })
    .join('');
}

function blocksToMarkdown(blocks: DocBlock[]) {
  return blocks
    .map((block) => {
      if (block.kind === 'h1') {
        return `## ${block.text}`;
      }

      if (block.kind === 'h2') {
        return `## ${block.text}`;
      }

      if (block.kind === 'h3') {
        return `### ${block.text}`;
      }

      if (block.kind === 'p') {
        return block.text;
      }

      if (block.kind === 'ul') {
        return block.items.map((item) => `- ${item}`).join('\n');
      }

      if (block.kind === 'table') {
        const header = `| ${block.headers.join(' | ')} |`;
        const separator = `| ${block.headers.map(() => '---').join(' | ')} |`;
        const rows = block.rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
        return [header, separator, rows].filter(Boolean).join('\n');
      }

      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function isSparseSection(section: { title: string; blocks: DocBlock[] }) {
  const textLength = section.blocks
    .map((block) => {
      if (block.kind === 'p' || block.kind === 'h3') return block.text.length;
      if (block.kind === 'ul') return block.items.join(' ').length;
      if (block.kind === 'table') return block.headers.join(' ').length + block.rows.flat().join(' ').length;
      return 0;
    })
    .reduce((sum, value) => sum + value, 0);

  return textLength < 220 && section.blocks.length <= 2;
}

function compactSections(sections: Array<{ id: string; title: string; blocks: DocBlock[] }>) {
  const compacted: Array<{ id: string; title: string; blocks: DocBlock[] }> = [];

  for (const section of sections) {
    const previous = compacted[compacted.length - 1];
    if (previous && isSparseSection(section)) {
      previous.blocks.push({ kind: 'h3', text: section.title }, ...section.blocks);
      continue;
    }

    compacted.push({ ...section, blocks: [...section.blocks] });
  }

  return compacted;
}

function renderClosingPage(args: { companyName: string; title: string; blocks: DocBlock[]; pageNumber: number }) {
  const stats = extractStats(args.blocks).slice(0, 3);
  const summary = stats.map((stat) => `${stat.label}: ${stat.value}`).join(' · ');
  return `<section class="page content-page closing-page">
    <div class="top-gradient-bar"></div>
    <div class="slide-meta"><span class="slide-number">${String(args.pageNumber).padStart(2, '0')}</span></div>
    <div class="page-inner closing-inner">
      <div class="closing-eyebrow">Redo att ta nästa steg</div>
      <h1 class="closing-company">${escapeHtml(args.companyName)}</h1>
      <p class="closing-statement">${escapeHtml(args.title)} sammanfattar ett bolag med tydlig marknadspotential, konkret finansieringsplan och ett starkt case för genomförande nu.</p>
      <div class="closing-grid">
        <div class="closing-card">
          <div class="closing-card-label">Funding ask</div>
          <div class="closing-card-value">${escapeHtml(stats[0]?.value ?? 'Kontakta teamet')}</div>
          <div class="closing-card-copy">${escapeHtml(summary || 'Strategiskt kapital för att accelerera tillväxt, produkt och distribution.')}</div>
        </div>
        <div class="closing-card">
          <div class="closing-card-label">Kontakt</div>
          <div class="closing-contact-line">${escapeHtml(args.companyName)}</div>
          <div class="closing-contact-line">founders@${safeFilename(args.companyName).replace(/-/g, '') || 'ridvan'}.se</div>
          <div class="closing-contact-line">+46 70 123 45 67</div>
        </div>
      </div>
      <div class="closing-quote">Tack för er tid — vi bygger något med tydlig uppsida, disciplinerat genomförande och en marknad som är redo nu.</div>
    </div>
    <footer class="page-footer"><span>${escapeHtml(args.companyName)}</span><span>${args.pageNumber}</span><span>Ridvan</span></footer>
  </section>`;
}

function renderMetricCards(stats: Array<{ label: string; value: string }>) {
  if (stats.length === 0) {
    return '';
  }

  return `<div class="metric-grid">${stats
    .map(
      (stat) => `<div class="metric-card"><div class="metric-value">${escapeHtml(stat.value)}</div><div class="metric-label">${escapeHtml(stat.label)}</div></div>`,
    )
    .join('')}</div>`;
}

function renderChartSvg(stats: Array<{ label: string; value: string }>) {
  const values = stats.map((stat) => tryParseNumber(stat.value)).filter((value): value is number => value !== null && value > 0).slice(0, 4);

  if (values.length === 0) {
    return '';
  }

  const max = Math.max(...values, 1);
  const bars = values
    .map((value, index) => {
      const height = Math.max(20, Math.round((value / max) * 140));
      const x = 30 + index * 120;
      const y = 170 - height;
      const label = escapeHtml(stats[index]?.label ?? `Metric ${index + 1}`);

      return `<g>
        <rect x="${x}" y="${y}" width="64" height="${height}" rx="18" fill="url(#ridvanGradient)" opacity="0.95"></rect>
        <text x="${x + 32}" y="195" text-anchor="middle" font-size="12" fill="#57534E">${label}</text>
      </g>`;
    })
    .join('');

  return `<div class="chart-card">
    <svg viewBox="0 0 520 220" width="100%" height="220" role="img" aria-label="Key metrics chart">
      <defs>
        <linearGradient id="ridvanGradient" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="${BRAND_PURPLE}"></stop>
          <stop offset="100%" stop-color="${BRAND_PINK}"></stop>
        </linearGradient>
      </defs>
      <line x1="20" y1="170" x2="500" y2="170" stroke="#D6D3D1" stroke-width="1"></line>
      ${bars}
    </svg>
  </div>`;
}

function renderPdfHtml(args: { title: string; companyName: string; blocks: DocBlock[]; markdown: string; documentType: string }) {
  const date = formatDateLabel();
  const docType = inferDocumentType(args.documentType, args.title);
  const sections = compactSections(groupBlocksIntoSections(args.blocks, args.title));
  const stats = extractStats(args.blocks);
  const richMarkdownHtml = renderMarkdownHtml(args.markdown);
  const toc = sections
    .map(
      (section, index) => `<a href="#${section.id}" class="toc-item"><span class="toc-name">${index + 1}. ${escapeHtml(section.title)}</span><span class="toc-dots"></span></a>`,
    )
    .join('');
  const bodyPages = sections
    .map((section, index) => {
      const sectionStats = extractStats(section.blocks);
      const quoteBlock = section.blocks.find((block): block is Extract<DocBlock, { kind: 'p' }> => block.kind === 'p' && block.text.length > 90);
      const sectionBody = renderMarkdownHtml(blocksToMarkdown(section.blocks));

      return `<section class="page content-page" id="${section.id}">
        <div class="top-gradient-bar"></div>
        <div class="slide-meta"><span class="slide-number">${String(index + 2).padStart(2, '0')}</span></div>
        <div class="page-inner">
          ${docType === 'business_plan' ? `<header class="chapter-header"><h1 class="chapter-title">${escapeHtml(section.title)}</h1></header>` : `<header class="page-header"><h1 class="section-title">${escapeHtml(section.title)}</h1><div class="gradient-line"></div></header>`}
          ${sectionStats.length > 0 ? renderMetricCards(sectionStats.slice(0, 4)) : ''}
          ${docType === 'business_plan' && index === 0 && stats.length > 0 ? renderChartSvg(stats) : ''}
          ${sectionBody}
          ${quoteBlock ? `<blockquote class="pull-quote">${escapeHtml(quoteBlock.text)}</blockquote>` : ''}
        </div>
        <footer class="page-footer"><span>${escapeHtml(args.companyName)}</span><span>${index + 2}</span><span>Ridvan</span></footer>
      </section>`;
    })
    .join('');
  const closingPage = docType === 'investor_pitch' ? renderClosingPage({ companyName: args.companyName, title: args.title, blocks: args.blocks, pageNumber: sections.length + 2 }) : '';

  const subtitle = docType === 'investor_pitch' ? 'Investerarpitch' : docType === 'business_plan' ? 'Affärsplan' : args.documentType;
  const coverGradient =
    docType === 'business_plan'
      ? 'linear-gradient(135deg, #4C1D95 0%, #7C3AED 100%)'
      : 'linear-gradient(135deg, #7C3AED 0%, #9B59B6 50%, #EC4899 100%)';

  return `<!DOCTYPE html>
  <html lang="sv">
    <head>
      <meta charset="utf-8" />
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800&display=swap" rel="stylesheet">
      <style>
        @page { size: A4; margin: 0; }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif; color: ${BRAND_TEXT}; background: #ffffff; }
        body { counter-reset: page; }
        .page { width: 210mm; min-height: 297mm; page-break-after: always; position: relative; overflow: hidden; background: #ffffff; }
        .cover { background: ${coverGradient}; color: #ffffff; display: flex; flex-direction: column; justify-content: space-between; padding: 48px 64px; }
        .cover-brand { font-size: 14px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; opacity: 0.84; }
        .cover-main { margin-top: 56px; min-height: 60%; display: flex; flex-direction: column; justify-content: center; align-items: ${docType === 'investor_pitch' ? 'center' : 'flex-start'}; text-align: ${docType === 'investor_pitch' ? 'center' : 'left'}; }
        .cover-subtitle { font-size: ${docType === 'investor_pitch' ? '16px' : '18px'}; font-weight: 500; letter-spacing: ${docType === 'investor_pitch' ? '4px' : '1px'}; text-transform: uppercase; opacity: 0.7; }
        .cover-line { width: ${docType === 'investor_pitch' ? '40%' : '84px'}; height: 1px; background: rgba(255, 255, 255, 0.5); margin: 18px 0 24px; }
        .cover-company { font-size: 52px; line-height: 1.02; font-weight: 700; letter-spacing: -1px; max-width: ${docType === 'investor_pitch' ? '78%' : '82%'}; }
        .cover-kicker { margin-top: 14px; font-size: 14px; opacity: 0.75; }
        .cover-bottom { display: flex; justify-content: space-between; align-items: flex-end; }
        .cover-date { font-size: 14px; opacity: 0.5; }
        .toc-page, .content-page { padding: 48px 64px; }
        .toc-title { font-size: 32px; color: ${BRAND_PURPLE}; font-weight: 700; margin: 0 0 28px; }
        .toc-item { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; color: ${BRAND_PURPLE}; text-decoration: none; font-size: 16px; }
        .toc-name { white-space: nowrap; }
        .toc-dots { flex: 1; border-bottom: 1px dotted #D1D5DB; transform: translateY(-1px); }
        .top-gradient-bar { position: absolute; left: 0; top: 0; width: 100%; height: ${docType === 'investor_pitch' ? '4px' : '0'}; background: linear-gradient(90deg, ${BRAND_PURPLE}, #9B59B6, ${BRAND_PINK}); }
        .slide-meta { display: flex; justify-content: flex-end; }
        .slide-number { color: #9CA3AF; font-weight: 500; font-size: 12px; letter-spacing: 0.08em; }
        .page-inner { padding-bottom: 48px; padding-top: 8px; }
        .page-header { margin-top: 36px; margin-bottom: 32px; }
        .section-title { margin: 0; font-size: 28px; line-height: 1.1; font-weight: 700; color: #1A1A1A; }
        .gradient-line { width: ${docType === 'investor_pitch' ? '60px' : '80px'}; height: 2px; background: linear-gradient(90deg, ${BRAND_PURPLE}, ${BRAND_PINK}); border-radius: 999px; margin-top: 14px; }
        .chapter-header { margin: 24px 0 28px; background: #EDE9FE; padding: 24px; }
        .chapter-title { margin: 0; font-size: 24px; line-height: 1.2; font-weight: 700; color: ${BRAND_PURPLE}; }
        .body-copy { font-size: ${docType === 'business_plan' ? '15px' : '16px'}; line-height: ${docType === 'business_plan' ? '1.9' : '2'}; color: #374151; margin: 0 0 16px; }
        .subheading { font-size: 18px; line-height: 1.3; color: #1A1A1A; margin: 24px 0 12px; }
        .chapter-subheading { font-size: 18px; line-height: 1.3; color: #1A1A1A; margin: 24px 0 14px; padding-left: 14px; border-left: 2px solid ${BRAND_PURPLE}; font-weight: 700; }
        .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin: 18px 0 32px; }
        .metric-card { border: 1px solid rgba(229, 231, 235, 1); border-radius: 18px; padding: 20px 16px; background: #ffffff; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04); text-align: center; }
        .metric-value { font-size: 48px; font-weight: 700; line-height: 1; background: linear-gradient(135deg, ${BRAND_PURPLE}, ${BRAND_PINK}); -webkit-background-clip: text; background-clip: text; color: transparent; }
        .metric-label { margin-top: 10px; font-size: 12px; line-height: 1.4; color: #9CA3AF; text-transform: uppercase; letter-spacing: 0.08em; }
        .elegant-list { list-style: none; padding: 0; margin: 0 0 18px; display: grid; gap: 12px; }
        .elegant-list li { display: flex; align-items: flex-start; gap: 12px; font-size: 16px; line-height: 2; color: #374151; }
        .elegant-list.ordered-list { gap: 14px; counter-reset: ordered-items; }
        .elegant-list.ordered-list li { display: grid; grid-template-columns: 24px 1fr; align-items: start; }
        .ordered-index { color: ${BRAND_PURPLE}; font-weight: 700; line-height: 2; }
        .check { color: ${BRAND_PURPLE}; font-weight: 800; min-width: 16px; }
        .doc-table { width: 100%; border-collapse: collapse; margin: 18px 0 24px; font-size: 14px; overflow: hidden; border-radius: 18px; border: 1px solid #E5E7EB; }
        .doc-table thead th { padding: 14px 16px; background: linear-gradient(135deg, ${BRAND_PURPLE}, ${BRAND_PINK}); color: #ffffff; text-align: left; font-weight: 700; }
        .doc-table tbody td { padding: 12px 16px; border: 1px solid #E5E7EB; color: #374151; }
        .doc-table tbody tr:nth-child(odd) td { background: #F9FAFB; }
        .pull-quote { margin: 28px 0 0; padding: 16px 20px; border-left: 4px solid ${BRAND_PURPLE}; background: #F5F3FF; color: ${BRAND_PURPLE}; font-size: 18px; line-height: 1.8; font-style: italic; }
        .pull-quote p { margin: 0; color: inherit; }
        .stat-number { display: inline-block; font-weight: 700; color: ${BRAND_PURPLE}; }
        .markdown-preview { display: none; }
        .chart-card { border: 1px solid ${BRAND_BORDER}; border-radius: 22px; padding: 18px; margin: 4px 0 26px; background: linear-gradient(180deg, #ffffff, #fcfcfd); }
        .page-footer { position: absolute; left: 64px; right: 64px; bottom: 24px; display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #9CA3AF; }
        .closing-page { background: linear-gradient(180deg, #ffffff 0%, #faf7ff 100%); }
        .closing-inner { display: flex; flex-direction: column; justify-content: center; min-height: 82%; }
        .closing-eyebrow { font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; color: ${BRAND_PURPLE}; margin-bottom: 16px; }
        .closing-company { font-size: 52px; line-height: 1.02; margin: 0 0 18px; color: #1A1A1A; }
        .closing-statement { font-size: 18px; line-height: 1.8; color: #374151; max-width: 86%; margin: 0 0 28px; }
        .closing-grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 18px; margin-bottom: 28px; }
        .closing-card { border: 1px solid #E5E7EB; border-radius: 22px; background: #ffffff; padding: 24px; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.05); }
        .closing-card-label { font-size: 12px; color: #9CA3AF; text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 10px; }
        .closing-card-value { font-size: 28px; line-height: 1.1; font-weight: 700; color: ${BRAND_PURPLE}; margin-bottom: 12px; }
        .closing-card-copy, .closing-contact-line { font-size: 16px; line-height: 1.8; color: #374151; }
        .closing-quote { font-size: 20px; line-height: 1.7; color: ${BRAND_PURPLE}; max-width: 88%; }
      </style>
    </head>
    <body>
      <section class="page cover">
        <div>
          <div class="cover-main">
            <div class="cover-subtitle">${escapeHtml(subtitle)}</div>
            <div class="cover-line"></div>
            <div class="cover-company">${escapeHtml(args.companyName)}</div>
            ${docType === 'business_plan' ? `<div class="cover-kicker">Strategiskt dokument framtaget för beslutsfattare och investerare</div>` : ''}
          </div>
        </div>
        <div class="cover-bottom"><div class="cover-brand">Ridvan</div><div class="cover-date">${escapeHtml(date)}</div></div>
      </section>
      ${docType === 'business_plan' ? `<section class="page toc-page"><h1 class="toc-title">Innehåll</h1>${toc}<footer class="page-footer"><span>${escapeHtml(args.companyName)}</span><span>2</span><span>Ridvan</span></footer></section>` : ''}
      <section class="markdown-preview">${richMarkdownHtml}</section>
      ${bodyPages}
      ${closingPage}
    </body>
  </html>`;
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
      while (i < lines.length) {
        const l = (lines[i] ?? '').trim();
        if (!/^[-*]\s+/.test(l)) {
          break;
        }
        items.push(stripMarkdown(l.replace(/^[-*]\s+/, '')));
        i++;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }

    if (line.trim().includes('|') && i + 1 < lines.length) {
      const next = (lines[i + 1] ?? '').trim();
      const isSep = /^\|?\s*[-:]+\s*\|/.test(next) || next.replace(/\s/g, '').startsWith('|---');
      if (isSep) {
        const headerCells = line
          .split('|')
          .map((x) => stripMarkdown(x.trim()))
          .filter((x) => x.length > 0);

        i += 2;
        const rows: string[][] = [];
        while (i < lines.length) {
          const rowLine = (lines[i] ?? '').trim();
          if (!rowLine.includes('|') || rowLine.trim().length === 0) {
            break;
          }
          const cells = rowLine
            .split('|')
            .map((x) => stripMarkdown(x.trim()))
            .filter((x) => x.length > 0);
          if (cells.length > 0) {
            rows.push(cells);
          }
          i++;
        }

        blocks.push({ kind: 'table', headers: headerCells, rows });
        continue;
      }
    }

    const parts: string[] = [];
    while (i < lines.length) {
      const l = (lines[i] ?? '').trimEnd();
      if (l.trim().length === 0) {
        break;
      }
      if (/^(#{1,3})\s+/.test(l.trim()) || /^[-*]\s+/.test(l.trim())) {
        break;
      }
      parts.push(stripMarkdown(l));
      i++;
    }

    const paragraph = parts.join(' ').trim();
    if (paragraph.length > 0) {
      blocks.push({ kind: 'p', text: paragraph });
    }

    i++;
  }

  return { title: title || fallbackTitle, blocks };
}

function safeFilename(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\-_\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

async function uploadAndSign(args: { path: string; bytes: Uint8Array; contentType: string }) {
  await supabaseAdmin.storage.createBucket(BUCKET, { public: false }).catch(() => {
    // ignore
  });

  const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET).upload(args.path, args.bytes, {
    contentType: args.contentType,
    upsert: true,
  });

  if (uploadError) {
    throw new Error(`[RIDVAN-E1602] Upload failed: ${uploadError.message}`);
  }

  const { data: signed, error: signedError } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(args.path, 60 * 60);
  if (signedError || !signed) {
    throw new Error(`[RIDVAN-E1603] Signed URL failed: ${signedError?.message ?? 'unknown error'}`);
  }

  return signed.signedUrl;
}

async function renderPdf(args: { title: string; blocks: DocBlock[]; documentType: string }) {
  const companyName = normalizeCompanyName(args.title);
  const html = renderPdfHtml({
    title: args.title,
    companyName,
    blocks: args.blocks,
    markdown: blocksToMarkdown(args.blocks),
    documentType: args.documentType,
  });
  const browser = await puppeteer.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 2048, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    const copy = new Uint8Array(pdf.byteLength);
    copy.set(pdf);
    return copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength);
  } finally {
    await browser.close();
  }
}

async function renderDocx(args: { title: string; blocks: DocBlock[] }) {
  const companyName = normalizeCompanyName(args.title);
  const sections = groupBlocksIntoSections(args.blocks, args.title);
  const children: Array<Paragraph | Table | TableOfContents> = [];

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 2200, after: 120 },
      children: [new TextRun({ text: 'RIDVAN', bold: true, color: 'FFFFFF', size: 24 })],
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: '4C1D95' },
      border: {
        top: { style: BorderStyle.NONE, size: 0, color: '4C1D95' },
        bottom: { style: BorderStyle.NONE, size: 0, color: '4C1D95' },
        left: { style: BorderStyle.NONE, size: 0, color: '4C1D95' },
        right: { style: BorderStyle.NONE, size: 0, color: '4C1D95' },
      },
    }),
  );
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 900, after: 120 },
      children: [new TextRun({ text: companyName, bold: true, color: 'FFFFFF', size: 36 })],
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: '4C1D95' },
    }),
  );
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 1600 },
      children: [new TextRun({ text: args.title, color: 'EDE9FE', size: 20 })],
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: '4C1D95' },
    }),
  );
  children.push(new Paragraph({ pageBreakBefore: true, text: '' }));
  children.push(
    new Paragraph({
      text: 'Innehåll',
      heading: HeadingLevel.HEADING_1,
      thematicBreak: true,
    }),
  );
  children.push(
    new TableOfContents('Innehåll', {
      hyperlink: true,
      headingStyleRange: '1-3',
    }),
  );
  children.push(new Paragraph({ pageBreakBefore: true, text: '' }));

  sections.forEach((section, sectionIndex) => {
    children.push(
      new Paragraph({
        text: `${sectionIndex + 1}. ${section.title}`,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 180 },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'EDE9FE' },
        border: {
          left: { style: BorderStyle.SINGLE, size: 12, color: '7C3AED' },
        },
      }),
    );

    for (const b of section.blocks) {
      if (b.kind === 'h3') {
        children.push(
          new Paragraph({
            text: b.text,
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 160, after: 80 },
            border: { left: { style: BorderStyle.SINGLE, size: 8, color: '7C3AED' } },
          }),
        );
        continue;
      }

      if (b.kind === 'p') {
        const isCallout = b.text.length > 120 && /insikt|viktigt|rekommendation|risk|policy|mål/i.test(b.text);
        children.push(
          new Paragraph({
            spacing: { after: 120 },
            border: isCallout
              ? { left: { style: BorderStyle.SINGLE, size: 12, color: '7C3AED' } }
              : undefined,
            shading: isCallout ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F5F3FF' } : undefined,
            children: [new TextRun({ text: b.text, color: '374151', italics: isCallout })],
          }),
        );
        continue;
      }

      if (b.kind === 'ul') {
        for (const it of b.items) {
          children.push(
            new Paragraph({
              text: it,
              bullet: { level: 0 },
              spacing: { after: 80 },
            }),
          );
        }
        continue;
      }

      if (b.kind === 'table') {
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                tableHeader: true,
                children: b.headers.map(
                  (cell) =>
                    new TableCell({
                      shading: { type: ShadingType.CLEAR, color: 'auto', fill: '7C3AED' },
                      children: [new Paragraph({ children: [new TextRun({ text: cell, bold: true, color: 'FFFFFF' })] })],
                    }),
                ),
              }),
              ...b.rows.map(
                (row, rowIndex) =>
                  new TableRow({
                    children: row.map(
                      (cell) =>
                        new TableCell({
                          shading: { type: ShadingType.CLEAR, color: 'auto', fill: rowIndex % 2 === 0 ? 'FFFFFF' : 'F9FAFB' },
                          children: [new Paragraph({ children: [new TextRun({ text: cell, color: '374151' })] })],
                        }),
                    ),
                  }),
              ),
            ],
          }),
        );
        children.push(new Paragraph({ text: '' }));
      }
    }
  });

  const doc = new DocxDocument({
    styles: {
      default: {
        document: {
          run: {
            font: 'Inter',
            size: 24,
            color: '374151',
          },
          paragraph: {
            spacing: { line: 360, after: 120 },
          },
        },
      },
    },
    sections: [
      {
        properties: {},
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: `${companyName} | `, color: '9CA3AF', size: 20 }),
                  new TextRun({ children: [PageNumber.CURRENT], color: '9CA3AF', size: 20 }),
                  new TextRun({ text: ' | Ridvan', color: '9CA3AF', size: 20 }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return buffer;
}

async function renderXlsx(args: { title: string; blocks: DocBlock[] }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Ridvan';
  wb.calcProperties.fullCalcOnLoad = true;
  const coverName = 'Översikt';
  const cover = wb.addWorksheet(coverName);
  const sheetName = normalizeCompanyName(args.title).slice(0, 31);
  const ws = wb.addWorksheet(sheetName || 'Ridvan');
  const border = { style: 'thin' as const, color: { argb: 'FFE5E7EB' } };
  const companyName = normalizeCompanyName(args.title);
  const periodLabel = inferSpreadsheetPeriod(args.title, args.blocks);

  cover.properties.defaultColWidth = 18;
  cover.views = [{ showGridLines: false }];
  cover.getCell('A1').value = companyName;
  cover.getCell('A1').font = { bold: true, size: 24, color: { argb: 'FFFFFFFF' } };
  cover.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
  cover.mergeCells('A1:F3');
  cover.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
  cover.getCell('A4').value = args.title;
  cover.getCell('A4').font = { bold: true, size: 16, color: { argb: 'FF1A1A1A' } };
  cover.mergeCells('A4:F4');
  cover.getCell('A5').value = periodLabel;
  cover.getCell('A5').font = { size: 12, color: { argb: 'FF6B7280' } };
  cover.mergeCells('A5:F5');
  cover.getCell('A7').value = 'Premium finansiell rapport genererad av Ridvan';
  cover.getCell('A7').font = { size: 12, color: { argb: 'FF7C3AED' } };
  cover.mergeCells('A7:F7');
  cover.properties.tabColor = { argb: 'FF7C3AED' };

  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.properties.tabColor = { argb: 'FF7C3AED' };

  let rowIndex = 1;
  let hasStructuredTable = false;

  for (const block of args.blocks) {
    if (block.kind === 'table' && block.headers.length > 0) {
      hasStructuredTable = true;
      const header = ws.getRow(rowIndex);

      block.headers.forEach((cell, index) => {
        const target = header.getCell(index + 1);
        target.value = cell;
        target.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
        target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
        target.alignment = { vertical: 'middle', horizontal: 'left' };
        target.border = { top: border, left: border, bottom: border, right: border };
      });
      header.height = 32;

      rowIndex += 1;

      for (const [dataIndex, row] of block.rows.entries()) {
        const excelRow = ws.getRow(rowIndex);

        row.forEach((cell, index) => {
          const target = excelRow.getCell(index + 1);
          const parsedNumber = tryParseNumber(cell);

          target.value = parsedNumber !== null ? parsedNumber : cell;
          target.border = { top: border, left: border, bottom: border, right: border };
          target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: dataIndex % 2 === 0 ? 'FFFFFFFF' : 'FFF5F3FF' } };
          target.alignment = { vertical: 'middle', horizontal: parsedNumber !== null ? 'right' : 'left' };

          if (parsedNumber !== null) {
            target.numFmt = '# ##0 "kr"';
            target.font = {
              color: { argb: parsedNumber < 0 ? 'FFDC2626' : 'FF16A34A' },
              bold: parsedNumber < 0,
            };
            if (parsedNumber < 0) {
              target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1F2' } };
            }
          }
        });

        const lastText = String(row[row.length - 1] ?? '').toLowerCase();
        const firstText = String(row[0] ?? '').toLowerCase();
        if (lastText.includes('total') || firstText.includes('total') || lastText.includes('summa') || firstText.includes('summa')) {
          excelRow.font = { bold: true };
          excelRow.eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
          });
        }

        rowIndex += 1;
      }

      rowIndex += 1;
    }
  }

  if (!hasStructuredTable) {
    const intro = ws.getRow(rowIndex);
    intro.getCell(1).value = args.title;
    intro.font = { bold: true, size: 18, color: { argb: 'FF7C3AED' } };
    rowIndex += 2;

    for (const block of args.blocks) {
      if (block.kind === 'h1' || block.kind === 'h2' || block.kind === 'h3') {
        const row = ws.getRow(rowIndex);
        row.getCell(1).value = block.text;
        row.font = { bold: true, size: block.kind === 'h1' ? 16 : 14, color: { argb: 'FF7C3AED' } };
        rowIndex += 1;
        continue;
      }

      if (block.kind === 'p') {
        const row = ws.getRow(rowIndex);
        row.getCell(1).value = block.text;
        row.getCell(1).alignment = { wrapText: true };
        rowIndex += 1;
        continue;
      }

      if (block.kind === 'ul') {
        for (const item of block.items) {
          const row = ws.getRow(rowIndex);
          row.getCell(1).value = `— ${item}`;
          rowIndex += 1;
        }
      }
    }
  }

  const inferredCashflow = `${args.title}`.toLowerCase().includes('cashflow') || `${args.title}`.toLowerCase().includes('kassaflöde');
  if (inferredCashflow && ws.rowCount >= 2) {
    const lastColumn = Math.max(2, ws.columnCount + 1);
    ws.getRow(1).getCell(lastColumn).value = 'Running total';
    ws.getRow(1).getCell(lastColumn).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).getCell(lastColumn).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
    ws.getRow(1).getCell(lastColumn).border = { top: border, left: border, bottom: border, right: border };

    let runningTotal = 0;
    for (let row = 2; row <= ws.rowCount; row += 1) {
      let rowSum = 0;
      for (let col = 2; col <= lastColumn - 1; col += 1) {
        const value = ws.getRow(row).getCell(col).value;
        if (typeof value === 'number') {
          rowSum += value;
        }
      }
      runningTotal += rowSum;
      const cell = ws.getRow(row).getCell(lastColumn);
      cell.value = runningTotal;
      cell.numFmt = '# ##0 "kr"';
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
      cell.border = { top: border, left: border, bottom: border, right: border };
      cell.font = { color: { argb: runningTotal < 0 ? 'FFDC2626' : 'FF16A34A' }, bold: runningTotal < 0 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: runningTotal < 0 ? 'FFFFF1F2' : 'FFF0FDF4' } };
    }
  }

  ws.eachRow((row, rowNumber) => {
    row.height = 24;
    row.eachCell((cell) => {
      if (rowNumber > 1 && !cell.border?.top) {
        cell.border = { top: border, left: border, bottom: border, right: border };
      }
    });
  });

  const columnCount = Math.max(...ws.getSheetValues().map((entry) => (Array.isArray(entry) ? entry.length : 0)), 1);
  for (let col = 1; col <= columnCount; col += 1) {
    let max = col === 1 ? 28 : 16;
    for (let row = 1; row <= ws.rowCount; row += 1) {
      const value = ws.getRow(row).getCell(col).value;
      const text = typeof value === 'object' && value !== null && 'richText' in value ? JSON.stringify(value) : String(value ?? '');
      max = Math.max(max, Math.min(col === 1 ? 28 : 16, text.length + 4));
    }
    ws.getColumn(col).width = max;
    ws.getColumn(col).alignment = { horizontal: col === 1 ? 'left' : 'right', vertical: 'middle' };
  }
  ws.pageSetup.printArea = `A1:${String.fromCharCode(64 + Math.max(1, columnCount))}${Math.max(1, ws.rowCount)}`;

  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return buf;
}

async function renderPptx(args: { title: string; blocks: DocBlock[] }) {
  const pptx = new PptxGenJS();
  const pptxAny = pptx as any;
  pptx.layout = 'LAYOUT_WIDE';
  pptxAny.author = 'Ridvan';
  pptxAny.company = 'Ridvan';
  pptxAny.subject = args.title;
  const companyName = normalizeCompanyName(args.title);
  const date = formatDateLabel();
  const sections = groupBlocksIntoSections(args.blocks, args.title);
  const cover = pptx.addSlide();
  const coverAny = cover as any;
  coverAny.background = { color: '7C3AED' };
  coverAny.addShape('rect', {
    x: 0,
    y: 0,
    w: 13.333,
    h: 7.5,
    fill: { color: '7C3AED', transparency: 0 },
    line: { color: '7C3AED', transparency: 100 },
  });
  coverAny.addShape('rect', {
    x: 7.3,
    y: -0.8,
    w: 7,
    h: 8.5,
    rotate: 18,
    fill: { color: 'EC4899', transparency: 22 },
    line: { color: 'EC4899', transparency: 100 },
  });
  cover.addText('Ridvan', { x: 0.7, y: 0.5, w: 2.2, h: 0.4, fontSize: 18, color: 'FFFFFF', bold: true });
  cover.addText(companyName, { x: 1.3, y: 2.25, w: 10.7, h: 0.8, fontSize: 44, color: 'FFFFFF', bold: true, align: 'center', breakLine: false });
  cover.addText(args.title, { x: 1.6, y: 3.2, w: 10.1, h: 0.45, fontSize: 20, color: 'FDF4FF', bold: false, align: 'center', transparency: 20 });
  coverAny.addShape('roundRect', {
    x: 10.6,
    y: 1.15,
    w: 1.7,
    h: 1.7,
    rectRadius: 0.08,
    fill: { color: 'FFFFFF', transparency: 84 },
    line: { color: 'FFFFFF', transparency: 100 },
  });
  coverAny.addShape('line', {
    x: 4.1,
    y: 6.5,
    w: 5.1,
    h: 0,
    line: { color: 'FFFFFF', width: 1, transparency: 30 },
  });
  cover.addText('Konfidentiellt', { x: 5.1, y: 6.58, w: 3.1, h: 0.2, fontSize: 12, color: 'FFFFFF', align: 'center', transparency: 20 });

  sections.forEach((section, index) => {
    const slide = pptx.addSlide();
    const slideAny = slide as any;
    slideAny.background = { color: 'FFFFFF' };
    slideAny.addShape('rect', {
      x: 0,
      y: 0,
      w: 13.333,
      h: 0.08,
      fill: { color: '7C3AED' },
      line: { color: '7C3AED', transparency: 100 },
    });
    slide.addText(section.title, { x: 0.7, y: 0.55, w: 9.6, h: 0.52, fontSize: 28, color: '1A1A1A', bold: true });
    slideAny.addShape('line', {
      x: 0.7,
      y: 1.16,
      w: 0.8,
      h: 0,
      line: { color: 'EC4899', width: 2 },
    });

    let y = 1.52;

    for (const block of section.blocks) {
      if (y > 6.1) {
        break;
      }

      if (block.kind === 'h3') {
        slide.addText(block.text, { x: 0.8, y, w: 8.6, h: 0.35, fontSize: 18, color: '1A1A1A', bold: true });
        y += 0.38;
        continue;
      }

      if (block.kind === 'p') {
        slide.addText(block.text, { x: 0.8, y, w: 7.8, h: 0.72, fontSize: 17, color: '374151', breakLine: true, margin: 0.04, valign: 'top' });
        y += 0.72;
        continue;
      }

      if (block.kind === 'ul') {
        for (const item of block.items.slice(0, 4)) {
          slide.addText(`— ${item}`, { x: 0.95, y, w: 7.6, h: 0.42, fontSize: 17, color: '374151' });
          y += 0.42;
        }
        continue;
      }

      if (block.kind === 'table') {
        const rows = [block.headers, ...block.rows.slice(0, 5)];
        slideAny.addTable(rows, {
          x: 0.8,
          y,
          w: 11.2,
          h: 2.2,
          border: { type: 'solid', color: 'E7E5E4', pt: 1 },
          fill: 'FFFFFF',
          color: '0A0A0A',
          fontSize: 14,
          rowH: 0.35,
          bold: false,
          margin: 0.05,
          autoFit: true,
        });
        y += 1.8;
      }
    }

    const stats = extractStats(section.blocks).slice(0, 2);
    stats.forEach((stat, statIndex) => {
      slideAny.addShape('roundRect', {
        x: 9.2 + statIndex * 1.75,
        y: 1.45,
        w: 1.6,
        h: 1.5,
        rectRadius: 0.08,
        fill: { color: 'FFFFFF' },
        line: { color: statIndex === 0 ? 'DDD6FE' : 'FBCFE8', pt: 1 },
      });
      slide.addText(stat.value, { x: 9.3 + statIndex * 1.75, y: 1.72, w: 1.4, h: 0.52, fontSize: 24, color: '7C3AED', bold: true, align: 'center' });
      slide.addText(stat.label, { x: 9.28 + statIndex * 1.75, y: 2.28, w: 1.44, h: 0.26, fontSize: 10, color: '9CA3AF', align: 'center' });
    });

    slide.addText(companyName, { x: 0.7, y: 7.02, w: 2.6, h: 0.2, fontSize: 11, color: '9CA3AF' });
    slide.addText(`${index + 2}`, { x: 11.8, y: 7.0, w: 0.4, h: 0.2, fontSize: 12, color: '7C3AED', align: 'right' });
  });

  const raw = (await pptx.write('arraybuffer')) as ArrayBuffer | SharedArrayBuffer;
  const u8 = new Uint8Array(raw);
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  if (!FEATURE_FLAGS.documentGeneration) {
    return disabledResponse();
  }

  const { user } = await requireUserFromBearerToken(request);
  const body = (await request.json().catch(() => null)) as
    | { projectId?: string; title?: string; documentType?: string; format?: MentorDocumentFormat; content?: string }
    | null;

  const projectId = body?.projectId;
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const documentType = typeof body?.documentType === 'string' ? body.documentType.trim() : 'other';
  const format = body?.format;
  const content = typeof body?.content === 'string' ? body.content : '';

  if (!projectId || !title || !format || !content) {
    return Response.json({ error: '[RIDVAN-E1600] Missing fields' }, { status: 400 });
  }

  const cost = documentCreditCost(documentType);
  if (cost > 0) {
    const creditState = await checkCredits(user.id);
    if (!creditState.allowed || creditState.remaining < cost) {
      return noCreditsResponse();
    }
  }

  // Explicit ownership validation (defense in depth).
  const { data: projectRow, error: projectError } = await supabaseAdmin
    .from('projects')
    .select('id, user_id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .maybeSingle<{ id: string; user_id: string }>();

  if (projectError) {
    return Response.json({ error: `[RIDVAN-E1606] Project lookup failed: ${projectError.message}` }, { status: 500 });
  }
  if (!projectRow) {
    return Response.json({ error: '[RIDVAN-E1607] Unauthorized project' }, { status: 403 });
  }

  const workspace = await ensureBrainWorkspace(projectId, user.id);

  const parsed = parseMarkdownToBlocks(content, title);
  const safeBase = safeFilename(parsed.title || title || 'document');
  const filename = `${safeBase}.${format}`;
  const path = `${workspace.id}/${projectId}/${Date.now()}-${filename}`;

  try {
    let arrayBuffer: ArrayBuffer;
    let contentType = 'application/octet-stream';

    if (format === 'pdf') {
      arrayBuffer = await renderPdf({ title: parsed.title, blocks: parsed.blocks, documentType });
      contentType = 'application/pdf';
    } else if (format === 'docx') {
      const buf = await renderDocx({ title: parsed.title, blocks: parsed.blocks });
      const u8 = new Uint8Array(buf);
      arrayBuffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    } else if (format === 'xlsx') {
      arrayBuffer = await renderXlsx({ title: parsed.title, blocks: parsed.blocks });
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else {
      arrayBuffer = await renderPptx({ title: parsed.title, blocks: parsed.blocks });
      contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    }

    const bytes = new Uint8Array(arrayBuffer);
    const url = await uploadAndSign({ path, bytes, contentType });

    if (cost > 0) {
      const deduction = await deductCredit(user.id, `Mentor document: ${documentType}`, cost);
      if (!deduction.success) {
        return noCreditsResponse();
      }
    }

    const eventId = await insertBrainEvent({
      workspaceId: workspace.id,
      projectId,
      userId: user.id,
      source: 'mentor',
      type: 'document.generated',
      payload: {
        title,
        document_type: documentType,
        format,
        storage: { bucket: BUCKET, path, signed_url: url, expires_in_seconds: 60 * 60 },
        assertion_source: 'system_inferred',
      },
    });

    void ingestBrainEventsById([eventId]).catch(() => {
      // ignore
    });

    return Response.json({ ok: true, url, filename });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Document generation failed';
    return Response.json({ error: `[RIDVAN-E1604] ${msg}` }, { status: 500 });
  }
}
