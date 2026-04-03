import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { getTopupPackById, type TopupPackId } from '~/config/topup-packs';
import { stripe } from '~/lib/stripe/config';
import { resolveTopupStripePriceId } from '~/lib/stripe/topup-packs.server';
import { supabaseAdmin } from '~/lib/supabase/server';

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return Response.json({ error: '[RIDVAN-E401] Unauthorized: missing Bearer token' }, { status: 401 });
  }

  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    return Response.json(
      { error: `[RIDVAN-E401] Unauthorized: ${userError?.message ?? 'invalid token'}` },
      { status: 401 },
    );
  }

  try {
    const body = await request.json<{ packId?: string }>();
    const packId = body.packId as TopupPackId | undefined;

    if (!packId || !getTopupPackById(packId)) {
      return Response.json({ error: '[RIDVAN-E1240] Invalid or missing packId' }, { status: 400 });
    }

    const stripePriceId = resolveTopupStripePriceId(packId, context.cloudflare?.env);

    if (!stripePriceId) {
      return Response.json(
        { error: `[RIDVAN-E1241] Missing Stripe price id for this pack (set env for ${getTopupPackById(packId)?.envKey})` },
        { status: 500 },
      );
    }

    const origin = new URL(request.url).origin;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: stripePriceId, quantity: 1 }],
      success_url: `${origin}/chat?topup_session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/chat`,
      client_reference_id: user.id,
      customer_email: user.email ?? undefined,
      metadata: {
        userId: user.id,
        kind: 'topup',
        packId,
      },
    });

    if (!session.url) {
      return Response.json({ error: '[RIDVAN-E1242] Stripe error: missing checkout URL' }, { status: 500 });
    }

    return Response.json({ url: session.url });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return Response.json({ error: `[RIDVAN-E1243] Stripe error: ${message}` }, { status: 500 });
  }
}
