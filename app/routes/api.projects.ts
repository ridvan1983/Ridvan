import { type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { getAPIKey } from '~/lib/.server/llm/api-key';
import { supabaseAdmin } from '~/lib/supabase/server';

interface ProjectRow {
  id: string;
  user_id: string;
  title: string | null;
  preview_url: string | null;
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
    const apiKey = getAPIKey((request as any).cf?.env ?? (globalThis as any)?.env ?? undefined);
    if (!apiKey) {
      return fallbackProjectName(titleHint);
    }

    const anthropic = createAnthropic({ apiKey });
    const result = await generateText({
      model: anthropic('claude-sonnet-4-5-20250929'),
      temperature: 0.4,
      maxTokens: 30,
      prompt: `Based on this business idea, generate a short, professional business name.
Rules:
- Max 3 words
- Sounds like a real business name, not a description
- Match the language of the prompt (Swedish prompt = Swedish name)
- Match the industry and location if mentioned
- Never use generic words like "App" or "System"

Examples:
- "frisörsalong i stockholm" → "Atelier Nord"
- "pizzeria i göteborg" → "Pizzeria Napoli"
- "gym i malmö" → "Malmö Fitness"
- "todo app" → "TaskFlow"
- "bokningssystem för tandläkare" → "DentBook"

Business idea: "${titleHint}"

Respond with ONLY the business name, nothing else.`,
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
    .select('id, user_id, title, preview_url, created_at, updated_at')
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
    .select('id, user_id, title, preview_url, created_at, updated_at')
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
      .select('id, user_id, title, preview_url, created_at, updated_at')
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
      .select('id, user_id, title, preview_url, created_at, updated_at')
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
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  });
}
