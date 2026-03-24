import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { ingestBrainEventsById } from '~/lib/brain/ingest.server';
import { ensureBrainWorkspace, insertBrainEvent } from '~/lib/brain/server';
import { analyzeProject } from '~/lib/mentor/project-intelligence.server';

async function hashString(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function action({ context, request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const { user } = await requireUserFromBearerToken(request);
  const body = (await request.json().catch(() => null)) as { projectId?: string; htmlContent?: string } | null;
  const projectId = typeof body?.projectId === 'string' ? body.projectId.trim() : '';
  const htmlContent = typeof body?.htmlContent === 'string' ? body.htmlContent.trim() : '';

  if (!projectId || !htmlContent) {
    return Response.json({ error: '[RIDVAN-E2021] Missing projectId or htmlContent' }, { status: 400 });
  }

  try {
    const workspace = await ensureBrainWorkspace(projectId, user.id);
    const analysis = await analyzeProject({
      projectId,
      userId: user.id,
      htmlContent,
      env: context.cloudflare.env,
    });

    const htmlHash = await hashString(htmlContent);
    const eventId = await insertBrainEvent({
      workspaceId: workspace.id,
      projectId,
      userId: user.id,
      source: 'builder',
      type: 'project.analyzed',
      idempotencyKey: `project.analyzed:${projectId}:${htmlHash}`,
      payload: {
        ...analysis,
        assertion_source: 'system_inferred',
        html_hash: htmlHash,
      },
    });

    void ingestBrainEventsById([eventId]).catch((error) => {
      console.error('[RIDVAN-E2022] Project intelligence ingestion failed', error);
    });

    return Response.json({ ok: true, eventId, analysis });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: `[RIDVAN-E2023] Project intelligence failed: ${message}` }, { status: 500 });
  }
}
