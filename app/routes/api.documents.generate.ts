import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { streamText } from '~/lib/.server/llm/stream-text';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { readBrainContext } from '~/lib/brain/read.server';
import { getVerticalContext } from '~/lib/vertical/context.server';
import { buildOpportunityContext } from '~/lib/opportunity/context.server';
import { ensureBrainWorkspace, insertBrainEvent } from '~/lib/brain/server';
import { ingestBrainEventsById } from '~/lib/brain/ingest.server';

type DocumentType = 'business_summary' | 'business_plan_draft' | 'pitch_draft' | 'growth_plan';

function isDocType(value: unknown): value is DocumentType {
  return value === 'business_summary' || value === 'business_plan_draft' || value === 'pitch_draft' || value === 'growth_plan';
}

function titleFor(type: DocumentType) {
  switch (type) {
    case 'business_summary':
      return 'Business summary';
    case 'business_plan_draft':
      return 'Business plan (draft)';
    case 'pitch_draft':
      return 'Pitch (draft)';
    case 'growth_plan':
      return 'Growth plan (draft)';
  }
}

export async function action({ context, request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const { user } = await requireUserFromBearerToken(request);

  const body = (await request.json().catch(() => null)) as
    | {
        projectId?: string;
        documentType?: DocumentType;
        instructions?: string;
      }
    | null;

  const projectId = body?.projectId;
  const documentType = body?.documentType;
  const instructions = typeof body?.instructions === 'string' ? body!.instructions.trim() : '';

  if (!projectId || !isDocType(documentType)) {
    return Response.json({ error: '[RIDVAN-E971] Missing projectId or documentType' }, { status: 400 });
  }

  const workspace = await ensureBrainWorkspace(projectId, user.id);
  const brain = await readBrainContext({ projectId, userId: user.id });
  const vertical = await getVerticalContext({ projectId, userId: user.id });
  const opportunity = await buildOpportunityContext({ projectId, userId: user.id });

  if (!brain || !vertical) {
    return Response.json({ error: '[RIDVAN-E972] Missing context' }, { status: 404 });
  }

  const system = `You are a helpful co-founder. Generate a concise, practical ${documentType} as Markdown.\n\nRules:\n- No pricing, no upsells, no sales tone.\n- Use concrete structure and headings.\n- If data is missing, make assumptions explicit and list questions at the end.\n\nContext (JSON):\n${JSON.stringify(
    {
      brain: {
        state: brain.state,
        industry: brain.industryProfile,
        geo: brain.geoProfile,
        signals: brain.state.currentSignals,
      },
      vertical,
      opportunities: opportunity?.opportunities ?? [],
      instructions: instructions || null,
    },
    null,
    2,
  )}`;

  const result = await streamText(
    [
      {
        role: 'user',
        content: `Generate: ${documentType}.`,
      },
    ],
    context.cloudflare.env,
    {
      system,
      maxTokens: 1800,
      temperature: 0.4,
    },
  );

  let content = '';
  for await (const delta of result.textStream) {
    content += delta;
  }

  const payload = {
    type: documentType,
    title: titleFor(documentType),
    content,
    metadata: {
      instructions: instructions || null,
      generated_at: new Date().toISOString(),
    },
    assertion_source: 'system_inferred',
  } as Record<string, unknown>;

  const eventId = await insertBrainEvent({
    workspaceId: workspace.id,
    projectId,
    userId: user.id,
    source: 'vertical',
    type: 'documents.generated',
    payload,
  });

  void ingestBrainEventsById([eventId]).catch((error) => {
    console.error('[RIDVAN-E973] Document ingestion failed', error);
  });

  return Response.json({
    ok: true,
    eventId,
    title: payload.title,
    type: payload.type,
    content: payload.content,
    metadata: payload.metadata,
  });
}
