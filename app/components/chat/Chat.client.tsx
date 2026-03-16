import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import { useChat } from 'ai/react';
import { useAnimate } from 'framer-motion';
import { useSearchParams } from '@remix-run/react';
import { memo, useEffect, useRef, useState } from 'react';
import { cssTransition, toast, ToastContainer } from 'react-toastify';
import { MAX_FIX_ATTEMPTS } from '~/config/constants';
import { useAuth } from '~/lib/auth/AuthContext';
import { useMessageParser, usePromptEnhancer, useShortcuts, useSnapScroll } from '~/lib/hooks';
import { useChatHistory } from '~/lib/persistence';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { fileModificationsToHTML } from '~/utils/diff';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import OutOfCreditsModal from '~/components/credits/OutOfCreditsModal';
import { BaseChat } from './BaseChat';
import GenerationProgress from './GenerationProgress';

const toastAnimation = cssTransition({
  enter: 'animated fadeInRight',
  exit: 'animated fadeOutRight',
});

const logger = createScopedLogger('Chat');

export function Chat() {
  renderLogger.trace('Chat');

  const { ready, initialMessages, storeMessageHistory } = useChatHistory();

  return (
    <>
      {ready && <ChatImpl initialMessages={initialMessages} storeMessageHistory={storeMessageHistory} />}
      <ToastContainer
        closeButton={({ closeToast }) => {
          return (
            <button className="Toastify__close-button" onClick={closeToast}>
              <div className="i-ph:x text-lg" />
            </button>
          );
        }}
        icon={({ type }) => {
          /**
           * @todo Handle more types if we need them. This may require extra color palettes.
           */
          switch (type) {
            case 'success': {
              return <div className="i-ph:check-bold text-bolt-elements-icon-success text-2xl" />;
            }
            case 'error': {
              return <div className="i-ph:warning-circle-bold text-bolt-elements-icon-error text-2xl" />;
            }
          }

          return undefined;
        }}
        position="bottom-right"
        pauseOnFocusLoss
        transition={toastAnimation}
      />
    </>
  );
}

interface ChatProps {
  initialMessages: Message[];
  storeMessageHistory: (messages: Message[]) => Promise<void>;
}

