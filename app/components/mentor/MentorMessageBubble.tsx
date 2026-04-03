import type { ReactNode } from 'react';

export function MentorMessageBubble(props: {
  role: 'user' | 'mentor' | 'system';
  children: ReactNode;
  showMentorBrand?: boolean;
}) {
  const isUser = props.role === 'user';
  const isSystem = props.role === 'system';
  const isMentor = props.role === 'mentor';

  return (
    <div
      className={
        isSystem
          ? 'max-w-[85%] rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-4 py-2 text-sm text-bolt-elements-textSecondary'
          : isUser
            ? 'max-w-[85%] rounded-2xl px-4 py-2 text-sm text-white'
            : 'max-w-[85%] rounded-2xl border border-[#E8E6E1] bg-white px-4 py-3 text-sm text-[#0A0A0A] shadow-sm'
      }
      style={isUser ? { backgroundImage: 'linear-gradient(135deg, #7C3AED, #EC4899)' } : undefined}
    >
      {isMentor && props.showMentorBrand ? (
        <div className="mb-2 flex items-center gap-2 border-b border-black/5 pb-2">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #7C3AED, #EC4899)' }}
            aria-hidden
          >
            M
          </div>
          <div>
            <div className="text-xs font-semibold text-[#0A0A0A]">Mentor</div>
            <div className="text-[10px] text-[#6B7280]">Co-founder</div>
          </div>
        </div>
      ) : null}
      {props.children}
    </div>
  );
}
