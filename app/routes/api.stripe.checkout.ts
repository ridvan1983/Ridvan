import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { getOptionalServerEnv } from '~/lib/env.server';
import { PLANS, stripe } from '~/lib/stripe/config';
import { supabaseAdmin } from '~/lib/supabase/server';

const STRIPE_PRICE_ENV_BY_PLAN: Record<string, string> = {
  starter: 'STRIPE_PRICE_ID_STARTER',
  pro: 'STRIPE_PRICE_ID_PRO',
  business: 'STRIPE_PRICE_ID_BUSINESS',
};

function getStripePriceId(planId: string, envSource: unknown) {
  const envKey = STRIPE_PRICE_ENV_BY_PLAN[planId];
  if (!envKey) {
    return null;
  }

  return getOptionalServerEnv(envKey, envSource) ?? null;
}

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return Response.json(
      { error: '[RIDVAN-E401] Unauthorized: missing Bearer token' },
      {
        status: 401,
      },
    );
  }

  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    return Response.json(
      { error: `[RIDVAN-E401] Unauthorized: ${userError?.message ?? 'invalid token'}` },
      {
        status: 401,
      },
    );
  }

  try {
    const body = await request.json<{ planId?: string }>();
    const planId = body.planId;

    if (!planId) {
      return Response.json({ error: '[RIDVAN-E402] Invalid plan: missing planId' }, { status: 400 });
    }

    const plan = PLANS[planId as keyof typeof PLANS];

    if (!plan) {
      return Response.json({ error: '[RIDVAN-E402] Invalid plan' }, { status: 400 });
    }

    const stripePriceId = getStripePriceId(planId, context.cloudflare?.env);

    if (!stripePriceId) {
      return Response.json(
        { error: '[RIDVAN-E402] Missing Stripe price id for this plan (set STRIPE_PRICE_ID_* in env)' },
        { status: 500 },
      );
    }

    const origin = new URL(request.url).origin;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: stripePriceId, quantity: 1 }],
      success_url: `${origin}/chat?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/`,
      client_reference_id: user.id,
      customer_email: user.email,
      metadata: { userId: user.id, planId },
    });

    if (!session.url) {
      return Response.json({ error: '[RIDVAN-E403] Stripe error: missing checkout URL' }, { status: 500 });
    }

    return Response.json({ url: session.url });
  } catch (error: any) {
    return Response.json({ error: `[RIDVAN-E403] Stripe error: ${error?.message ?? 'unknown error'}` }, { status: 500 });
  }
}
