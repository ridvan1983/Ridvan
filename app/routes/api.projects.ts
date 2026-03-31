import { type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { getAPIKey } from '~/lib/.server/llm/api-key';
import { getRequestCloudflareEnv } from '~/lib/env.server';
import { supabaseAdmin } from '~/lib/supabase/server';

interface ProjectRow {
  id: string;
  user_id: string;
  title: string | null;
  preview_url: string | null;
  supabase_project_id: string | null;
  supabase_project_url: string | null;
  supabase_anon_key: string | null;
  supabase_connected_at: string | null;
  created_at: string;
  updated_at: string;
}

function cleanGeneratedName(input: string) {
  return input
    .replace(/^['"“”‘’]+|['"“”‘’]+$/g, '')
    .replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '')
    .split(/\r?\n/)[0]
    .trim()
    .slice(0, 80);
}

function fallbackProjectName(titleHint: string) {
  const source = titleHint.trim();
  const lower = source.toLowerCase();

  const namedEntityPatterns = [
    /(?:för|for)\s+([\p{L}\p{N}][\p{L}\p{N}&'’\- ]{1,60})/iu,
    /(?:som heter|called|named)\s+([\p{L}\p{N}][\p{L}\p{N}&'’\- ]{1,60})/iu,
  ];

  for (const pattern of namedEntityPatterns) {
    const match = source.match(pattern);
    const candidate = match?.[1]?.trim().replace(/[,.!?;:]+$/g, '').trim();

    if (candidate) {
      return candidate.split(/\s+/).slice(0, 4).join(' ');
    }
  }

  if (lower.includes('frisör') || lower.includes('salong')) {
    return lower.includes('stockholm') ? 'Stockholms Frisör' : 'Salongen';
  }

  if (lower.includes('pizzeria') || lower.includes('pizza')) {
    return lower.includes('göteborg') || lower.includes('goteborg') ? 'Pizzeria Göteborg' : 'Pizzeria Napoli';
  }

  if (lower.includes('gym') || lower.includes('fitness')) {
    return lower.includes('malmö') || lower.includes('malmo') ? 'Malmö Fitness' : 'Nordic Fitness';
  }

  if (lower.includes('tandläk') || lower.includes('dent')) {
    return 'DentBook';
  }

  if (lower.includes('todo') || lower.includes('task')) {
    return 'TaskFlow';
  }

  const words = source
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}-]/gu, ''))
    .filter(Boolean)
    .slice(0, 3);

  if (words.length === 0) {
    return 'New Venture';
  }

  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}

async function generateProjectTitle(rawTitleHint: string, request: Request) {
  const titleHint = rawTitleHint.trim();
  if (!titleHint) {
    return null;
  }

  try {
    const apiKey = getAPIKey(getRequestCloudflareEnv(request));
    if (!apiKey) {
      return fallbackProjectName(titleHint);
    }

    const anthropic = createAnthropic({ apiKey });
    const result = await generateText({
      model: anthropic('claude-sonnet-4-5-20250929'),
      temperature: 0,
      maxTokens: 20,
      prompt: `Extract a short project name (2-4 words max) from this description.
Return ONLY the name, nothing else.

Examples:
- "Bygg en restauranghemsida för Mama Rosa i Stockholm" → "Mama Rosa"
- "Build a todo app with React" → "Todo App"
- "Skapa en e-handel för barnkläder som heter KidStyle" → "KidStyle"

Rules:
- Prefer the explicit business or product name if one exists
- Do not return a full sentence
- Do not include words like "Bygg", "Skapa", "Build", "Create"
- Keep it short and readable

Description: ${JSON.stringify(titleHint)}`,
    });

    const cleaned = cleanGeneratedName(result.text);
    return cleaned || fallbackProjectName(titleHint);
  } catch {
    return fallbackProjectName(titleHint);
  }
}

function requireBearerToken(request: Request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    throw Response.json({ error: '[RIDVAN-E711] Unauthorized: missing Bearer token' }, { status: 401 });
  }

  return token;
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const token = requireBearerToken(request);

  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    return Response.json({ error: `[RIDVAN-E711] Unauthorized: ${userError?.message ?? 'invalid token'}` }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, user_id, title, preview_url, supabase_project_id, supabase_project_url, supabase_anon_key, supabase_connected_at, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .returns<ProjectRow[]>();

  if (error) {
    return Response.json({ error: `[RIDVAN-E712] Failed to list projects: ${error.message}` }, { status: 500 });
  }

  return Response.json(
    (data ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      title: row.title,
      previewUrl: row.preview_url,
      vercelProjectId: null,
      customDomain: null,
      supabaseProjectId: row.supabase_project_id,
      supabaseProjectUrl: row.supabase_project_url,
      supabaseAnonKey: row.supabase_anon_key,
      supabaseConnectedAt: row.supabase_connected_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  );
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const token = requireBearerToken(request);

  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    return Response.json({ error: `[RIDVAN-E711] Unauthorized: ${userError?.message ?? 'invalid token'}` }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { id?: string; title?: string | null } | null;

  const id = body?.id;

  if (!id) {
    return Response.json({ error: '[RIDVAN-E713] Missing project id' }, { status: 400 });
  }

  const titleHint = typeof body?.title === 'string' ? body.title : null;
  const now = new Date().toISOString();

  const { data: existingProject, error: existingProjectError } = await supabaseAdmin
    .from('projects')
    .select('id, user_id, title, preview_url, supabase_project_id, supabase_project_url, supabase_anon_key, supabase_connected_at, created_at, updated_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle<ProjectRow>();

  if (existingProjectError) {
    return Response.json({ error: `[RIDVAN-E714] Failed to load project: ${existingProjectError.message}` }, { status: 500 });
  }

  let data: ProjectRow | null = null;
  let error: { message: string } | null = null;

  if (existingProject) {
    const result = await supabaseAdmin
      .from('projects')
      .update({
        updated_at: now,
      })
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id, user_id, title, preview_url, supabase_project_id, supabase_project_url, supabase_anon_key, supabase_connected_at, created_at, updated_at')
      .single<ProjectRow>();

    data = result.data;
    error = result.error;
  } else {
    const generatedTitle = titleHint ? await generateProjectTitle(titleHint, request) : null;
    const title = generatedTitle ?? titleHint ?? null;
    const result = await supabaseAdmin
      .from('projects')
      .insert({
        id,
        user_id: user.id,
        title,
        updated_at: now,
      })
      .select('id, user_id, title, preview_url, supabase_project_id, supabase_project_url, supabase_anon_key, supabase_connected_at, created_at, updated_at')
      .single<ProjectRow>();

    data = result.data;
    error = result.error;
  }

  if (error || !data) {
    return Response.json({ error: `[RIDVAN-E714] Failed to upsert project: ${error?.message ?? 'unknown error'}` }, { status: 500 });
  }

  return Response.json({
    id: data.id,
    userId: data.user_id,
    title: data.title,
    previewUrl: data.preview_url,
    vercelProjectId: null,
    customDomain: null,
    supabaseProjectId: data.supabase_project_id,
    supabaseProjectUrl: data.supabase_project_url,
    supabaseAnonKey: data.supabase_anon_key,
    supabaseConnectedAt: data.supabase_connected_at,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  });
}
