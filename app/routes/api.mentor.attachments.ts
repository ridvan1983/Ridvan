import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { ensureBrainWorkspace, insertBrainEvent } from '~/lib/brain/server';
import { ingestBrainEventsById } from '~/lib/brain/ingest.server';
import { extractTextFromAttachmentBytes } from '~/lib/mentor/file-analysis.server';
import { supabaseAdmin } from '~/lib/supabase/server';

const BUCKET = 'mentor-attachments';
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_MB = Math.floor(MAX_BYTES / (1024 * 1024));

function decodeBase64ToUint8Array(base64: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function sanitizeFilename(filename: string) {
  return filename.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const { user } = await requireUserFromBearerToken(request);

  const body = (await request.json().catch(() => null)) as
    | {
        projectId?: string;
        filename?: string;
        mimeType?: string;
        dataBase64?: string;
      }
    | null;

  const projectId = body?.projectId;
  const filename = body?.filename;
  const mimeType = body?.mimeType;
  const dataBase64 = body?.dataBase64;

  if (!projectId || !filename || !mimeType || !dataBase64) {
    return Response.json({ error: '[RIDVAN-E991] Missing upload fields' }, { status: 400 });
  }

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64ToUint8Array(dataBase64);
  } catch {
    return Response.json({ error: '[RIDVAN-E996] Invalid base64 payload' }, { status: 400 });
  }

  if (bytes.byteLength > MAX_BYTES) {
    return Response.json({ error: `[RIDVAN-E992] File too large. Max ${MAX_MB}MB` }, { status: 400 });
  }

  const workspace = await ensureBrainWorkspace(projectId, user.id);

  // Best-effort: ensure bucket exists
  await supabaseAdmin.storage.createBucket(BUCKET, { public: false }).catch(() => {
    // ignore
  });

  const safeFilename = sanitizeFilename(filename);
  const path = `${workspace.id}/${Date.now()}-${safeFilename}`;

  const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, {
    contentType: mimeType,
    upsert: false,
  });

  if (uploadError) {
    return Response.json({ error: `[RIDVAN-E993] Upload failed: ${uploadError.message}` }, { status: 500 });
  }

  const { data: signed, error: signedError } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 60 * 60);

  if (signedError || !signed) {
    return Response.json({ error: `[RIDVAN-E994] Signed URL failed: ${signedError?.message ?? 'unknown error'}` }, { status: 500 });
  }

  const extractedText = extractTextFromAttachmentBytes(filename, mimeType, bytes);

  const eventId = await insertBrainEvent({
    workspaceId: workspace.id,
    projectId,
    userId: user.id,
    source: 'system',
    type: 'asset.attachment_added',
    payload: {
      filename,
      mime_type: mimeType,
      byte_size: bytes.byteLength,
      storage: {
        bucket: BUCKET,
        path,
        signed_url: signed.signedUrl,
        expires_in_seconds: 60 * 60,
      },
      extracted_text: extractedText,
      assertion_source: 'user_stated',
    },
  });

  void ingestBrainEventsById([eventId]).catch((error) => {
    console.error('[RIDVAN-E995] Attachment ingestion failed', error);
  });

  return Response.json({
    ok: true,
    eventId,
    attachment: {
      filename,
      mimeType,
      byteSize: bytes.byteLength,
      url: signed.signedUrl,
      extractedText,
      storage: {
        bucket: BUCKET,
        path,
      },
    },
  });
}
