import { json, type MetaFunction } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { AuthGuard } from '~/components/auth/AuthGuard';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import { brand } from '~/config/brand';

export const meta: MetaFunction = () => {
  return [{ title: brand.meta.title }, { name: 'description', content: brand.meta.ogDescription }];
};

export const loader = () => json({});

export default function Index() {
  return (
    <AuthGuard>
      <div className="flex flex-col h-full w-full">
        <Header />
        <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
      </div>
    </AuthGuard>
  );
}
