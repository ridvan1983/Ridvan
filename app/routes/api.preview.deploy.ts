import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { supabaseAdmin } from '~/lib/supabase/server';

const BUCKET = 'project-previews';

type DeployFile = {
  contentBase64: string;
  contentType: string;
};

type ProjectRow = {
  id: string;
  user_id: string;
  preview_url: string | null;
  preview_build_hash: string | null;
};

function requireBearerToken(request: Request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    throw Response.json({ error: '[RIDVAN-E1911] Unauthorized: missing Bearer token' }, { status: 401 });
  }

  return token;
}

function normalizeStoragePath(filePath: string) {
  return filePath.replace(/^\/+/, '').replace(/\\/g, '/').replace(/\.\.(\/|$)/g, '').trim();
}

async function requireOwnedProject(projectId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, user_id, preview_url, preview_build_hash')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle<ProjectRow>();

  if (error || !data) {
    throw Response.json({ error: `[RIDVAN-E1912] Project not found: ${error?.message ?? 'unknown error'}` }, { status: 404 });
  }

  return data;
}

function decodeBase64(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
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
    return Response.json({ error: `[RIDVAN-E1913] Unauthorized: ${userError?.message ?? 'invalid token'}` }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    projectId?: string;
    sourceHash?: string;
    files?: Record<string, DeployFile>;
  } | null;

  const projectId = body?.projectId?.trim();
  const sourceHash = body?.sourceHash?.trim() ?? null;
  const files = body?.files ?? null;

  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E1914] Missing project id' }, { status: 400 });
  }

  const project = await requireOwnedProject(projectId, user.id);

  if ((!files || Object.keys(files).length === 0) && sourceHash && project.preview_url && project.preview_build_hash === sourceHash) {
    return Response.json({ ok: true, url: project.preview_url, reused: true });
  }

  if (!files || Object.keys(files).length === 0) {
    return Response.json({ error: '[RIDVAN-E1915] Deploy files required' }, { status: 409 });
  }

  await supabaseAdmin.storage.createBucket(BUCKET, { public: true }).catch(() => {
    // ignore
  });

  try {
    await Promise.all(
      Object.entries(files).map(async ([filePath, file]) => {
        const normalized = normalizeStoragePath(filePath);

        if (!normalized) {
          return;
        }

        const bytes = decodeBase64(file.contentBase64);
        const { error } = await supabaseAdmin.storage.from(BUCKET).upload(`${projectId}/${normalized}`, bytes, {
          contentType: file.contentType || 'application/octet-stream',
          upsert: true,
        });

        if (error) {
          throw new Error(`[RIDVAN-E1916] Upload failed for ${normalized}: ${error.message}`);
        }
      }),
    );

    const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(`${projectId}/index.html`);
    const previewUrl = data.publicUrl;

    const { error: updateError } = await supabaseAdmin
      .from('projects')
      .update({
        preview_url: previewUrl,
        preview_build_hash: sourceHash,
        preview_published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', projectId)
      .eq('user_id', user.id);

    if (updateError) {
      return Response.json({ error: `[RIDVAN-E1917] Failed to save preview URL: ${updateError.message}` }, { status: 500 });
    }

    return Response.json({ ok: true, url: previewUrl, reused: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return Response.json({ error: `[RIDVAN-E1918] Preview deploy failed: ${message}` }, { status: 500 });
  }
}
