export type MentorRoleKey =
  | 'CEO'
  | 'CFO'
  | 'CMO'
  | 'CTO'
  | 'LEGAL'
  | 'HR'
  | 'SALES_MANAGER'
  | 'ACCOUNT_EXECUTIVE'
  | 'SDR';

export type MentorRoleMatch = {
  role: MentorRoleKey;
  reason: string;
  tone: string;
  focus: Array<'increase_revenue' | 'reduce_costs' | 'reduce_risk'>;
};

function hasAny(text: string, needles: string[]) {
  return needles.some((n) => text.includes(n));
}

export function routeMentorRoles(args: { message: string; brainSummary?: { industry?: string | null; countryCode?: string | null } }) {
  const raw = args.message || '';
  const text = raw.toLowerCase();

  const matches: MentorRoleMatch[] = [];

  const push = (role: MentorRoleKey, reason: string, tone: string, focus: MentorRoleMatch['focus']) => {
    matches.push({ role, reason, tone, focus });
  };

  // 🎯 CEO/VD
  if (hasAny(text, ['strategy', 'strategi', 'priority', 'prioritet', 'focus', 'fokus', 'next step', 'nästa steg', 'what should i focus', 'plan', '90'])) {
    push('CEO', 'User asks for direction / prioritization / planning.', 'Decisive, structured, prioritizes trade-offs and sequencing.', [
      'increase_revenue',
      'reduce_risk',
    ]);
  }

  // 💰 CFO
  if (hasAny(text, ['price', 'pricing', 'prissättning', 'budget', 'cashflow', 'kassaflöde', 'money', 'revenue', 'intäkt', 'cost', 'kostnad', 'margin', 'lönsam'])) {
    push('CFO', 'User mentions pricing/financials/cashflow or cost structure.', 'Precise, numbers-first, assumptions explicit, suggests simple models and next measurements.', [
      'increase_revenue',
      'reduce_costs',
    ]);
  }

  // 📣 CMO
  if (hasAny(text, ['marketing', 'marknadsföring', 'brand', 'varumärke', 'growth', 'customers', 'kunder', 'social', 'instagram', 'tiktok', 'seo', 'ads', 'annonser', 'content', 'innehåll', 'channels', 'kanaler'])) {
    push('CMO', 'User asks about marketing, growth, customers, channels or brand.', 'Creative but concrete, experiments and channels, messaging and positioning.', [
      'increase_revenue',
    ]);
  }

  // 🔧 CTO
  if (hasAny(text, ['tech', 'teknik', 'build', 'bygga', 'security', 'säkerhet', 'scale', 'skala', 'infrastructure', 'arkitektur', 'performance', 'prestanda', 'database', 'api'])) {
    push('CTO', 'User asks about technical decisions, architecture, security or scaling.', 'Pragmatic, risk-aware, clear trade-offs, minimal viable approach first.', [
      'reduce_risk',
      'reduce_costs',
    ]);
  }

  // ⚖️ Legal
  if (hasAny(text, ['legal', 'juridik', 'contract', 'avtal', 'gdpr', 'compliance', 'law', 'lag', 'rights', 'rätt', 'privacy', 'integritet', 'terms', 'villkor'])) {
    push('LEGAL', 'User references legal/compliance/contract/privacy topics.', 'Careful, exact, flags uncertainty, recommends professional review where needed.', [
      'reduce_risk',
    ]);
  }

  // 👥 HR
  if (hasAny(text, ['hire', 'anställa', 'recruit', 'rekrytera', 'team', 'teamet', 'culture', 'kultur', 'employee', 'anställd', 'org', 'organisation'])) {
    push('HR', 'User asks about hiring, team structure, culture or org design.', 'Empathetic but concrete, role clarity, process, and retention levers.', [
      'reduce_risk',
      'reduce_costs',
    ]);
  }

  // 🤝 Sales Manager
  if (hasAny(text, ['sales', 'sälj', 'pipeline', 'crm', 'kpi', 'quota', 'deals', 'deal', 'process', 'processen', 'closing', 'stänga'])) {
    push('SALES_MANAGER', 'User asks about sales process, pipeline, KPIs or team execution.', 'Operational, KPI-driven, process-first, focuses on repeatability.', [
      'increase_revenue',
      'reduce_risk',
    ]);
  }

  // 💼 Account Executive
  if (hasAny(text, ['pitch', 'investor', 'investerare', 'meeting', 'möte', 'objection', 'invändning', 'present', 'presentation', 'demo'])) {
    push('ACCOUNT_EXECUTIVE', 'User asks about pitching, meetings, objections, or closing conversations.', 'Persuasive but non-salesy, crisp narrative, objection handling with empathy.', [
      'increase_revenue',
    ]);
  }

  // 📞 SDR
  if (hasAny(text, ['prospect', 'prospek', 'cold', 'kall', 'linkedin', 'outreach', 'follow up', 'uppföljning', 'dm', 'email', 'cold email'])) {
    push('SDR', 'User asks about prospecting and outbound outreach mechanics.', 'Tactical, message templates, cadence, and simple tracking.', [
      'increase_revenue',
    ]);
  }

  if (matches.length === 0) {
    // Default to CEO + one of CFO/CMO based on weak hints
    push('CEO', 'Default: general business question needs prioritization and next steps.', 'Decisive, structured, action-oriented.', ['increase_revenue', 'reduce_risk']);
  }

  // Deduplicate, keep order
  const seen = new Set<MentorRoleKey>();
  const deduped: MentorRoleMatch[] = [];
  for (const m of matches) {
    if (seen.has(m.role)) continue;
    seen.add(m.role);
    deduped.push(m);
  }

  return deduped.slice(0, 3);
}

export function buildRoleRoutingPrompt(matches: MentorRoleMatch[]) {
  const roles = matches.map((m) => m.role).join(', ');

  const details = matches
    .map(
      (m) =>
        `- ${m.role}: ${m.reason}\n  Tone: ${m.tone}\n  Focus: ${m.focus.join(', ')}`,
    )
    .join('\n');

  return `Invisible role routing (do NOT mention roles):\nActive roles: ${roles}\n\nRole instructions:\n${details}\n\nGlobal rules:\n- Never announce which role you are using.\n- One question may blend multiple roles.\n- Always connect recommendations back to at least one: increase revenue, reduce costs, reduce risk.\n- Keep it practical: concrete next actions and what to measure next.\n`;
}
