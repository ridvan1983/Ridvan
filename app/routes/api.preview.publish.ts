import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import puppeteer from 'puppeteer';
import { supabaseAdmin } from '~/lib/supabase/server';
import { WORK_DIR } from '~/utils/constants';

const BUCKET = 'project-previews';

type PublishFile = {
  content: string;
  isBinary?: boolean;
};

type ProjectRow = {
  id: string;
  user_id: string;
};

function requireBearerToken(request: Request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    throw Response.json({ error: '[RIDVAN-E1902] Unauthorized: missing Bearer token' }, { status: 401 });
  }

  return token;
}

function normalizeStoragePath(filePath: string) {
  const withoutWorkDir = filePath.startsWith(`${WORK_DIR}/`) ? filePath.slice(WORK_DIR.length + 1) : filePath;
  return withoutWorkDir.replace(/^\/+/, '').replace(/\.\.(\/|\\)/g, '').trim();
}

function getContentType(filePath: string) {
  const lower = filePath.toLowerCase();

  if (lower.endsWith('.html')) return 'text/html; charset=utf-8';
  if (lower.endsWith('.css')) return 'text/css; charset=utf-8';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'application/javascript; charset=utf-8';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.jsx')) return 'text/plain; charset=utf-8';
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.txt') || lower.endsWith('.md')) return 'text/plain; charset=utf-8';

  return 'text/plain; charset=utf-8';
}

async function requireOwnedProject(projectId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, user_id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle<ProjectRow>();

  if (error || !data) {
    throw Response.json({ error: `[RIDVAN-E1903] Project not found: ${error?.message ?? 'unknown error'}` }, { status: 404 });
  }

  return data;
}

async function captureRenderedHtml(previewUrl: string) {
  const browser = await puppeteer.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 2200, deviceScaleFactor: 2 });
    await page.goto(previewUrl, { waitUntil: 'networkidle0', timeout: 45_000 });
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const html = await page.evaluate(() => `<!DOCTYPE html>\n${document.documentElement.outerHTML}`);
    return html;
  } finally {
    await browser.close();
  }
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
    return Response.json({ error: `[RIDVAN-E1904] Unauthorized: ${userError?.message ?? 'invalid token'}` }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    projectId?: string;
    previewUrl?: string;
    files?: Record<string, PublishFile>;
    htmlFilePath?: string;
    htmlSnapshot?: string | null;
  } | null;

  const projectId = body?.projectId?.trim();
  const previewUrl = body?.previewUrl?.trim();
  const htmlFilePath = body?.htmlFilePath?.trim();
  const files = body?.files ?? {};

  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E1905] Missing project id' }, { status: 400 });
  }

  if (!htmlFilePath) {
    return Response.json({ error: '[RIDVAN-E1906] Missing html file path' }, { status: 400 });
  }

  await requireOwnedProject(projectId, user.id);

  await supabaseAdmin.storage.createBucket(BUCKET, { public: true }).catch(() => {
    // ignore
  });

  const publishedAt = Date.now();
  const basePath = `${user.id}/${projectId}/${publishedAt}`;
  const encoder = new TextEncoder();

  const uploads = Object.entries(files)
    .filter(([, file]) => file && file.isBinary !== true && typeof file.content === 'string')
    .map(async ([filePath, file]) => {
      const normalized = normalizeStoragePath(filePath);
      if (!normalized) {
        return;
      }

      const { error } = await supabaseAdmin.storage.from(BUCKET).upload(`${basePath}/${normalized}`, encoder.encode(file.content), {
        contentType: getContentType(normalized),
        upsert: true,
      });

      if (error) {
        throw new Error(`[RIDVAN-E1907] Upload failed for ${normalized}: ${error.message}`);
      }
    });

  try {
    await Promise.all(uploads);

    let snapshot = typeof body?.htmlSnapshot === 'string' && body.htmlSnapshot.trim().length > 0 ? body.htmlSnapshot : null;

    if (!snapshot && previewUrl) {
      try {
        snapshot = await captureRenderedHtml(previewUrl);
      } catch {
        snapshot = null;
      }
    }

    const rootHtml = snapshot ?? files[htmlFilePath]?.content;

    if (!rootHtml) {
      return Response.json({ error: '[RIDVAN-E1908] Missing HTML content to publish' }, { status: 400 });
    }

    const { error: htmlError } = await supabaseAdmin.storage.from(BUCKET).upload(`${basePath}/index.html`, encoder.encode(rootHtml), {
      contentType: 'text/html; charset=utf-8',
      upsert: true,
    });

    if (htmlError) {
      return Response.json({ error: `[RIDVAN-E1909] HTML upload failed: ${htmlError.message}` }, { status: 500 });
    }

    const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(`${basePath}/index.html`);

    return Response.json({ ok: true, url: data.publicUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return Response.json({ error: `[RIDVAN-E1910] Preview publish failed: ${message}` }, { status: 500 });
  }
}
