import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { readBrainContext } from '~/lib/brain/read.server';
import { pickUpsellModuleForIndustry } from '~/lib/vertical/module-catalog.server';
import { priceForCountrySEK } from '~/lib/vertical/geo-adapter.server';

function pickLanguage(languageCodes: string[]) {
  const first = (languageCodes[0] ?? '').toLowerCase();
  if (first.startsWith('sv')) return 'sv';
  if (first.startsWith('tr')) return 'tr';
  return 'en';
}

function t(lang: string) {
  if (lang === 'sv') {
    return { title: 'Förslag', cta: 'Lägg till →', dismiss: 'Inte nu', perMonth: '/månad' };
  }
  if (lang === 'tr') {
    return { title: 'Öneri', cta: 'Ekle →', dismiss: 'Şimdi değil', perMonth: '/ay' };
  }
  return { title: 'Suggested next step', cta: 'Add it →', dismiss: 'Not now', perMonth: '/month' };
}

function localizeModuleCopy(lang: string, module: any) {
  const key = typeof module?.module_key === 'string' ? module.module_key : '';

  if (lang === 'sv') {
    if (key === 'booking_system') {
      return {
        roi_stat: 'Salonger med onlinebokning får ofta 20–40% fler bokningar från samma trafik.',
        description: 'Onlinebokning med tjänster, personal, tider och bekräftelse.',
      };
    }
    if (key === 'table_booking') {
      return {
        roi_stat: 'Självbetjäning för bordsbokning minskar missade samtal och förbättrar beläggning.',
        description: 'Bordsbokning med bekräftelse och enkel adminvy.',
      };
    }
    if (key === 'class_booking') {
      return {
        roi_stat: 'Gym som låter medlemmar boka klasser online ser ofta jämnare närvaro.',
        description: 'Klasschema + bokning med bekräftelse och adminvy.',
      };
    }
    if (key === 'appointment_booking') {
      return {
        roi_stat: 'Tydligare intake + snabbare svar ökar ofta andelen leads som bokar konsultation.',
        description: 'Tidsbokning + intake-frågor med adminvy för förfrågningar.',
      };
    }
  }

  if (lang === 'tr') {
    if (key === 'booking_system') {
      return {
        roi_stat: 'Online randevu alan salonlar genelde aynı trafikten %20–40 daha fazla randevu alır.',
        description: 'Hizmetler, personel, saat seçimi ve onay ile online randevu.',
      };
    }
    if (key === 'table_booking') {
      return {
        roi_stat: 'Kendi kendine masa rezervasyonu, kaçan aramaları azaltır ve doluluğu artırır.',
        description: 'Masa rezervasyonu + onay + basit admin ekranı.',
      };
    }
    if (key === 'class_booking') {
      return {
        roi_stat: 'Online ders rezervasyonu, katılımı daha istikrarlı hale getirir.',
        description: 'Ders programı + rezervasyon + admin ekranı.',
      };
    }
    if (key === 'appointment_booking') {
      return {
        roi_stat: 'Daha net intake ve hızlı dönüş, danışmanlık dönüşümünü artırır.',
        description: 'Randevu + intake formu + admin ekranı.',
      };
    }
  }

  return null;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const projectId = params.projectId;
  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E1031] Missing projectId' }, { status: 400 });
  }

  const { user } = await requireUserFromBearerToken(request);
  const brain = await readBrainContext({ projectId, userId: user.id });

  if (!brain) {
    return Response.json({ error: '[RIDVAN-E1032] Brain state not found' }, { status: 404 });
  }

  const industry = brain.industryProfile?.normalizedIndustry ?? null;
  const module = pickUpsellModuleForIndustry(industry);

  const countryCode = brain.geoProfile?.countryCode ?? null;
  const languageCodes = brain.geoProfile?.languageCodes ?? [];
  const lang = pickLanguage(languageCodes);
  const strings = t(lang);

  if (!module) {
    return Response.json({ ok: true, module: null });
  }

  const localPrice = priceForCountrySEK(module.price_monthly, countryCode);

  const copyOverride = localizeModuleCopy(lang, module);
  const moduleWithCopy = copyOverride ? { ...module, ...copyOverride } : module;

  const activationPrompt = `${String(moduleWithCopy.activation_prompt_template ?? '').trim()}\n\nLanguage requirements:\n- Use language: ${lang}\n- Never mix languages in the same response.\n- Keep currency/formatting consistent with ${localPrice.currency}.`;

  return Response.json({
    ok: true,
    projectId,
    business_profile: {
      industry: {
        normalized: brain.industryProfile?.normalizedIndustry ?? 'unknown',
        sub: brain.industryProfile?.subIndustry ?? null,
        confidence: brain.industryProfile?.confidence ?? 0,
      },
      geo: {
        countryCode: brain.geoProfile?.countryCode ?? null,
        city: brain.geoProfile?.city ?? null,
        currencyCode: brain.geoProfile?.currencyCode ?? null,
        taxModel: brain.geoProfile?.taxModel ?? 'unknown',
        languageCodes: brain.geoProfile?.languageCodes ?? [],
      },
    },
    module: {
      ...moduleWithCopy,
      activation_prompt_template: activationPrompt,
    },
    local_pricing: {
      amount: localPrice.amount,
      currency: localPrice.currency,
    },
    ui: strings,
  });
}
