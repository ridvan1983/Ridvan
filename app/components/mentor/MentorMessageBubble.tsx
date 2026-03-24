import type { ReactNode } from 'react';

export function MentorMessageBubble(props: { role: 'user' | 'mentor' | 'system'; children: ReactNode }) {
  const isUser = props.role === 'user';
  const isSystem = props.role === 'system';

  return (
    <div
      className={
        isSystem
          ? 'max-w-[85%] rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-4 py-2 text-sm text-bolt-elements-textSecondary'
          : isUser
            ? 'max-w-[85%] rounded-2xl px-4 py-2 text-sm text-white'
            : 'max-w-[85%] rounded-2xl border border-[#E8E6E1] bg-white px-4 py-2 text-sm text-[#0A0A0A]'
      }
      style={isUser ? { backgroundImage: 'linear-gradient(135deg, #7C3AED, #EC4899)' } : undefined}
    >
      {props.children}
    </div>
  );
}
