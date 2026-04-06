export type MentorDocumentIntent = {
  documentType: string;
  labelSv: string;
};

function matches(text: string, needles: RegExp[]) {
  return needles.some((re) => re.test(text));
}

/**
 * Nyckelord → documentType som matchar Mentor document.ready / api.mentor.document.generate.
 */
export function detectMentorDocumentIntent(message: string): MentorDocumentIntent | null {
  const t = message.trim();
  if (!t) {
    return null;
  }
  const lower = t.toLowerCase();

  const rules: Array<{ match: () => boolean; documentType: string; labelSv: string }> = [
    {
      match: () => matches(lower, [/årsplan/, /\broadmap\b/, /strategisk\s*plan/]),
      documentType: 'annual_roadmap',
      labelSv: 'årsplan eller roadmap',
    },
    {
      match: () => matches(lower, [/affärsplan/, /business\s*plan/]),
      documentType: 'business_plan',
      labelSv: 'affärsplan',
    },
    {
      match: () => matches(lower, [/investerarpitch/, /pitch\s*deck/, /investor\s*pitch/]),
      documentType: 'investor_pitch',
      labelSv: 'investerarpitch',
    },
    {
      match: () => matches(lower, [/finansiell\s*analys/, /financial\s*analysis/]),
      documentType: 'financial_analysis',
      labelSv: 'finansiell analys',
    },
    {
      match: () => matches(lower, [/marknadsanalys/, /market\s*analysis/, /marknadsplan/, /marketing\s*plan/, /säljplan/, /sales\s*plan/]),
      documentType: 'marketing_plan',
      labelSv: 'marknads-/säljplan',
    },
    {
      match: () => matches(lower, [/hr-plan/, /hr\s*plan/, /hr-policy/, /personalplan/]),
      documentType: 'hr_policy',
      labelSv: 'HR-plan',
    },
    {
      match: () => matches(lower, [/\bbudget\b/, /kvartalsbudget/, /quarterly\s*budget/]),
      documentType: 'quarterly_budget',
      labelSv: 'budget',
    },
    {
      match: () => matches(lower, [/forecast/, /prognos/, /kassaflöde/, /cashflow/, /rullande\s*budget/]),
      documentType: 'cashflow',
      labelSv: 'prognos eller kassaflöde',
    },
  ];

  for (const r of rules) {
    if (r.match()) {
      return { documentType: r.documentType, labelSv: r.labelSv };
    }
  }

  return null;
}

export function formatMentorDocumentIntentSystemAddendum(intent: MentorDocumentIntent | null): string {
  if (!intent) {
    return '';
  }
  return `DOKUMENTFÖRFRÅGAN (användaren nämnde: ${intent.labelSv}):
- Skriv INTE ut dokumentets fulltext, tabeller eller bilagor i chatt-svaret.
- Svara med exakt EN kort mening på svenska, t.ex.: "Jag genererar din ${intent.labelSv} nu – den är redo om några sekunder."
- Allt innehåll ska ligga i ETT event document.ready med fält documentType="${intent.documentType}", title, formats och content (fullständigt markdown i content).
- Följ OUTPUT FORMAT (---RIDVAN_EVENTS---) som vanligt.`;
}

export function shortMentorDocumentChatReplySv(documentType: string): string {
  const d = documentType.toLowerCase();
  if (d.includes('annual') || d.includes('roadmap')) {
    return 'Jag genererar din årsplan/roadmap nu – den är redo om några sekunder.';
  }
  if (d.includes('business') || d.includes('affär')) {
    return 'Jag genererar din affärsplan nu – den är redo om några sekunder.';
  }
  if (d.includes('investor') || d.includes('pitch')) {
    return 'Jag genererar din investerarpitch nu – den är redo om några sekunder.';
  }
  if (d.includes('marketing') || d.includes('marknad') || d.includes('sälj')) {
    return 'Jag genererar din marknads-/säljplan nu – den är redo om några sekunder.';
  }
  if (d.includes('financial')) {
    return 'Jag genererar din finansiella analys nu – den är redo om några sekunder.';
  }
  if (d.includes('hr')) {
    return 'Jag genererar din HR-plan nu – den är redo om några sekunder.';
  }
  if (d.includes('quarterly') || d.includes('budget')) {
    return 'Jag genererar din budget nu – den är redo om några sekunder.';
  }
  if (d.includes('cashflow') || d.includes('cash')) {
    return 'Jag genererar din kassaflödes-/prognosfil nu – den är redo om några sekunder.';
  }
  return 'Jag genererar ditt dokument nu – det är redo om några sekunder.';
}
