import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getUserCreditHistory } from '~/lib/credits/ledger.server';
import { supabaseAdmin } from '~/lib/supabase/server';

type SubscriptionRow = {
  user_id: string;
  plan: string | null;
  status: string | null;
  monthly_credits: number | null;
  daily_credits: number | null;
  stripe_subscription_id: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type ProjectRow = {
  id: string;
  user_id: string;
  title: string | null;
  preview_url: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type AdminUser = {
  id: string;
  email: string | null;
  created_at: string | null;
};

function requireAdminSecret(request: Request, adminSecret: string | undefined) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!adminSecret || !token || token !== adminSecret) {
    throw Response.json({ error: '[RIDVAN-E1222] Unauthorized' }, { status: 401 });
  }
}

async function listAdminUsers() {
  const response = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const users = (response.data?.users ?? []).map((user) => ({
    id: user.id,
    email: user.email ?? null,
    created_at: user.created_at ?? null,
  })) as AdminUser[];

  return users;
}

async function listSubscriptions() {
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('user_id, plan, status, monthly_credits, daily_credits, stripe_subscription_id, updated_at, created_at')
    .returns<SubscriptionRow[]>();

  if (error) {
    throw new Error(`[RIDVAN-E1226] Failed to load subscriptions: ${error.message}`);
  }

  return data ?? [];
}

async function listProjectsForUser(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, user_id, title, preview_url, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .returns<ProjectRow[]>();

  if (error) {
    throw new Error(`[RIDVAN-E1227] Failed to load projects: ${error.message}`);
  }

  return data ?? [];
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const cloudflareEnv = (context.cloudflare?.env ?? undefined) as unknown as Record<string, string | undefined> | undefined;
  const adminSecret = cloudflareEnv?.ADMIN_SECRET ?? process.env.ADMIN_SECRET;
  requireAdminSecret(request, adminSecret);

  const url = new URL(request.url);
  const view = url.searchParams.get('view') ?? 'users';
  const userId = url.searchParams.get('userId');

  if (view === 'users') {
    const [users, subscriptions] = await Promise.all([listAdminUsers(), listSubscriptions()]);
    const subscriptionMap = new Map(subscriptions.map((subscription) => [subscription.user_id, subscription]));

    return Response.json({
      users: users.map((user) => {
        const subscription = subscriptionMap.get(user.id);
        return {
          id: user.id,
          email: user.email,
          createdAt: user.created_at,
          plan: subscription?.plan ?? 'free',
          status: subscription?.status ?? 'inactive',
          monthlyCredits: subscription?.monthly_credits ?? 0,
          dailyCredits: subscription?.daily_credits ?? 0,
          stripeSubscriptionId: subscription?.stripe_subscription_id ?? null,
        };
      }),
    });
  }

  if (view === 'user') {
    if (!userId) {
      return Response.json({ error: '[RIDVAN-E1228] Missing userId' }, { status: 400 });
    }

    const [users, subscriptions, projects, credits] = await Promise.all([
      listAdminUsers(),
      listSubscriptions(),
      listProjectsForUser(userId),
      getUserCreditHistory(userId, 100),
    ]);

    const user = users.find((entry) => entry.id === userId) ?? null;
    const subscription = subscriptions.find((entry) => entry.user_id === userId) ?? null;

    return Response.json({
      user,
      subscription,
      projects,
      credits,
    });
  }

  if (view === 'credits') {
    if (!userId) {
      return Response.json({ error: '[RIDVAN-E1228] Missing userId' }, { status: 400 });
    }

    const credits = await getUserCreditHistory(userId, 100);
    return Response.json({ credits });
  }

  if (view === 'subscriptions') {
    const subscriptions = await listSubscriptions();
    return Response.json({
      subscriptions: subscriptions.filter((subscription) => (subscription.status ?? '').toLowerCase() === 'active'),
    });
  }

  return Response.json({ error: '[RIDVAN-E1229] Invalid admin view' }, { status: 400 });
}
