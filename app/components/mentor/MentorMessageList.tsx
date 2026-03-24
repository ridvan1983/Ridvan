import { useEffect, useRef } from 'react';
import { MentorMessageBubble } from './MentorMessageBubble';
import { DocumentCard, type MentorDocumentCard } from './DocumentCard';

export interface MentorChatMessage {
  id: string;
  role: 'user' | 'mentor' | 'system';
  content: string;
  createdAt: string;
  priorityCard?: {
    title: string;
    actionText: string;
    meta: string;
  };
  attachment?: {
    filename: string;
    mimeType: string;
    url?: string;
  };
  document?: {
    title: string;
    type: string;
    content: string;
  };

  documentCard?: MentorDocumentCard;
}

export function MentorMessageList(props: { messages: MentorChatMessage[]; isTyping: boolean; typingText?: string }) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [props.messages.length, props.isTyping]);

  return (
    <div className="flex-1 min-h-0 overflow-auto px-4 py-4">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        {props.messages.map((m) => {
          const align = m.role === 'user' ? 'items-end' : 'items-start';
          const tsAlign = m.role === 'user' ? 'text-right' : 'text-left';

          return (
            <div key={m.id} className={`flex flex-col ${align}`}>
              <MentorMessageBubble role={m.role}>
                {m.priorityCard ? (
                  <div className="rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-4">
                    <div className="text-sm font-semibold">{m.priorityCard.title}</div>
                    <div className="mt-2 whitespace-pre-wrap leading-relaxed">{m.priorityCard.actionText}</div>
                    <div className="mt-2 text-[11px] text-bolt-elements-textSecondary">{m.priorityCard.meta}</div>
                  </div>
                ) : null}

                {m.documentCard ? <DocumentCard doc={m.documentCard} /> : null}

                {m.attachment ? (
                  <div className="mb-2">
                    <div className="text-sm font-semibold">{m.attachment.filename}</div>
                    <div className="mt-1 text-[11px] opacity-80">{m.attachment.mimeType}</div>
                    {m.attachment.url ? (
                      m.attachment.mimeType.startsWith('image/') ? (
                        <img
                          src={m.attachment.url}
                          alt={m.attachment.filename}
                          className="mt-3 max-h-[260px] rounded-xl border border-bolt-elements-borderColor"
                        />
                      ) : (
                        <a className="mt-2 inline-block text-sm underline" href={m.attachment.url} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      )
                    ) : null}
                  </div>
                ) : null}

                {m.content ? <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div> : null}
              </MentorMessageBubble>
              <div className={`mt-1 text-[10px] opacity-60 ${tsAlign}`}>{new Date(m.createdAt).toLocaleTimeString()}</div>
            </div>
          );
        })}

        {props.isTyping ? (
          <div className="flex flex-col items-start">
            <MentorMessageBubble role="mentor">
              <div className="flex items-center gap-3 text-sm text-bolt-elements-textSecondary">
                <div className="flex items-center gap-1" aria-hidden="true">
                  <span className="h-2 w-2 rounded-full bg-current animate-pulse" />
                  <span className="h-2 w-2 rounded-full bg-current animate-pulse [animation-delay:120ms]" />
                  <span className="h-2 w-2 rounded-full bg-current animate-pulse [animation-delay:240ms]" />
                </div>
                <div className="whitespace-pre-wrap leading-relaxed">{props.typingText ?? 'Analyserar...'}</div>
              </div>
            </MentorMessageBubble>
          </div>
        ) : null}

        <div ref={endRef} />
      </div>
    </div>
  );
}
