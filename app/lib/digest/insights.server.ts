import { readBrainContext } from '~/lib/brain/read.server';
import { getVerticalContext } from '~/lib/vertical/context.server';
import { buildOpportunityContext } from '~/lib/opportunity/context.server';
import { supabaseAdmin } from '~/lib/supabase/server';

export type DigestInsight = {
  title: string;
  why_now: string;
  next_action: string;
  impact: 'increase_revenue' | 'reduce_costs' | 'reduce_risk';
};

export type WeeklyDigest = {
  lang: 'sv' | 'tr' | 'en';
  subject: string;
  happened: string;
  keyInsight: { title: string; whyNow: string };
  action: string;
  healthLine: string;
};

function pickLanguage(languageCodes: string[]) {
  const first = (languageCodes[0] ?? '').toLowerCase();
  if (first.startsWith('sv')) return 'sv';
  if (first.startsWith('tr')) return 'tr';
  return 'en';
}

function passesFilter(i: DigestInsight) {
  const hasCompanySpecific = i.title.length > 0;
  const hasAction = i.next_action.trim().length > 10;
  const hasWhyNow = i.why_now.trim().length > 10;
  return hasCompanySpecific && hasAction && hasWhyNow;
}

function subjectFor(args: { lang: WeeklyDigest['lang']; firstName: string; key: string }) {
  if (args.lang === 'sv') {
    return `Din vecka, ${args.firstName}: ${args.key}`;
  }
  if (args.lang === 'tr') {
    return `Haftan, ${args.firstName}: ${args.key}`;
  }
  return `Your week, ${args.firstName}: ${args.key}`;
}

function clampWords(text: string, maxWords: number) {
  const words = text.trim().split(/\s+/g);
  if (words.length <= maxWords) {
    return text.trim();
  }
  return words.slice(0, maxWords).join(' ').trim();
}

function startOfLastWeekUtc(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - 7);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function computeHealthLine(args: { lang: WeeklyDigest['lang']; statuses: Array<'green' | 'yellow' | 'red'> }) {
  const worst = args.statuses.includes('red') ? 'red' : args.statuses.includes('yellow') ? 'yellow' : args.statuses.includes('green') ? 'green' : 'yellow';
  if (args.lang === 'sv') {
    return worst === 'green' ? 'Bolaget mår: 🟢 Bra' : worst === 'red' ? 'Bolaget mår: 🔴 Kräver uppmärksamhet' : 'Bolaget mår: 🟡 Okej';
  }
  if (args.lang === 'tr') {
    return worst === 'green' ? 'Şirket durumu: 🟢 İyi' : worst === 'red' ? 'Şirket durumu: 🔴 Dikkat gerekiyor' : 'Şirket durumu: 🟡 İdare eder';
  }
  return worst === 'green' ? 'Company health: 🟢 Good' : worst === 'red' ? 'Company health: 🔴 Needs attention' : 'Company health: 🟡 Okay';
}

