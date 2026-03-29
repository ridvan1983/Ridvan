import { type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { getVerticalContext } from '~/lib/vertical/context.server';
import { getModulesForIndustry } from '~/lib/vertical/modules.server';
import type { NormalizedIndustry } from '~/lib/vertical/taxonomy.server';
import { supabaseAdmin } from '~/lib/supabase/server';

type ModuleRow = {
  id: string;
  name: string;
  description: string | null;
  price_monthly: number;
  currency: string;
  stripe_price_id: string | null;
  vertical: string | null;
  is_free: boolean | null;
  is_active: boolean | null;
};

type UserModuleRow = {
  module_id: string;
  status: string;
  activated_at: string | null;
};

type ProjectRow = {
  id: string;
  user_id: string;
};

function buildSuggestedModules(normalizedIndustry: string | null, geoCountryCode: string | null) {
  if (!normalizedIndustry) {
    return [];
  }

  return getModulesForIndustry(normalizedIndustry as NormalizedIndustry, geoCountryCode).map((module) => ({
    id: `suggested:${module.module_key}`,
    name: module.label,
    description: module.description,
    priceMonthly: 0,
    currency: 'SEK',
    stripePriceId: null,
    vertical: normalizedIndustry,
    isFree: true,
    isActive: true,
    status: 'suggested',
    activatedAt: null,
  }));
}

async function requireOwnedProject(projectId: string, userId: string) {
  const { data, error } = await supabaseAdmin.from('projects').select('id, user_id').eq('id', projectId).eq('user_id', userId).maybeSingle<ProjectRow>();

  if (error) {
    throw new Error(`[RIDVAN-E1239] Failed to load project: ${error.message}`);
  }

  if (!data) {
    throw Response.json({ error: '[RIDVAN-E1240] Project not found' }, { status: 404 });
  }

  return data;
}

async function listModulesForProject(projectId: string, userId: string) {
  await requireOwnedProject(projectId, userId);
  const verticalContext = await getVerticalContext({ projectId, userId }).catch(() => null);
  const normalizedIndustry = verticalContext?.industryProfile?.normalizedIndustry ?? null;
  const geoCountryCode = verticalContext?.geoProfile?.countryCode ?? null;

  const { data: modules, error: modulesError } = await supabaseAdmin
    .from('modules')
    .select('id, name, description, price_monthly, currency, stripe_price_id, vertical, is_free, is_active')
    .eq('is_active', true)
    .or(normalizedIndustry ? `vertical.eq.${normalizedIndustry},vertical.is.null` : 'vertical.is.null')
    .order('is_free', { ascending: false })
    .order('price_monthly', { ascending: true })
    .returns<ModuleRow[]>();

  if (modulesError) {
    throw new Error(`[RIDVAN-E1241] Failed to load modules: ${modulesError.message}`);
  }

  const { data: userModules, error: userModulesError } = await supabaseAdmin
    .from('user_modules')
    .select('module_id, status, activated_at')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .returns<UserModuleRow[]>();

  if (userModulesError) {
    throw new Error(`[RIDVAN-E1242] Failed to load active modules: ${userModulesError.message}`);
  }

  const statusMap = new Map((userModules ?? []).map((module) => [module.module_id, module]));

  return {
    projectId,
    vertical: normalizedIndustry,
    modules:
      (modules ?? []).length > 0
        ? (modules ?? []).map((module) => {
            const active = statusMap.get(module.id);
            return {
              id: module.id,
              name: module.name,
              description: module.description,
              priceMonthly: module.price_monthly,
              currency: module.currency,
              stripePriceId: module.stripe_price_id,
              vertical: module.vertical,
              isFree: module.is_free ?? true,
              isActive: module.is_active ?? true,
              status: active?.status ?? 'inactive',
              activatedAt: active?.activated_at ?? null,
            };
          })
        : buildSuggestedModules(normalizedIndustry, geoCountryCode),
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const { user } = await requireUserFromBearerToken(request);
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId')?.trim();

  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E1243] Missing projectId' }, { status: 400 });
  }

  const payload = await listModulesForProject(projectId, user.id);
  return Response.json(payload);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const { user } = await requireUserFromBearerToken(request);
  const body = (await request.json().catch(() => null)) as { moduleId?: string; projectId?: string } | null;
  const moduleId = body?.moduleId?.trim();
  const projectId = body?.projectId?.trim();

  if (!moduleId || !projectId) {
    return Response.json({ error: '[RIDVAN-E1244] Missing moduleId or projectId' }, { status: 400 });
  }

  await requireOwnedProject(projectId, user.id);

  const { data: moduleRow, error: moduleError } = await supabaseAdmin
    .from('modules')
    .select('id, is_free, is_active')
    .eq('id', moduleId)
    .maybeSingle<{ id: string; is_free: boolean | null; is_active: boolean | null }>();

  if (moduleError) {
    return Response.json({ error: `[RIDVAN-E1245] Failed to load module: ${moduleError.message}` }, { status: 500 });
  }

  if (!moduleRow || moduleRow.is_active === false) {
    return Response.json({ error: '[RIDVAN-E1246] Module not found' }, { status: 404 });
  }

  if (moduleRow.is_free === false) {
    return Response.json({ error: '[RIDVAN-E1247] Paid modules are not supported in this route yet' }, { status: 400 });
  }

  const { error: insertError } = await supabaseAdmin.from('user_modules').upsert(
    {
      user_id: user.id,
      project_id: projectId,
      module_id: moduleId,
      status: 'active',
      activated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,project_id,module_id' },
  );

  if (insertError) {
    return Response.json({ error: `[RIDVAN-E1248] Failed to activate module: ${insertError.message}` }, { status: 500 });
  }

  return Response.json({ ok: true, moduleId, projectId, status: 'active' });
}
