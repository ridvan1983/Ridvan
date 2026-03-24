import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { supabaseAdmin } from '~/lib/supabase/server';
import { sendResendEmail } from '~/lib/digest/resend.server';
import { buildWeeklyDigestInsights } from '~/lib/digest/insights.server';

const FROM = 'Ridvan <digest@ridvan.ai>';

function firstNameFromAuthUser(authUser: any) {
  const meta = authUser?.user?.user_metadata;
  const fullName = typeof meta?.full_name === 'string' ? meta.full_name : typeof meta?.name === 'string' ? meta.name : null;
  if (fullName && fullName.trim().length > 0) {
    return fullName.trim().split(/\s+/g)[0];
  }
  const email = typeof authUser?.user?.email === 'string' ? authUser.user.email : null;
  if (email && email.includes('@')) {
    return email.split('@')[0].slice(0, 24);
  }
  return 'vän';
}

function escapeHtml(text: string) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function requireCronSecret(request: Request) {
  const expected = (process as any)?.env?.DIGEST_CRON_SECRET ?? null;
  const provided = request.headers.get('x-digest-secret');
  if (!expected) {
    // Allow local/dev testing without a secret.
    return;
  }
  if (!provided || provided !== expected) {
    throw new Response(JSON.stringify({ error: '[RIDVAN-E1111] Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
}

type PrefRow = {
  user_id: string;
  email_digest_enabled: boolean;
  last_digest_sent_at: string | null;
};

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  requireCronSecret(request);

  // Find users with at least one project.
  const { data: users, error: usersError } = await supabaseAdmin
    .from('projects')
    .select('user_id')
    .limit(5000);

  if (usersError) {
    return Response.json({ error: `[RIDVAN-E1112] Failed to list users: ${usersError.message}` }, { status: 500 });
  }

  const userIds = Array.from(new Set((users ?? []).map((r: any) => r.user_id).filter((x: any) => typeof x === 'string')));
  if (userIds.length === 0) {
    return Response.json({ ok: true, sent: 0 });
  }

  // Load prefs (missing row => default enabled).
  const { data: prefsRows, error: prefsError } = await supabaseAdmin
    .from('user_notification_prefs')
    .select('user_id, email_digest_enabled, last_digest_sent_at')
    .in('user_id', userIds)
    .returns<PrefRow[]>();

  if (prefsError) {
    return Response.json({ error: `[RIDVAN-E1113] Failed to load notification prefs: ${prefsError.message}` }, { status: 500 });
  }

  const prefsByUser = new Map<string, PrefRow>();
  for (const row of prefsRows ?? []) {
    prefsByUser.set(row.user_id, row);
  }

  let sent = 0;
  const errors: Array<{ userId: string; error: string }> = [];

  for (const userId of userIds) {
    const pref = prefsByUser.get(userId);
    const enabled = pref ? Boolean(pref.email_digest_enabled) : true;
    if (!enabled) {
      continue;
    }

    // Pick latest project for this user for now (MVP).
    const { data: project, error: projError } = await supabaseAdmin
      .from('projects')
      .select('id, title, user_id, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; title: string | null; user_id: string; updated_at: string }>();

    if (projError || !project) {
      continue;
    }

    // Resolve email from auth users via admin API.
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = authError ? null : authUser?.user?.email ?? null;
    if (!email) {
      continue;
    }

    const firstName = firstNameFromAuthUser(authUser);

    try {
      const digest = await buildWeeklyDigestInsights({ projectId: project.id, userId });
      if (!digest) {
        continue;
      }

      const lang = (digest as any).lang as 'sv' | 'tr' | 'en';
      const subject =
        typeof (digest as any).subject === 'string'
          ? String((digest as any).subject).replace('Din vecka, du:', `Din vecka, ${firstName}:`).replace('Haftan, du:', `Haftan, ${firstName}:`).replace('Your week, du:', `Your week, ${firstName}:`)
          : lang === 'sv'
            ? `Din vecka, ${firstName}`
            : lang === 'tr'
              ? `Haftan, ${firstName}`
              : `Your week, ${firstName}`;

      const happened = String((digest as any).happened ?? '').trim();
      const keyTitle = String((digest as any).keyInsight?.title ?? '').trim();
      const keyWhy = String((digest as any).keyInsight?.whyNow ?? '').trim();
      const action = String((digest as any).action ?? '').trim();
      const healthLine = String((digest as any).healthLine ?? '').trim();

      const footer = lang === 'sv' ? 'Svara på det här mejlet så svarar Mentor direkt.' : lang === 'tr' ? 'Bu e-postaya yanıt ver — Mentor direkt yanıtlar.' : 'Reply to this email and Mentor will answer directly.';

      const html = `
        <div style="font-family: ui-sans-serif, system-ui, -apple-system; line-height: 1.5; color: #111;">
          <p style="margin: 0 0 10px;"><b>${escapeHtml(subject)}</b></p>
          <p style="margin: 0 0 10px;">${escapeHtml(happened)}</p>
          <p style="margin: 0 0 6px;"><b>${escapeHtml(keyTitle)}</b></p>
          <p style="margin: 0 0 10px;">${escapeHtml(keyWhy)}</p>
          <p style="margin: 0 0 10px;"><b>${lang === 'sv' ? 'Rekommenderad action:' : lang === 'tr' ? 'Önerilen aksiyon:' : 'Recommended action:'}</b> ${escapeHtml(action)}</p>
          <p style="margin: 0 0 10px;">${escapeHtml(healthLine)}</p>
          <p style="margin: 12px 0 0; font-size: 12px; color: #555;">${escapeHtml(footer)}</p>
        </div>
      `;

      await sendResendEmail(context.cloudflare?.env, { from: FROM, to: email, subject, html });

      // Upsert prefs row.
      const { error: upsertError } = await supabaseAdmin
        .from('user_notification_prefs')
        .upsert({ user_id: userId, email_digest_enabled: true, last_digest_sent_at: new Date().toISOString() }, { onConflict: 'user_id' });

      if (upsertError) {
        // not fatal
        console.error('[RIDVAN-E1114] Failed to update last_digest_sent_at', upsertError);
      }

      sent++;
    } catch (e) {
      errors.push({ userId, error: e instanceof Error ? e.message : String(e ?? 'unknown') });
    }
  }

  return Response.json({ ok: true, sent, errors: errors.slice(0, 20) });
}
