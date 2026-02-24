import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { PLANS, stripe } from '~/lib/stripe/config';
import { supabaseAdmin } from '~/lib/supabase/server';

export async function action({ request }: ActionFunctionArgs) {
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

    const plan = PLANS[planId as keyof typeof PLANS] as (typeof PLANS)[keyof typeof PLANS] & {
      stripePriceId?: string;
    };

    if (!plan?.stripePriceId) {
      return Response.json({ error: '[RIDVAN-E402] Invalid plan' }, { status: 400 });
    }

    const origin = new URL(request.url).origin;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
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
