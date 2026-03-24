type ProactivityCheck = {
  ok: boolean;
  reasons: string[];
};

function hasCompanySpecificAnchor(text: string) {
  const lower = text.toLowerCase();
  return (
    lower.includes('your') ||
    lower.includes('din') ||
    lower.includes('ditt') ||
    lower.includes('ert') ||
    lower.includes('ni') ||
    lower.includes('sizin') ||
    lower.includes('senin') ||
    lower.includes('işiniz')
  );
}

function hasNextAction(text: string) {
  const lower = text.toLowerCase();
  return (
    lower.includes('next') ||
    lower.includes('do this') ||
    lower.includes('step') ||
    lower.includes('today') ||
    lower.includes('this week') ||
    lower.includes('gör') ||
    lower.includes('gör så här') ||
    lower.includes('nästa steg') ||
    lower.includes('idag') ||
    lower.includes('den här veckan') ||
    lower.includes('şunu') ||
    lower.includes('adım') ||
    lower.includes('bugün') ||
    lower.includes('bu hafta')
  );
}

function hasWhyNow(text: string) {
  const lower = text.toLowerCase();
  return (
    lower.includes('because') ||
    lower.includes('why now') ||
    lower.includes('right now') ||
    lower.includes('nu') ||
    lower.includes('just nu') ||
    lower.includes('därför') ||
    lower.includes('şimdi') ||
    lower.includes('bu yüzden')
  );
}

export function validateMentorReply(reply: string): ProactivityCheck {
  const reasons: string[] = [];
  const text = reply.trim();

  if (text.length < 40) {
    reasons.push('too_short');
  }

  if (!hasCompanySpecificAnchor(text)) {
    reasons.push('not_company_specific');
  }

  if (!hasNextAction(text)) {
    reasons.push('missing_next_action');
  }

  if (!hasWhyNow(text)) {
    reasons.push('missing_why_now');
  }

  return { ok: reasons.length === 0, reasons };
}

export function makeClarifyingQuestion(lang: 'sv' | 'tr' | 'en', message: string) {
  if (lang === 'sv') {
    return 'För att kunna ge en riktigt specifik rekommendation: vad är din viktigaste siffra just nu (t.ex. bokningar/vecka, leads/vecka eller omsättning/mån) och vad är den idag?';
  }
  if (lang === 'tr') {
    return 'Daha net ve spesifik öneri verebilmem için: şu an en önemli metriğin nedir (örn. haftalık randevu, haftalık lead veya aylık ciro) ve bugünkü değer kaç?';
  }
  return 'To make this specific to your company: what is the single most important metric right now (e.g. bookings/week, leads/week, revenue/month) and what is it today?';
}
