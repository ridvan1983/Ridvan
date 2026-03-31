import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { checkCredits } from '~/lib/credits/check';
import type { MentorAttachmentReference } from '~/lib/mentor/file-analysis.server';
import { checkRateLimit, mentorRateLimit } from '~/lib/security/distributed-rate-limit.server';
import { captureError } from '~/lib/server/monitoring.server';
import { supabaseAdmin } from '~/lib/supabase/server';

type SubscriptionRow = {
  plan: string | null;
};

export type MentorAccessGrant = {
  user: { id: string };
  projectId: string;
  message: string;
  sessionId: string;
  systemInstruction: string;
  attachments: MentorAttachmentReference[];
};

export function noCreditsResponse() {
  return Response.json(
    {
      error: 'RIDVAN_NO_CREDITS',
      message: 'Du har inga krediter kvar. Uppgradera till PRO för obegränsad access.',
    },
    { status: 403 },
  );
}

function monthStartUtcIso(d = new Date()) {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
  return start.toISOString();
}

function isProPlan(plan: string | null) {
  const p = (plan ?? 'free').toLowerCase();
  return p === 'pro' || p === 'business' || p === 'agency' || p === 'enterprise';
}

export async function requireMentorAccess(args: {
  request: Request;
  context: ActionFunctionArgs['context'];
}): Promise<{ ok: true; value: MentorAccessGrant } | { ok: false; response: Response }> {
  const { request, context } = args;
  const { user } = await requireUserFromBearerToken(request);

  const body = (await request.json().catch(() => null)) as
    | {
        projectId?: string;
        message?: string;
        sessionId?: string;
        attachments?: MentorAttachmentReference[];
        systemInstruction?: string;
      }
    | null;

  const projectId = body?.projectId;
  const message = body?.message?.trim();
  const sessionId = typeof body?.sessionId === 'string' && body.sessionId.trim().length > 0 ? body.sessionId.trim() : null;
  const systemInstruction = typeof body?.systemInstruction === 'string' ? body.systemInstruction.trim() : '';
  const attachments = Array.isArray(body?.attachments) ? body.attachments.filter(Boolean) : [];

  if (!projectId || !message || !sessionId) {
    return {
      ok: false,
      response: Response.json({ error: '[RIDVAN-E851] Missing projectId or message' }, { status: 400 }),
    };
  }

  const { success: mentorRateLimitSuccess, reset: mentorRateLimitReset } = await checkRateLimit(
    mentorRateLimit,
    user.id,
    context.cloudflare.env,
  );

  if (!mentorRateLimitSuccess) {
    return {
      ok: false,
      response: Response.json(
        { error: 'Too many requests. Please wait before trying again.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil((mentorRateLimitReset - Date.now()) / 1000)) },
        },
      ),
    };
  }

  try {
    const monthStart = monthStartUtcIso();

    const { data: subRow } = await supabaseAdmin
      .from('subscriptions')
      .select('plan')
      .eq('user_id', user.id)
      .maybeSingle<SubscriptionRow>();

    const plan = subRow?.plan ?? 'free';
    const isPro = isProPlan(plan);

    if (!isPro) {
      const { data: sessionRows } = await supabaseAdmin
        .from('mentor_messages')
        .select('session_id')
        .eq('user_id', user.id)
        .gte('created_at', monthStart)
        .not('session_id', 'is', null)
        .limit(500)
        .returns<Array<{ session_id: string | null }>>();

      const distinctSessionIds = Array.from(new Set((sessionRows ?? []).map((r) => r.session_id).filter((value): value is string => Boolean(value))));
      const alreadyInThisSession = distinctSessionIds.includes(sessionId);

      if (!alreadyInThisSession && distinctSessionIds.length >= 3) {
        return {
          ok: false,
          response: Response.json(
            {
              reply: 'Du har använt dina 3 gratis Mentor-samtal denna månad. Uppgradera till Pro för obegränsad tillgång.',
              events: [],
              eventsWritten: 0,
            },
            { status: 403 },
          ),
        };
      }
    }
  } catch (error) {
    captureError(error, {
      route: 'api.mentor',
      userId: user.id,
      extra: { stage: 'mentor_gating', projectId, sessionId },
    });
    console.error('[RIDVAN-E858] Mentor gating failed (non-blocking)', error);
  }

  const creditState = await checkCredits(user.id);
  if (!creditState.allowed) {
    return { ok: false, response: noCreditsResponse() };
  }

  return {
    ok: true,
    value: {
      user: { id: user.id },
      projectId,
      message,
      sessionId,
      systemInstruction,
      attachments,
    },
  };
}
