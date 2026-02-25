import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { AuthGuard } from '~/components/auth/AuthGuard';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';

export async function loader(_args: LoaderFunctionArgs) {
  return json({});
}

export default function ChatRoute() {
  return (
    <AuthGuard>
      <div className="flex flex-col h-full w-full">
        <Header />
        <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
      </div>
    </AuthGuard>
  );
}
