import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import { readBrainContext } from '~/lib/brain/read.server';
import { getAPIKey } from '~/lib/.server/llm/api-key';
import { supabaseAdmin } from '~/lib/supabase/server';
import { extractGeo, extractIndustryAndGeo, normalizeIndustry } from './taxonomy.server';
import { getModulesForIndustry } from './modules.server';

type Driver = { driver: string; why: string; lever: string; impact: 'revenue' | 'cost' | 'risk' };
type Pattern = {
  pattern: string;
  symptom: string;
  root_cause: string;
  fast_fix: string;
  impact: 'revenue' | 'cost' | 'risk';
};

type ProjectRow = {
  id: string;
  title: string | null;
};

type ProjectChatSessionRow = {
  id: string;
  created_at: string;
  messages: unknown;
};

function extractJsonObject(raw: string) {
  const trimmed = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('[RIDVAN-E1259] Vertical signals response did not contain valid JSON');
  }

  return trimmed.slice(start, end + 1);
}

function pickLanguageInstruction(sourceText: string | null, languageHint: string | null | undefined) {
  const trimmedSource = sourceText?.trim();

  if (trimmedSource) {
    return `Use the same language as this source text: ${JSON.stringify(trimmedSource)}`;
  }

  if (languageHint?.trim()) {
    return `Use this language preference: ${languageHint.trim()}`;
  }

  return 'Use clear English.';
}