export const ChatImpl = memo(({ initialMessages, storeMessageHistory }: ChatProps) => {
  useShortcuts();
  const { session } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fixAttemptCount = useRef(0);
  const buildPollIntervalRef = useRef<number | null>(null);
  const buildPollStartTimeoutRef = useRef<number | null>(null);
  const buildPollStopTimeoutRef = useRef<number | null>(null);
  const autoSubmittedRef = useRef(false);

  const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);
  const [showOutOfCredits, setShowOutOfCredits] = useState(false);
  const [overloadMessage, setOverloadMessage] = useState<string | null>(null);

  const { showChat } = useStore(chatStore);

  const [animationScope, animate] = useAnimate();

  const getAndClearBuildError = () => {
    return null;
  };

  const clearBuildErrorPolling = () => {
    if (buildPollStartTimeoutRef.current !== null) {
      window.clearTimeout(buildPollStartTimeoutRef.current);
      buildPollStartTimeoutRef.current = null;
    }

    if (buildPollIntervalRef.current !== null) {
      window.clearInterval(buildPollIntervalRef.current);
      buildPollIntervalRef.current = null;
    }

    if (buildPollStopTimeoutRef.current !== null) {
      window.clearTimeout(buildPollStopTimeoutRef.current);
      buildPollStopTimeoutRef.current = null;
    }
  };

  const { messages, isLoading, input, handleInputChange, setInput, stop, append } = useChat({
    api: '/api/chat',
    headers: session?.access_token
      ? {
          Authorization: `Bearer ${session.access_token}`,
        }
      : undefined,
    onResponse: async (response) => {
      const ct = response.headers.get('content-type') ?? '';
      const isJson = ct.includes('application/json');

      if (!isJson && response.status !== 503) {
        return;
      }

      try {
        const data = (await response.clone().json().catch(() => null)) as
          | {
              type?: string;
              message?: string;
              error?: { code?: string; message?: string };
            }
          | null;
        const isOverloaded = data?.type === 'overloaded_error' || data?.error?.code === 'LLM_OVERLOADED';

        if (isOverloaded || response.status === 503) {
          const overloadText =
            data?.error?.message ?? data?.message ?? 'Model is temporarily overloaded. Please try again in a moment.';
          setOverloadMessage(overloadText);
          throw new Error(`LLM_OVERLOADED: ${overloadText}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? '');

        if (message.includes('LLM_OVERLOADED')) {
          throw error;
        }

        if (response.status === 503) {
          setOverloadMessage('Model is temporarily overloaded. Please try again in a moment.');
          throw new Error('LLM_OVERLOADED: Model is temporarily overloaded. Please try again in a moment.');
        }
      }
    },
    onError: (error) => {
      logger.error('Request failed\n\n', error);
      const rawMessage = (error as any)?.message ?? (error as any)?.cause?.message;
      if (typeof rawMessage === 'string' && rawMessage.includes('LLM_OVERLOADED')) {
        const text = rawMessage.replace(/^LLM_OVERLOADED:\s*/i, '').trim();
        setOverloadMessage(text || 'Model is temporarily overloaded. Please try again in a moment.');
        return;
      }

      const status =
        (error as any)?.status ??
        (error as any)?.statusCode ??
        (error as any)?.cause?.status ??
        (error as any)?.cause?.statusCode;

      if (status === 503) {
        const code = (error as any)?.cause?.error?.code ?? (error as any)?.error?.code;
        const message =
          (error as any)?.cause?.error?.message ??
          (error as any)?.error?.message ??
          'Model is temporarily overloaded. Please try again in a moment.';

        if (code === 'LLM_OVERLOADED' || String(message).toLowerCase().includes('overload')) {
          setOverloadMessage(message);
          return;
        }
      }

      if (status === 403) {
        setShowOutOfCredits(true);
        return;
      }

      toast.error('There was an error processing your request');
    },
    onFinish: () => {
      logger.debug('Finished streaming');

      clearBuildErrorPolling();

      const checkBuildErrorAndRetry = async () => {
        const buildError = getAndClearBuildError();

        if (!buildError) {
          return;
        }

        clearBuildErrorPolling();

        if (fixAttemptCount.current < MAX_FIX_ATTEMPTS) {
          fixAttemptCount.current++;

          await append({
            role: 'user',
            content: `The build failed with the following error:\n\`\`\`\n${buildError}\n\`\`\`\nPlease fix the code to resolve this error. Only fix the broken file(s), do not regenerate the entire project.`,
          });
          return;
        }

        toast.error(`Build failed after ${MAX_FIX_ATTEMPTS} attempts. Check the error in the terminal.`);
        fixAttemptCount.current = 0;
      };

      buildPollStartTimeoutRef.current = window.setTimeout(() => {
        checkBuildErrorAndRetry();

        buildPollIntervalRef.current = window.setInterval(() => {
          checkBuildErrorAndRetry();
        }, 2000);
      }, 3000);

      buildPollStopTimeoutRef.current = window.setTimeout(() => {
        clearBuildErrorPolling();

        if (fixAttemptCount.current > 0) {
          fixAttemptCount.current = 0;
        }
      }, 30000);
    },
    initialMessages,
  });

  const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
  const { parsedMessages, parseMessages } = useMessageParser();

  const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

  useEffect(() => {
    chatStore.setKey('started', initialMessages.length > 0);
  }, []);

  useEffect(() => {
    parseMessages(messages, isLoading);

    if (messages.length > initialMessages.length) {
      storeMessageHistory(messages).catch((error) => toast.error(error.message));
    }
  }, [messages, isLoading, parseMessages]);

  useEffect(() => {
    return () => {
      clearBuildErrorPolling();
    };
  }, []);

  useEffect(() => {
    const promptParam = searchParams.get('prompt');

    if (!promptParam?.trim() || autoSubmittedRef.current || !session?.access_token) {
      return;
    }

    autoSubmittedRef.current = true;

    const timeoutId = window.setTimeout(async () => {
      runAnimation();
      await append({ role: 'user', content: promptParam });
      setSearchParams({}, { replace: true });
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [append, searchParams, session?.access_token, setSearchParams]);

  const scrollTextArea = () => {
    const textarea = textareaRef.current;

    if (textarea) {
      textarea.scrollTop = textarea.scrollHeight;
    }
  };

  const abort = () => {
    stop();
    chatStore.setKey('aborted', true);
    workbenchStore.abortAllActions();
  };

  useEffect(() => {
    const textarea = textareaRef.current;

    if (textarea) {
      textarea.style.height = 'auto';

      const scrollHeight = textarea.scrollHeight;

      textarea.style.height = `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
      textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
    }
  }, [input, textareaRef]);

  const runAnimation = async () => {
    if (chatStarted) {
      return;
    }

    try {
      const animations = [];

      if (animationScope.current?.querySelector('#examples')) {
        animations.push(animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }));
      }

      if (animationScope.current?.querySelector('#intro')) {
        animations.push(animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }));
      }

      if (animations.length > 0) {
        await Promise.all(animations);
      }
    } catch (error) {
      console.warn('[RIDVAN] Animation skipped:', error);
    }

    chatStore.setKey('started', true);

    setChatStarted(true);
  };

  const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
    const _input = messageInput || input;

    if (_input.length === 0 || isLoading) {
      return;
    }

    /**
     * @note (delm) Usually saving files shouldn't take long but it may take longer if there
     * many unsaved files. In that case we need to block user input and show an indicator
     * of some kind so the user is aware that something is happening. But I consider the
     * happy case to be no unsaved files and I would expect users to save their changes
     * before they send another message.
     */
    await workbenchStore.saveAllFiles();

    const fileModifications = workbenchStore.getFileModifcations();
    setShowOutOfCredits(false);
    setOverloadMessage(null);

    fixAttemptCount.current = 0;
    clearBuildErrorPolling();

    chatStore.setKey('aborted', false);

    runAnimation();

    if (fileModifications !== undefined) {
      const diff = fileModificationsToHTML(fileModifications);

      /**
       * If we have file modifications we append a new user message manually since we have to prefix
       * the user input with the file modifications and we don't want the new user input to appear
       * in the prompt. Using `append` is almost the same as `handleSubmit` except that we have to
       * manually reset the input and we'd have to manually pass in file attachments. However, those
       * aren't relevant here.
       */
      append({ role: 'user', content: `${diff}\n\n${_input}` });

      /**
       * After sending a new message we reset all modifications since the model
       * should now be aware of all the changes.
       */
      workbenchStore.resetAllFileModifications();
    } else {
      append({ role: 'user', content: _input });
    }

    setInput('');

    resetEnhancer();

    textareaRef.current?.blur();
  };

  const [messageRef, scrollRef] = useSnapScroll();

  return (
    <>
      <BaseChat
        ref={animationScope}
        textareaRef={textareaRef}
        input={input}
        showChat={showChat}
        chatStarted={chatStarted}
        isStreaming={isLoading}
        enhancingPrompt={enhancingPrompt}
        promptEnhanced={promptEnhanced}
        sendMessage={sendMessage}
        messageRef={messageRef}
        scrollRef={scrollRef}
        handleInputChange={handleInputChange}
        handleStop={abort}
        messages={[
          ...messages.map((message, i) => {
            if (message.role === 'user') {
              return message;
            }

            return {
              ...message,
              content: parsedMessages[i] || '',
            };
          }),
          ...(overloadMessage
            ? ([
                {
                  id: 'llm-overloaded',
                  role: 'assistant',
                  content: overloadMessage,
                },
              ] as Message[])
            : []),
        ]}
        enhancePrompt={() => {
          if (!input.trim()) {
            toast.error('Write a prompt first.');
            textareaRef.current?.focus();
            return;
          }

          enhancePrompt(input, (input) => {
            setInput(input);
            scrollTextArea();
          }, session?.access_token);
        }}
        generationProgress={<GenerationProgress isStreaming={isLoading} />}
      />
      <OutOfCreditsModal isOpen={showOutOfCredits} onClose={() => setShowOutOfCredits(false)} />
    </>
  );
});
