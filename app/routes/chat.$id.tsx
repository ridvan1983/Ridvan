import { json, redirect, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { default as ChatRoute } from './chat';

export async function loader(args: LoaderFunctionArgs) {
  const id = args.params.id;

  const url = new URL(args.request.url);
  const projectIdFromQuery = url.searchParams.get('projectId');
  const sessionIdFromQuery = url.searchParams.get('sessionId');
  const promptFromQuery = url.searchParams.get('prompt');

  // If the URL already includes a projectId, canonicalize to /chat?projectId=...
  // to avoid mixing IndexedDB chat ids with Supabase project workspaces.
  if (projectIdFromQuery?.trim()) {
    const next = new URL('/chat', url.origin);
    next.searchParams.set('projectId', projectIdFromQuery);
    if (sessionIdFromQuery?.trim()) {
      next.searchParams.set('sessionId', sessionIdFromQuery);
    }
    if (promptFromQuery?.trim()) {
      next.searchParams.set('prompt', promptFromQuery);
    }
    return redirect(`${next.pathname}${next.search}`);
  }

  if (typeof id === 'string') {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
    if (isUuid) {
      return redirect(`/chat?projectId=${encodeURIComponent(id)}`);
    }
  }

  return json({ id });
}

export default ChatRoute;