async function generateLocalizedVerticalSignals(args: {
  industry: string;
  geo: string | null;
  sourceText: string | null;
  languageHint?: string | null;
  env?: Env;
}) {
  const apiKey = getAPIKey(args.env) ?? '';

  if (!apiKey || !args.industry || args.industry === 'unknown') {
    return null;
  }

  const anthropic = createAnthropic({ apiKey });
  const prompt = `You are a business advisor.
For a ${args.industry} business${args.geo ? ` in ${args.geo}` : ''}, list 3 revenue opportunities and 3 risks.
${pickLanguageInstruction(args.sourceText, args.languageHint)}
Format: short, concrete, actionable. Include numbers or percentages where relevant. Maximum 1 sentence each.
Return only valid JSON in this exact shape:
{
  "revenueDrivers": [{ "title": string, "description": string }],
  "risks": [{ "title": string, "description": string }]
}`;

  const result = await generateText({
    model: anthropic('claude-sonnet-4-5-20250929'),
    temperature: 0.2,
    maxTokens: 500,
    prompt,
  });

  const parsed = JSON.parse(extractJsonObject(result.text)) as {
    revenueDrivers?: Array<{ title?: unknown; description?: unknown }>;
    risks?: Array<{ title?: unknown; description?: unknown }>;
  };

  const revenueDrivers = (parsed.revenueDrivers ?? [])
    .map((item) => {
      const title = typeof item?.title === 'string' ? item.title.trim() : '';
      const description = typeof item?.description === 'string' ? item.description.trim() : '';

      if (!title || !description) {
        return null;
      }

      return {
        driver: title,
        why: description,
        lever: description,
        impact: 'revenue' as const,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 3);

  const failurePatterns = (parsed.risks ?? [])
    .map((item) => {
      const title = typeof item?.title === 'string' ? item.title.trim() : '';
      const description = typeof item?.description === 'string' ? item.description.trim() : '';

      if (!title || !description) {
        return null;
      }

      return {
        pattern: title,
        symptom: description,
        root_cause: description,
        fast_fix: description,
        impact: 'risk' as const,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 3);

  return {
    revenueDrivers,
    failurePatterns,
  };
}

function findFirstUserMessage(messages: unknown) {
  if (!Array.isArray(messages)) {
    return null;
  }

  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      continue;
    }

    const role = typeof (message as { role?: unknown }).role === 'string' ? (message as { role: string }).role : null;
    const content = typeof (message as { content?: unknown }).content === 'string' ? (message as { content: string }).content.trim() : null;

    if (role === 'user' && content) {
      return content;
    }
  }

  return null;
}

async function readProjectContextSources(args: { projectId: string; userId: string }) {
  const [{ data: projectRow, error: projectError }, { data: sessions, error: sessionsError }] = await Promise.all([
    supabaseAdmin.from('projects').select('id, title').eq('id', args.projectId).eq('user_id', args.userId).maybeSingle<ProjectRow>(),
    supabaseAdmin
      .from('project_chat_sessions')
      .select('id, created_at, messages')
      .eq('project_id', args.projectId)
      .eq('user_id', args.userId)
      .order('created_at', { ascending: true })
      .limit(20)
      .returns<ProjectChatSessionRow[]>(),
  ]);

  if (projectError) {
    throw new Error(`[RIDVAN-E1254] Failed to load project fallback data: ${projectError.message}`);
  }

  if (sessionsError) {
    throw new Error(`[RIDVAN-E1255] Failed to load project chat session fallback data: ${sessionsError.message}`);
  }

  let firstUserPrompt: string | null = null;

  for (const session of sessions ?? []) {
    const candidate = findFirstUserMessage(session.messages);

    if (candidate) {
      firstUserPrompt = candidate;
      break;
    }
  }

  return {
    firstUserPrompt,
    projectTitle: projectRow?.title ?? null,
  };
}

function buildFallbackGeoProfile(sourceText: string | null) {
  const extracted = sourceText ? sourceText.trim() : null;
  const geoString = extracted || null;
  const parts = geoString ? geoString.split(',').map((part) => part.trim()).filter(Boolean) : [];
  return {
    countryCode: parts[1]?.length === 2 ? parts[1].toUpperCase() : 'SE',
    country: parts[1] ?? 'Sverige',
    city: parts[0] ?? null,
    currencyCode: 'SEK',
    taxModel: 'vat',
    languageCodes: ['sv'],
  };
}

function buildExpectedBusinessModel(industry: string) {
  switch (industry) {
    case 'hair_salon':
      return 'Service business (time-slot inventory), revenue per appointment + retention.';
    case 'restaurant':
      return 'Hospitality business (seat inventory), revenue per cover + turn-time efficiency.';
    case 'gym':
      return 'Membership business (recurring), retention and attendance drive LTV.';
    case 'legal_firm':
    case 'law_firm':
      return 'Professional services (time inventory), lead quality and speed-to-response matter.';
    case 'hotel':
      return 'Hospitality inventory business, where occupancy, ADR, and direct bookings shape revenue.';
    case 'clinic':
      return 'Appointment-based care business, where utilization, trust, and rebooking drive growth.';
    case 'real_estate':
      return 'Lead-conversion business, where listing quality and response speed create commissions.';
    case 'bakery':
      return 'High-frequency local retail, where repeat purchases, pre-orders, and basket size matter.';
    case 'beauty':
      return 'Service and retention business, where recurring visits, premium add-ons, and trust build LTV.';
    case 'consultant':
      return 'Expert-service business, where authority, packaging, and sales conversion determine utilization.';
    case 'school':
    case 'education':
      return 'Enrollment business, where cohort fill rate, retention, and student outcomes drive value.';
    case 'ecommerce':
    case 'e_commerce':
      return 'Commerce business, where product discovery, checkout conversion, and repeat purchase drive growth.';
    case 'food_delivery':
      return 'Delivery operations business, where order volume, routing efficiency, and repeat customers drive margin.';
    case 'auto_repair':
      return 'Workshop service business, where capacity utilization, trust, and repeat maintenance drive revenue.';
    case 'accounting':
      return 'Professional recurring-service business, where retention, response speed, and trust protect LTV.';
    case 'event_planning':
      return 'Event service business, where conversion, logistics quality, and referrals drive growth.';
    case 'photography':
      return 'Creative service business, where trust, proof of quality, and booking conversion drive revenue.';
    default:
      return 'Unknown';
  }
}

function buildVerticalSignals(industry: string) {
  const revenueDrivers: Driver[] = [];
  const failurePatterns: Pattern[] = [];

  return { revenueDrivers, failurePatterns };
}

export async function getVerticalContext(args: {
  projectId: string;
  userId: string;
  language?: string | null;
  env?: Env;
  /** When set, skips a duplicate readBrainContext inside this function */
  brain?: Awaited<ReturnType<typeof readBrainContext>>;
  /** No taxonomy LLM / no localized vertical LLM — static + heuristic industry only (Mentor latency) */
  mentorFastPath?: boolean;
}) {
  const brain = args.brain ?? (await readBrainContext({ projectId: args.projectId, userId: args.userId }));

  const contextSources = await readProjectContextSources(args);

  let promptIndustry: ReturnType<typeof normalizeIndustry> | null = null;
  let titleIndustry: ReturnType<typeof normalizeIndustry> | null = null;
  let promptGeoString: string | null = null;
  let titleGeoString: string | null = null;

  if (args.mentorFastPath) {
    if (contextSources.firstUserPrompt) {
      promptIndustry = normalizeIndustry(contextSources.firstUserPrompt);
    }
    if (contextSources.projectTitle) {
      titleIndustry = normalizeIndustry(contextSources.projectTitle);
    }
  } else {
    const [promptExtraction, titleExtraction] = await Promise.all([
      contextSources.firstUserPrompt
        ? extractIndustryAndGeo(contextSources.firstUserPrompt)
        : Promise.resolve({ industry: null, geo: null }),
      contextSources.projectTitle
        ? extractIndustryAndGeo(contextSources.projectTitle)
        : Promise.resolve({ industry: null, geo: null }),
    ]);
    promptIndustry = promptExtraction.industry ? normalizeIndustry(promptExtraction.industry) : null;
    titleIndustry = titleExtraction.industry ? normalizeIndustry(titleExtraction.industry) : null;
    const [pg, tg] = await Promise.all([
      promptExtraction.geo
        ? Promise.resolve(promptExtraction.geo)
        : contextSources.firstUserPrompt
          ? extractGeo(contextSources.firstUserPrompt)
          : Promise.resolve(null),
      titleExtraction.geo
        ? Promise.resolve(titleExtraction.geo)
        : contextSources.projectTitle
          ? extractGeo(contextSources.projectTitle)
          : Promise.resolve(null),
    ]);
    promptGeoString = pg;
    titleGeoString = tg;
  }

  const brainIndustry = brain?.industryProfile ?? null;
  const promptGeo = buildFallbackGeoProfile(promptGeoString);
  const titleGeo = buildFallbackGeoProfile(titleGeoString);
  const industry =
    (promptIndustry && promptIndustry.normalizedIndustry !== 'unknown' ? promptIndustry.normalizedIndustry : null) ??
    (titleIndustry && titleIndustry.normalizedIndustry !== 'unknown' ? titleIndustry.normalizedIndustry : null) ??
    brain?.industryProfile?.normalizedIndustry ??
    'unknown';
  const geoCountryCode =
    (promptGeo.countryCode || null) ??
    (titleGeo.countryCode || null) ??
    brain?.geoProfile?.countryCode ??
    'SE';
  const geoProfile = {
    ...(brain?.geoProfile ?? {}),
    ...titleGeo,
    ...promptGeo,
    countryCode: promptGeo.countryCode ?? titleGeo.countryCode ?? brain?.geoProfile?.countryCode ?? 'SE',
    country: promptGeo.country ?? titleGeo.country ?? (brain?.geoProfile as { country?: string | null } | undefined)?.country ?? 'Sverige',
    city:
      promptGeo.city ??
      titleGeo.city ??
      (brain?.geoProfile as { city?: string | null } | undefined)?.city ??
      null,
  };

  const modules = getModulesForIndustry(industry as any, geoCountryCode);

  const expectedBusinessModel = buildExpectedBusinessModel(industry);
  const { revenueDrivers, failurePatterns } = buildVerticalSignals(industry);
  const localizedSignals = args.mentorFastPath
    ? null
    : await generateLocalizedVerticalSignals({
        industry,
        geo: [promptGeo.city, titleGeo.city, geoProfile.city, geoProfile.country].filter(Boolean).join(', ') || null,
        sourceText: contextSources.firstUserPrompt ?? contextSources.projectTitle,
        languageHint: args.language ?? null,
        env: args.env,
      }).catch(() => null);

  if (industry === 'hair_salon') {
    revenueDrivers.push(
      {
        driver: 'Bookings from intent',
        why: 'Most revenue is lost between “I want a time” and “I booked”.',
        lever: 'Make booking path obvious + reduce steps.',
        impact: 'revenue',
      },
      {
        driver: 'Show-up rate',
        why: 'No-shows burn your inventory.',
        lever: 'Reminders + deposit/no-show policy for peak slots.',
        impact: 'revenue',
      },
      {
        driver: 'Retention & rebooking',
        why: 'Salons win on repeat behavior, not one-off ads.',
        lever: 'Rebook at checkout + customer preferences + consistent staff mapping.',
        impact: 'revenue',
      },
    );

    failurePatterns.push(
      {
        pattern: 'Traffic exists, bookings don’t',
        symptom: 'Visitors ask questions but don’t commit.',
        root_cause: 'No single booking CTA + unclear services/durations.',
        fast_fix: 'Service catalog + clear “Book now” on every service.',
        impact: 'revenue',
      },
      {
        pattern: 'Calendar chaos',
        symptom: 'Double bookings, wrong duration, staff mismatch.',
        root_cause: 'No shared capacity rules and staff availability.',
        fast_fix: 'Staff schedule + duration per service + buffer rules.',
        impact: 'cost',
      },
      {
        pattern: 'No-shows on prime hours',
        symptom: 'Peak slots wasted, revenue inconsistent.',
        root_cause: 'No friction for last-minute cancellations.',
        fast_fix: 'Automated reminders + deposit for high-demand slots.',
        impact: 'revenue',
      },
    );
  }

  if (industry === 'hotel') {
    revenueDrivers.push(
      {
        driver: 'Direct bookings',
        why: 'Every OTA-heavy booking erodes margin and weakens customer ownership.',
        lever: 'Drive guests to direct booking with clear rooms, trust signals, and local value.',
        impact: 'revenue',
      },
      {
        driver: 'Occupancy and average daily rate',
        why: 'Profitability comes from balancing filled rooms with the right pricing.',
        lever: 'Seasonal pricing, room packaging, and upsells on premium rooms.',
        impact: 'revenue',
      },
    );

    failurePatterns.push(
      {
        pattern: 'Traffic but weak direct conversion',
        symptom: 'Guests browse rooms but book elsewhere.',
        root_cause: 'Room types, prices, and trust information are unclear or buried.',
        fast_fix: 'Show room categories, availability CTA, and booking trust cues above the fold.',
        impact: 'revenue',
      },
      {
        pattern: 'Empty shoulder nights',
        symptom: 'Occupancy swings hard outside peak dates.',
        root_cause: 'No packages or campaigns for low-demand periods.',
        fast_fix: 'Create weekday offers and local-experience bundles for soft dates.',
        impact: 'revenue',
      },
    );
  }

  if (industry === 'clinic') {
    revenueDrivers.push(
      {
        driver: 'Utilization of appointment slots',
        why: 'Empty time slots are lost revenue in a fixed-capacity business.',
        lever: 'Online booking, reminders, and clearer first-step offers.',
        impact: 'revenue',
      },
      {
        driver: 'Trust and repeat visits',
        why: 'Patients return when the clinic feels credible, safe, and easy to use.',
        lever: 'Practitioner profiles, treatment clarity, and follow-up journeys.',
        impact: 'revenue',
      },
    );

    failurePatterns.push(
      {
        pattern: 'Potential patients hesitate',
        symptom: 'Visitors read but do not book.',
        root_cause: 'Unclear treatment descriptions, pricing, or practitioner trust signals.',
        fast_fix: 'Clarify services, credentials, pricing, and one clear booking CTA.',
        impact: 'revenue',
      },
      {
        pattern: 'No-shows and admin drag',
        symptom: 'Staff spend too much time on calls and rescheduling.',
        root_cause: 'Booking and reminder flows are manual.',
        fast_fix: 'Automate confirmations, reminders, and intake collection before visits.',
        impact: 'cost',
      },
    );
  }

  if (industry === 'real_estate') {
    revenueDrivers.push(
      {
        driver: 'Lead response speed',
        why: 'The first relevant responder often wins the seller or buyer.',
        lever: 'Fast contact forms, valuation CTA, and routing to the right agent.',
        impact: 'revenue',
      },
      {
        driver: 'Listing quality and trust',
        why: 'Strong listings convert interest into viewings and mandates.',
        lever: 'Structured listings, search filters, agent proof, and local expertise.',
        impact: 'revenue',
      },
    );

    failurePatterns.push(
      {
        pattern: 'Leads arrive but don’t convert',
        symptom: 'People browse listings without booking a viewing or valuation.',
        root_cause: 'Weak CTA hierarchy and missing agent credibility.',
        fast_fix: 'Add valuation CTA, agent proof, and clearer next-step actions on each page.',
        impact: 'revenue',
      },
      {
        pattern: 'Listing search feels frustrating',
        symptom: 'Users bounce before exploring properties.',
        root_cause: 'No filters, poor photo structure, or unclear property details.',
        fast_fix: 'Improve search filters, listing cards, and property detail layout.',
        impact: 'risk',
      },
    );
  }

  if (industry === 'bakery') {
    revenueDrivers.push(
      {
        driver: 'Repeat local purchases',
        why: 'Bakeries grow through habit and neighborhood loyalty.',
        lever: 'Show daily menu, pre-ordering, and recurring visit triggers.',
        impact: 'revenue',
      },
      {
        driver: 'Custom orders and higher basket size',
        why: 'Cakes, catering, and bundles lift margin above walk-in sales.',
        lever: 'Promote custom-order CTA and pickup ordering online.',
        impact: 'revenue',
      },
    );

    failurePatterns.push(
      {
        pattern: 'People love the products but don’t pre-order',
        symptom: 'Demand is inconsistent and special orders happen manually.',
        root_cause: 'No easy order form or visible custom-order journey.',
        fast_fix: 'Add custom order CTA with product categories and pickup details.',
        impact: 'revenue',
      },
      {
        pattern: 'Opening hours and menu are unclear',
        symptom: 'Visitors ask basic questions instead of buying.',
        root_cause: 'Missing daily menu visibility and weak practical info.',
        fast_fix: 'Show opening hours, daily highlights, and prices prominently.',
        impact: 'cost',
      },
    );
  }

  if (industry === 'beauty') {
    revenueDrivers.push(
      {
        driver: 'Recurring appointments',
        why: 'Beauty businesses compound through repeat visits and rebooking.',
        lever: 'Online booking, staff specialization, and rebooking nudges.',
        impact: 'revenue',
      },
      {
        driver: 'Premium service mix',
        why: 'High-margin treatments often need better presentation and trust.',
        lever: 'Use before/after proof, clear pricing, and premium treatment framing.',
        impact: 'revenue',
      },
    );

    failurePatterns.push(
      {
        pattern: 'Interest without booking',
        symptom: 'Instagram-style traffic does not translate into appointments.',
        root_cause: 'Weak proof, unclear menu, or too many manual steps.',
        fast_fix: 'Add before/after gallery, clear service menu, and one booking CTA.',
        impact: 'revenue',
      },
      {
        pattern: 'Clients forget to return',
        symptom: 'Retention is lower than expected after first visit.',
        root_cause: 'No reminder or rebooking workflow.',
        fast_fix: 'Use follow-up reminders and rebooking prompts after treatment.',
        impact: 'revenue',
      },
    );
  }

  if (industry === 'consultant') {
    revenueDrivers.push(
      {
        driver: 'Authority-based conversion',
        why: 'Consulting buyers need proof before booking a conversation.',
        lever: 'Package services clearly, show case studies, and capture briefs efficiently.',
        impact: 'revenue',
      },
      {
        driver: 'Utilization of billable time',
        why: 'Weak qualification burns hours on low-fit conversations.',
        lever: 'Use intake forms, qualification questions, and fixed offer packaging.',
        impact: 'cost',
      },
    );

    failurePatterns.push(
      {
        pattern: 'Website feels capable but not compelling',
        symptom: 'Visitors do not reach out despite relevant traffic.',
        root_cause: 'No concrete offer packaging or proof of results.',
        fast_fix: 'Add service packages, case studies, and one strong brief CTA.',
        impact: 'revenue',
      },
      {
        pattern: 'Too many low-fit leads',
        symptom: 'Discovery calls consume time without pipeline progress.',
        root_cause: 'No qualification before contact.',
        fast_fix: 'Use a structured brief form that filters for fit and urgency.',
        impact: 'cost',
      },
    );
  }

  if (industry === 'school') {
    revenueDrivers.push(
      {
        driver: 'Enrollment conversion',
        why: 'Interest only matters if it becomes applications and paid seats.',
        lever: 'Clear course catalog, schedule visibility, and enrollment CTA.',
        impact: 'revenue',
      },
      {
        driver: 'Retention and progression',
        why: 'Programs grow when students continue and recommend others.',
        lever: 'Show outcomes, instructors, and progression path clearly.',
        impact: 'revenue',
      },
    );

    failurePatterns.push(
      {
        pattern: 'Interest but weak enrollment',
        symptom: 'People read about courses but do not apply.',
        root_cause: 'Unclear curriculum, schedule, or transformation promise.',
        fast_fix: 'Clarify course outcomes, weekly structure, and next enrollment step.',
        impact: 'revenue',
      },
      {
        pattern: 'Courses feel fragmented',
        symptom: 'Visitors cannot see how courses fit together.',
        root_cause: 'No learning path or instructor credibility framing.',
        fast_fix: 'Present courses as a progression with instructor profiles and schedule.',
        impact: 'risk',
      },
    );
  }

  if (industry === 'restaurant') {
    revenueDrivers.push(
      {
        driver: 'High-margin seat fill',
        why: 'Your inventory is seats at specific times.',
        lever: 'Reservation flow + waitlist + cancellation backfill.',
        impact: 'revenue',
      },
      {
        driver: 'Turn-time efficiency',
        why: 'Small timing errors compound into empty tables.',
        lever: 'Turn-time rules + capacity rules + pacing.',
        impact: 'revenue',
      },
    );

    failurePatterns.push(
      {
        pattern: 'Phone-only reservations',
        symptom: 'Missed calls = lost revenue.',
        root_cause: 'Reservation is not self-serve.',
        fast_fix: 'Simple table booking + confirmation + cancellation link.',
        impact: 'revenue',
      },
      {
        pattern: 'Overbooking / underbooking',
        symptom: 'Empty tables or guest frustration.',
        root_cause: 'Capacity rules don’t reflect reality (table merges, turn-time).',
        fast_fix: 'Capacity + turn-time configuration per service window.',
        impact: 'risk',
      },
      {
        pattern: 'Menu confusion',
        symptom: 'Guests hesitate, low conversion on online traffic.',
        root_cause: 'Unclear menu and missing constraints (allergens/diet).',
        fast_fix: 'Digital menu with clear categories + allergen flags.',
        impact: 'revenue',
      },
    );
  }

  if (industry === 'gym') {
    revenueDrivers.push(
      {
        driver: 'Membership retention',
        why: 'LTV is retention; acquisition is secondary if churn leaks.',
        lever: 'Track attendance + onboarding + first-week habit.',
        impact: 'revenue',
      },
      {
        driver: 'Class capacity utilization',
        why: 'Empty spots are wasted inventory; overbooking creates churn.',
        lever: 'Class booking + waitlist + cancellation backfill.',
        impact: 'revenue',
      },
    );

    failurePatterns.push(
      {
        pattern: 'Interest doesn’t become trial',
        symptom: 'Lots of questions, few visits.',
        root_cause: 'No clear “first step” path (trial/intro).',
        fast_fix: 'Trial flow + schedule visibility + one CTA.',
        impact: 'revenue',
      },
      {
        pattern: 'Schedule is hard to read',
        symptom: 'No-shows, wrong class attendance, angry members.',
        root_cause: 'Schedule changes aren’t communicated clearly.',
        fast_fix: 'Single weekly calendar + notification on changes.',
        impact: 'risk',
      },
    );
  }

  if (industry === 'legal_firm') {
    revenueDrivers.push(
      {
        driver: 'Lead quality',
        why: 'Bad leads consume partner time without revenue.',
        lever: 'Intake + triage + scope clarity.',
        impact: 'cost',
      },
      {
        driver: 'Speed to first response',
        why: 'High-value clients choose the first competent responder.',
        lever: 'Routing + templates + appointment booking.',
        impact: 'revenue',
      },
    );

    failurePatterns.push(
      {
        pattern: 'Slow intake loop',
        symptom: 'Cases stall before they start.',
        root_cause: 'Docs and facts are collected too late.',
        fast_fix: 'Document intake upfront + triage by case type.',
        impact: 'cost',
      },
      {
        pattern: 'Unqualified calls',
        symptom: 'Consultations with low-fit clients.',
        root_cause: 'No pre-qualification and unclear scope.',
        fast_fix: 'Structured intake + eligibility questions + booking rules.',
        impact: 'cost',
      },
    );
  }

  const geoNotes = (() => {
    if (geoCountryCode === 'SE') {
      return ['Sweden: VAT context is common, and consumer payments often prefer Swish/Klarna.'];
    }
    if (geoCountryCode === 'TR') {
      return ['Turkey: card + cash are common; local payment processors vary by segment.'];
    }
    return [] as string[];
  })();

  const insights: Array<{ problem: string; why_it_matters: string; action: string; impact: 'revenue' | 'cost' | 'risk' }> = [];

  const goalSummary = brain?.state.primaryGoalSummary;
  if (goalSummary) {
    insights.push({
      problem: `Goal set: ${goalSummary}`,
      why_it_matters: 'A clear target lets you pick the one lever that matters right now.',
      action: 'Tell me the current baseline (today’s bookings/leads) so we can choose the fastest path to the target.',
      impact: 'revenue',
    });
  }

  return {
    projectId: args.projectId,
    industryProfile: {
      ...(brainIndustry ?? {}),
      normalizedIndustry: industry,
      confidence:
        (promptIndustry && promptIndustry.normalizedIndustry !== 'unknown' ? promptIndustry.confidence : null) ??
        (titleIndustry && titleIndustry.normalizedIndustry !== 'unknown' ? titleIndustry.confidence : null) ??
        brainIndustry?.confidence ??
        0.4,
      subIndustry:
        (promptIndustry && promptIndustry.normalizedIndustry !== 'unknown' ? promptIndustry.subIndustry : null) ??
        (titleIndustry && titleIndustry.normalizedIndustry !== 'unknown' ? titleIndustry.subIndustry : null) ??
        brainIndustry?.subIndustry ??
        null,
    },
    geoProfile,
    state: brain?.state ?? { primaryGoalSummary: null, currentSignals: {} },
    modules,
    expectedBusinessModel,
    revenueDrivers: localizedSignals?.revenueDrivers?.length ? localizedSignals.revenueDrivers : revenueDrivers,
    failurePatterns: localizedSignals?.failurePatterns?.length ? localizedSignals.failurePatterns : failurePatterns,
    geoNotes,
    insights,
  };
}
