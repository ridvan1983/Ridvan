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
      const digest = await buildWeeklyDigestInsights({ projectId: project.id, userId, env: context.cloudflare?.env });
      if (!digest) {
        continue;
      }

      const lang = digest.lang;
      const subject = digest.subject;
      const statusLabel = lang === 'sv' ? 'LÄGET' : lang === 'tr' ? 'DURUM' : 'STATUS';
      const workedLabel = lang === 'sv' ? 'VAD SOM FUNKADE' : lang === 'tr' ? 'NEYİN İŞE YARADIĞI' : 'WHAT WORKED';
      const didNotWorkLabel = lang === 'sv' ? 'VAD SOM INTE FUNKADE' : lang === 'tr' ? 'NEYİN İŞE YARAMADIĞI' : 'WHAT DID NOT WORK';
      const oneThingLabel = lang === 'sv' ? 'EN SAK DENNA VECKA' : lang === 'tr' ? 'BU HAFTA TEK ŞEY' : 'ONE THING THIS WEEK';
      const cofounderLabel = lang === 'sv' ? 'DIN CO-FOUNDER SÄGER' : lang === 'tr' ? 'KURUCU ORTAĞIN ŞUNU SÖYLÜYOR' : 'YOUR CO-FOUNDER SAYS';
      const buttonLabel = lang === 'sv' ? 'Prata med Mentor →' : lang === 'tr' ? 'Mentor ile konuş →' : 'Talk to Mentor →';
      const footer = lang === 'sv' ? 'Svara på det här mejlet så svarar Mentor direkt.' : lang === 'tr' ? 'Bu e-postaya yanıt ver — Mentor direkt yanıtlar.' : 'Reply to this email and Mentor will answer directly.';
      const origin = new URL(request.url).origin;
      const mentorUrl = `${origin}/mentor`;

      const html = `
        <div style="font-family: Inter, ui-sans-serif, system-ui, -apple-system; line-height: 1.6; color: #111827; background: #f8fafc; padding: 24px;">
          <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 20px; overflow: hidden;">
            <div style="padding: 28px 28px 20px; background: linear-gradient(135deg, #111827 0%, #312e81 100%); color: white;">
              <div style="font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.8;">Ridvan Weekly Digest</div>
              <div style="margin-top: 10px; font-size: 26px; line-height: 1.25; font-weight: 700;">${escapeHtml(subject)}</div>
            </div>
            <div style="padding: 28px;">
              <div style="margin: 0 0 18px; font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #6b7280;">${escapeHtml(statusLabel)}</div>
              <p style="margin: 0 0 22px; font-size: 16px; color: #111827;">${escapeHtml(digest.statusLine)}</p>

              <div style="margin: 0 0 18px; font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #6b7280;">${escapeHtml(workedLabel)}</div>
              <p style="margin: 0 0 22px; font-size: 16px; color: #111827;">${escapeHtml(digest.whatWorked)}</p>

              <div style="margin: 0 0 18px; font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #6b7280;">${escapeHtml(didNotWorkLabel)}</div>
              <p style="margin: 0 0 22px; font-size: 16px; color: #111827;">${escapeHtml(digest.whatDidNotWork)}</p>

              <div style="margin: 0 0 18px; font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #6b7280;">${escapeHtml(oneThingLabel)}</div>
              <div style="margin: 0 0 22px; padding: 18px 20px; border-radius: 16px; background: #f3f4f6; color: #111827; font-size: 16px; font-weight: 600;">${escapeHtml(digest.oneThingThisWeek)}</div>

              <div style="margin: 0 0 18px; font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #6b7280;">${escapeHtml(cofounderLabel)}</div>
              <p style="margin: 0 0 26px; font-size: 16px; color: #111827;">${escapeHtml(digest.cofounderSays)}</p>

              <a href="${escapeHtml(mentorUrl)}" style="display: inline-block; padding: 14px 20px; border-radius: 999px; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: #ffffff; text-decoration: none; font-weight: 700;">${escapeHtml(buttonLabel)}</a>

              <p style="margin: 22px 0 0; font-size: 12px; color: #6b7280;">${escapeHtml(footer)}</p>
            </div>
          </div>
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