export async function buildWeeklyDigestInsights(args: { projectId: string; userId: string }) {
  const brain = await readBrainContext({ projectId: args.projectId, userId: args.userId });
  if (!brain) return null;

  const vertical = await getVerticalContext({ projectId: args.projectId, userId: args.userId });
  const opportunity = await buildOpportunityContext({ projectId: args.projectId, userId: args.userId });

  const geoLangs = brain.geoProfile?.languageCodes ?? [];
  const lang = pickLanguage(geoLangs) as WeeklyDigest['lang'];
  const industry = brain.industryProfile?.normalizedIndustry ?? (vertical as any)?.industryProfile?.normalizedIndustry ?? 'unknown';

  const insights: DigestInsight[] = [];

  // Insight 1: top opportunity
  const topOpp = (opportunity?.opportunities ?? [])[0] as any;
  if (topOpp) {
    const impact: DigestInsight['impact'] = topOpp?.type === 'risk' ? 'reduce_risk' : topOpp?.type === 'growth' ? 'increase_revenue' : 'increase_revenue';
    insights.push({
      title:
        lang === 'sv'
          ? 'Snabbaste vinsten just nu'
          : lang === 'tr'
            ? 'Şu an en hızlı kazanım'
            : 'Fastest win right now',
      why_now:
        typeof topOpp?.why_now === 'string'
          ? topOpp.why_now
          : lang === 'sv'
            ? 'Det här påverkar konvertering/intäkt direkt den här veckan.'
            : lang === 'tr'
              ? 'Bu hafta dönüşümü ve geliri doğrudan etkiler.'
              : 'This directly affects conversion and revenue this week.',
      next_action:
        typeof topOpp?.reasoning === 'string'
          ? topOpp.reasoning
          : lang === 'sv'
            ? 'Välj en modul eller åtgärd som tar bort friktion i huvudflödet.'
            : lang === 'tr'
              ? 'Ana akıştaki sürtünmeyi azaltan tek bir aksiyon seç.'
              : 'Pick one action that removes friction in the primary flow.',
      impact,
    });
  }

  // Insight 2: signals sanity
  const published = brain.state.publishedStatus;
  if (published !== 'published') {
    insights.push({
      title: lang === 'sv' ? 'Säkerställ att du verkligen är live' : lang === 'tr' ? 'Gerçekten yayında mısın?' : 'Make sure you are actually live',
      why_now:
        lang === 'sv'
          ? 'Utan en stabil live-version kan du inte lita på trafik- eller bokningsdata.'
          : lang === 'tr'
            ? 'Stabil bir canlı sürüm olmadan trafik ve rezervasyon verisine güvenemezsin.'
            : 'Without a stable live version, you can’t trust traffic or conversion signals.',
      next_action:
        lang === 'sv'
          ? 'Öppna preview och testa: (1) primär CTA fungerar, (2) kontaktflöde fungerar, (3) mobilvy ser bra ut.'
          : lang === 'tr'
            ? 'Preview’de test et: (1) ana CTA çalışıyor, (2) iletişim akışı çalışıyor, (3) mobil görünüm iyi.'
            : 'Test in preview: (1) primary CTA works, (2) contact flow works, (3) mobile view looks good.',
      impact: 'reduce_risk',
    });
  }

  // Insight 3: vertical driver reminder
  const driver = (vertical as any)?.revenueDrivers?.[0];
  if (driver && typeof driver === 'object') {
    insights.push({
      title: lang === 'sv' ? 'Fokusera på den största intäktsdrivaren' : lang === 'tr' ? 'En büyük gelir kaldıraçına odaklan' : 'Focus on the biggest revenue driver',
      why_now:
        lang === 'sv'
          ? 'Små förbättringar i rätt del av flödet ger effekt direkt.'
          : lang === 'tr'
            ? 'Doğru noktadaki küçük iyileştirmeler hızlı sonuç verir.'
            : 'Small improvements in the right part of the flow compound quickly.',
      next_action:
        typeof (driver as any)?.lever === 'string'
          ? String((driver as any).lever)
          : lang === 'sv'
            ? 'Gör primär handling extremt tydlig på första skärmen.'
            : lang === 'tr'
              ? 'İlk ekranda ana aksiyonu çok net yap.'
              : 'Make the primary action obvious on the first screen.',
      impact: 'increase_revenue',
    });
  }

  const filtered = insights.filter(passesFilter);
  const top = filtered[0] ?? null;
  if (!top) {
    return null;
  }

  const since = startOfLastWeekUtc();

  const workspaceId = brain.state.workspaceId;

  const [{ data: events }, { data: milestoneRows }, { data: healthRows }] = await Promise.all([
    supabaseAdmin
      .from('brain_events')
      .select('source, type, occurred_at')
      .eq('project_id', args.projectId)
      .eq('user_id', args.userId)
      .gte('occurred_at', since.toISOString())
      .order('occurred_at', { ascending: false })
      .limit(200),
    supabaseAdmin
      .from('brain_memory_entries')
      .select('kind, title, created_at')
      .eq('workspace_id', workspaceId)
      .eq('kind', 'milestone')
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(20),
    supabaseAdmin
      .from('mentor_health_metrics')
      .select('metric, status, recorded_at')
      .eq('project_id', args.projectId)
      .eq('user_id', args.userId)
      .gte('recorded_at', since.toISOString())
      .order('recorded_at', { ascending: false })
      .limit(50),
  ]);

  const builderCount = (events ?? []).filter((e: any) => e?.source === 'builder').length;
  const mentorCount = (events ?? []).filter((e: any) => e?.source === 'mentor').length;
  const milestoneTitles = (milestoneRows ?? []).map((m: any) => (typeof m?.title === 'string' ? m.title : null)).filter(Boolean) as string[];

  const happened =
    lang === 'sv'
      ? clampWords(
          `Förra veckan: ${builderCount > 0 ? `${builderCount} bygg-händelser` : 'inga bygg-händelser'}, ${mentorCount > 0 ? `${mentorCount} Mentor-händelser` : 'ingen Mentor-aktivitet'}${milestoneTitles.length > 0 ? `, milstolpar: ${milestoneTitles.slice(0, 2).join(' + ')}` : ''}.`,
          55,
        )
      : lang === 'tr'
        ? clampWords(
            `Geçen hafta: ${builderCount > 0 ? `${builderCount} build olayı` : 'build yok'}, ${mentorCount > 0 ? `${mentorCount} Mentor olayı` : 'Mentor aktivitesi yok'}${milestoneTitles.length > 0 ? `, kilometre taşları: ${milestoneTitles.slice(0, 2).join(' + ')}` : ''}.`,
            55,
          )
        : clampWords(
            `Last week: ${builderCount > 0 ? `${builderCount} build events` : 'no build events'}, ${mentorCount > 0 ? `${mentorCount} Mentor events` : 'no Mentor activity'}${milestoneTitles.length > 0 ? `, milestones: ${milestoneTitles.slice(0, 2).join(' + ')}` : ''}.`,
            55,
          );

  const healthStatuses = Array.from(
    new Set((healthRows ?? []).map((r: any) => (r?.status === 'green' || r?.status === 'yellow' || r?.status === 'red' ? r.status : null)).filter(Boolean)),
  ) as Array<'green' | 'yellow' | 'red'>;

  const healthLine = computeHealthLine({ lang, statuses: healthStatuses });

  const key = lang === 'sv' ? top.title : lang === 'tr' ? top.title : top.title;
  const subject = subjectFor({ lang, firstName: 'du', key });

  const action = clampWords(top.next_action, 55);
  const whyNow = clampWords(top.why_now, 55);

  const digest: WeeklyDigest = {
    lang,
    subject,
    happened,
    keyInsight: { title: top.title, whyNow },
    action,
    healthLine,
  };

  return digest;
}
