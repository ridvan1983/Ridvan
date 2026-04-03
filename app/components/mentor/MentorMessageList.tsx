import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseProactiveMentorStorage, splitMentorInsightTrailer } from '~/lib/mentor/proactive-message';
import { MentorMessageBubble } from './MentorMessageBubble';
import { DocumentCard, type MentorDocumentCard } from './DocumentCard';
import { MentorInsightCard } from './MentorInsightCard';
import { MentorRichText } from './MentorRichText';

const SCROLL_BOTTOM_THRESHOLD_PX = 72;

function extractImplementationAction(content: string) {
  const match = content.match(/\[data-implement="true"\s+data-prompt="([\s\S]*?)"\]$/m);
  if (!match) {
    return { visibleContent: content, prompt: null };
  }

  const prompt = match[1]?.replace(/&quot;/g, '"').trim() ?? null;
  const visibleContent = content.replace(match[0], '').trim();
  return { visibleContent, prompt };
}

function MentorTypingDots() {
  return (
    <div className="flex items-center gap-1.5 py-0.5" role="status" aria-label="Mentor skriver">
      <span className="h-2 w-2 shrink-0 rounded-full bg-violet-500 opacity-90 animate-pulse" />
      <span className="h-2 w-2 shrink-0 rounded-full bg-violet-500 opacity-75 animate-pulse [animation-delay:180ms]" />
      <span className="h-2 w-2 shrink-0 rounded-full bg-violet-500 opacity-60 animate-pulse [animation-delay:360ms]" />
    </div>
  );
}

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

export function MentorMessageList(props: {
  messages: MentorChatMessage[];
  isTyping: boolean;
  typingText?: string;
  onImplement?: (prompt: string, messageId: string) => void;
  implementingMessageId?: string | null;
  implementedMessageId?: string | null;
  streamingMessageId?: string | null;
  isStreamingAssistant?: boolean;
  awaitingFirstStreamToken?: boolean;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [showJumpHint, setShowJumpHint] = useState(false);

  const scrollSignature = useMemo(
    () => props.messages.map((m) => `${m.id}:${m.content?.length ?? 0}`).join('|'),
    [props.messages],
  );

  const recalcPinned = useCallback(() => {
    const el = rootRef.current;
    if (!el) {
      return;
    }
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    const next = gap <= SCROLL_BOTTOM_THRESHOLD_PX;
    setPinnedToBottom(next);
    if (next) {
      setShowJumpHint(false);
    }
  }, []);

  const onScroll = useCallback(() => {
    recalcPinned();
  }, [recalcPinned]);

  useEffect(() => {
    recalcPinned();
  }, [scrollSignature, props.messages.length, recalcPinned]);

  useEffect(() => {
    if (pinnedToBottom) {
      requestAnimationFrame(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      });
    } else {
      setShowJumpHint(true);
    }
  }, [scrollSignature, props.isTyping, props.streamingMessageId, props.awaitingFirstStreamToken, pinnedToBottom]);

  const jumpToLatest = useCallback(() => {
    setPinnedToBottom(true);
    setShowJumpHint(false);
    requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  }, []);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={rootRef} className="min-h-0 flex-1 overflow-auto px-4 py-4" onScroll={onScroll}>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        {props.messages.map((m) => {
          const align = m.role === 'user' ? 'items-end' : 'items-start';
          const tsAlign = m.role === 'user' ? 'text-right' : 'text-left';
          const implementation = extractImplementationAction(m.content);
          const isMentor = m.role === 'mentor';
          const proactive = isMentor ? parseProactiveMentorStorage(implementation.visibleContent) : null;
          const baseForSplit = isMentor && proactive?.triggerType ? proactive.body : implementation.visibleContent;
          const { visible: bubbleMarkdown, insight: trailerInsight } = isMentor
            ? splitMentorInsightTrailer(baseForSplit)
            : { visible: implementation.visibleContent, insight: null };
          const insightCard = isMentor ? proactive?.insight ?? trailerInsight : null;
          const showProactiveLabel = isMentor && Boolean(proactive?.triggerType);
          const canImplement = m.role === 'mentor' && Boolean(implementation.prompt) && !m.documentCard && !m.priorityCard;

          const showStreamCursor = Boolean(
            props.isStreamingAssistant && props.streamingMessageId === m.id && m.role === 'mentor',
          );

          const typingInsideBubble = Boolean(
            props.awaitingFirstStreamToken &&
              props.streamingMessageId === m.id &&
              m.role === 'mentor' &&
              m.content.length === 0,
          );

          return (
            <div key={m.id} className={`flex flex-col ${align}`}>
              {showProactiveLabel ? (
                <div className="mb-1 max-w-[85%] rounded-lg border border-violet-200/80 bg-gradient-to-r from-violet-50 to-fuchsia-50 px-3 py-1.5 text-xs font-semibold text-violet-900 shadow-sm">
                  Mentor noterar:
                </div>
              ) : null}
              {insightCard ? (
                <div className="mb-2 max-w-[85%]">
                  <MentorInsightCard
                    type={insightCard.type}
                    title={insightCard.title}
                    description={insightCard.description}
                    action={insightCard.action}
                  />
                </div>
              ) : null}
              <MentorMessageBubble role={m.role} showMentorBrand={m.role === 'mentor'}>
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

                {typingInsideBubble ? <MentorTypingDots /> : null}

                {!typingInsideBubble && bubbleMarkdown ? (
                  m.role === 'mentor' ? (
                    <div className="leading-relaxed">
                      <MentorRichText content={bubbleMarkdown} />
                      {showStreamCursor ? (
                        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-violet-500 align-middle" aria-hidden />
                      ) : null}
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap leading-relaxed">{bubbleMarkdown}</div>
                  )
                ) : null}

                {canImplement ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      className="text-xs font-medium text-violet-700 transition hover:text-violet-900"
                      onClick={() => {
                        if (implementation.prompt) {
                          props.onImplement?.(implementation.prompt, m.id);
                        }
                      }}
                    >
                      {props.implementingMessageId === m.id ? 'Implementeras...' : props.implementedMessageId === m.id ? 'Klart ✓' : 'Implementera →'}
                    </button>
                  </div>
                ) : null}
              </MentorMessageBubble>
              <div className={`mt-1 text-[10px] opacity-60 ${tsAlign}`}>{new Date(m.createdAt).toLocaleTimeString()}</div>
            </div>
          );
        })}

        {props.isTyping ? (
          <div className="flex flex-col items-start">
            <MentorMessageBubble role="mentor" showMentorBrand>
              <MentorTypingDots />
              {props.typingText ? (
                <div className="mt-2 text-sm text-bolt-elements-textSecondary">{props.typingText}</div>
              ) : null}
            </MentorMessageBubble>
          </div>
        ) : null}

        <div ref={endRef} />
        </div>
      </div>

      {showJumpHint && !pinnedToBottom ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
          <button
            type="button"
            onClick={jumpToLatest}
            className="pointer-events-auto rounded-full border border-[#E8E6E1] bg-white/95 px-4 py-1.5 text-xs font-medium text-[#374151] shadow-md backdrop-blur-sm transition hover:bg-violet-50"
          >
            ↓ Ny aktivitet
          </button>
        </div>
      ) : null}
    </div>
  );
}
