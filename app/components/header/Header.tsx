import { useStore } from '@nanostores/react';
import { useEffect } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { useLocation } from '@remix-run/react';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { brand } from '~/config/brand';
import CreditDisplay from '~/components/credits/CreditDisplay';
import { SafeImage } from '~/components/ui/SafeImage';
import { organismProjectId } from '~/lib/stores/organism';
import { hydrateMentorUnread, isMentorUnread, mentorUnreadByProject } from '~/lib/stores/mentor-unread';
import { useAuth } from '~/lib/auth/AuthContext';
import { readMentorUnread } from '~/lib/mentor/api.client';

export function Header() {
  const chat = useStore(chatStore);
  const location = useLocation();
  const isWorkspace = location.pathname === '/chat' || location.pathname.startsWith('/chat/');
  const projectId = useStore(organismProjectId);
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;
  useStore(mentorUnreadByProject);
  const showUnread = isMentorUnread(projectId);

  // Client-only hydration for the unread map.
  // (No server dependency; safe to call in browser.)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    hydrateMentorUnread();

    if (!accessToken) {
      return;
    }

    readMentorUnread(accessToken)
      .then((res) => {
        const current = mentorUnreadByProject.get();
        mentorUnreadByProject.set({ ...current, ...(res.unreadByProject ?? {}) });
      })
      .catch(() => {
        // ignore
      });
  }, [accessToken]);

  return (
    <header
      className={classNames(
        'flex items-center bg-bolt-elements-background-depth-1 p-5 border-b h-[var(--header-height)]',
        {
          'border-transparent': !chat.started,
          'border-bolt-elements-borderColor': chat.started,
        },
      )}
    >
      <div className="flex items-center gap-2 z-logo text-bolt-elements-textPrimary cursor-pointer">
        <SafeImage
          src="/favicon.svg"
          alt={`${brand.appName} logo`}
          className="h-6 w-6 rounded object-cover"
          loading="eager"
        />
        <a href="/" className="text-2xl font-semibold text-accent flex items-center">
          {brand.appName}
        </a>
      </div>

      <nav className="ml-6 flex items-center gap-4 text-sm text-bolt-elements-textSecondary">
        <a href="/projects" className="hover:text-bolt-elements-textPrimary">
          Mina projekt
        </a>
        <a href="/mentor" className="hover:text-bolt-elements-textPrimary inline-flex items-center gap-2">
          Mentor
          <ClientOnly>
            {() => (showUnread ? <span className="h-2 w-2 rounded-full bg-bolt-elements-item-contentAccent" /> : null)}
          </ClientOnly>
        </a>
      </nav>

      <span className="flex-1 px-4 truncate text-center text-bolt-elements-textPrimary">
        {isWorkspace ? <ClientOnly>{() => <ChatDescription />}</ClientOnly> : null}
      </span>

      <div className="mr-2">
        <CreditDisplay />
      </div>

      <a href="/profile" className="mr-2 text-sm text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary">
        Profil
      </a>

      {isWorkspace && chat.started && (
        <ClientOnly>
          {() => (
            <div className="mr-1">
              <HeaderActionButtons />
            </div>
          )}
        </ClientOnly>
      )}
    </header>
  );
}
