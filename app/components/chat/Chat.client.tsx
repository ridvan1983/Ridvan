import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import { useChat } from 'ai/react';
import { useAnimate } from 'framer-motion';
import { useLocation, useNavigate, useSearchParams } from '@remix-run/react';
import { memo, useEffect, useRef, useState } from 'react';
import { cssTransition, toast, ToastContainer } from 'react-toastify';
import { MAX_FIX_ATTEMPTS } from '~/config/constants';
import { useAuth } from '~/lib/auth/AuthContext';
import { useMessageParser, usePromptEnhancer, useShortcuts, useSnapScroll } from '~/lib/hooks';
import { useChatHistory } from '~/lib/persistence';
import { createSnapshot, getLatestSnapshot, upsertProject } from '~/lib/projects/api.client';
import { ensurePreviewRunning } from '~/lib/projects/auto-preview.client';
import { collectTextFiles, restoreSnapshotFiles } from '~/lib/projects/snapshot.client';
import { organismAccessToken, organismProjectId, organismPreviewReadyAt, organismVerticalCardShownForProject } from '~/lib/stores/organism';
import {
  createChatSession,
  getChatSession,
  listChatSessions,
  updateChatSessionMessages,
} from '~/lib/projects/chat-sessions.api.client';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { fileModificationsToHTML } from '~/utils/diff';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { CREDIT_REFRESH_EVENT } from '~/components/credits/CreditDisplay';
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
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const workbenchFiles = useStore(workbenchStore.files);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fixAttemptCount = useRef(0);
  const buildPollIntervalRef = useRef<number | null>(null);
  const buildPollStartTimeoutRef = useRef<number | null>(null);
  const buildPollStopTimeoutRef = useRef<number | null>(null);
  const autoSubmittedRef = useRef(false);
  const initialSnapshotSavedRef = useRef(false);
  const latestFilesRef = useRef(workbenchFiles);
  const projectIdRef = useRef<string | null>(searchParams.get('projectId'));
  const projectSessionIdRef = useRef<string | null>(searchParams.get('sessionId'));
  const initialProjectChatLoadedRef = useRef(false);
  const projectUpsertedRef = useRef(false);

  const ensureProjectSessionId = async (projectId: string, titleHint?: string): Promise<string | null> => {
    if (!session?.access_token) {
      return null;
    }

    const existing = projectSessionIdRef.current ?? searchParams.get('sessionId');
    if (existing?.trim()) {
      return existing;
    }

    try {
      const created = await createChatSession(session.access_token, projectId, {
        title: titleHint?.slice(0, 80) ?? null,
      });

      projectSessionIdRef.current = created.id;
      initialProjectChatLoadedRef.current = true;
      setMessages(created.messages ?? []);

      const nextParams = new URLSearchParams(searchParams);
      nextParams.set('sessionId', created.id);
      setSearchParams(nextParams, { replace: true });

      return created.id;
    } catch (error) {
      logger.error('Failed to create project chat session', error);
      return null;
    }
  };

  const saveInitialSnapshotWithRetry = async (projectId: string) => {
    if (!session?.access_token) {
      return;
    }

    const startedAt = Date.now();
    const timeoutMs = 15000;
    const intervalMs = 750;

    while (Date.now() - startedAt < timeoutMs) {
      const filesPayload = collectTextFiles(latestFilesRef.current);
      const hasFiles = Object.keys(filesPayload).length > 0;

      if (!hasFiles) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, intervalMs));
        continue;
      }

      await createSnapshot(session.access_token, {
        projectId,
        title: null,
        files: filesPayload,
      });

      initialSnapshotSavedRef.current = true;
      return;
    }
  };

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

  const { messages, isLoading, input, handleInputChange, setInput, stop, append, setMessages } = useChat({
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
    onFinish: async () => {
      logger.debug('Finished streaming');

      const projectIdParam = projectIdRef.current;
      if (projectIdParam?.trim() && session?.access_token && !initialSnapshotSavedRef.current) {
        try {
          await saveInitialSnapshotWithRetry(projectIdParam);

          if (!initialSnapshotSavedRef.current) {
            toast.warn('Project created, but snapshot could not be saved');
          }
        } catch (error) {
          logger.error('Failed to save initial snapshot', error);
          toast.warn('Project created, but snapshot could not be saved');
        }
      }

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

  useEffect(() => {
    latestFilesRef.current = workbenchFiles;
  }, [workbenchFiles]);

  useEffect(() => {
    // Canonicalize any client-side navigation that lands on /chat/:slug
    // so we always use query-param URLs for project workspaces.
    const projectId = searchParams.get('projectId');
    if (!projectId?.trim()) {
      return;
    }

    if (location.pathname.startsWith('/chat/') && location.pathname !== '/chat') {
      const nextSearch = searchParams.toString();
      navigate(`/chat${nextSearch ? `?${nextSearch}` : ''}`, { replace: true });
    }
  }, [location.pathname, navigate, searchParams]);

  useEffect(() => {
    projectIdRef.current = searchParams.get('projectId');
    projectSessionIdRef.current = searchParams.get('sessionId');
    organismProjectId.set(projectIdRef.current);
    organismPreviewReadyAt.set(null);
    organismVerticalCardShownForProject.set(null);

    // If projectId changes, we should re-ensure Supabase persistence.
    projectUpsertedRef.current = false;
  }, [searchParams]);

  useEffect(() => {
    organismAccessToken.set(session?.access_token ?? null);

    return () => {
      organismAccessToken.set(null);
    };
  }, [session?.access_token]);

  useEffect(() => {
    const stripeCheckoutSessionId = searchParams.get('session_id');
    if (!stripeCheckoutSessionId?.trim()) {
      return;
    }

    const refresh = () => {
      window.dispatchEvent(new Event(CREDIT_REFRESH_EVENT));
    };

    refresh();
    const t1 = window.setTimeout(refresh, 1500);
    const t2 = window.setTimeout(refresh, 4000);

    const next = new URLSearchParams(searchParams);
    next.delete('session_id');
    setSearchParams(next, { replace: true });

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const projectIdParam = searchParams.get('projectId');
    const sessionIdParam = searchParams.get('sessionId');

    if (!projectIdParam?.trim() || !session?.access_token) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const detail = sessionIdParam?.trim()
          ? await getChatSession(session.access_token, projectIdParam, sessionIdParam)
          : null;

        if (cancelled) {
          return;
        }

        if (detail) {
          setMessages(detail.messages ?? []);
          initialProjectChatLoadedRef.current = true;
          return;
        }

        const sessions = await listChatSessions(session.access_token, projectIdParam);
        if (cancelled) {
          return;
        }

        const latest = sessions[0];
        if (latest) {
          const loaded = await getChatSession(session.access_token, projectIdParam, latest.id);
          if (cancelled) {
            return;
          }
          const nextParams = new URLSearchParams(searchParams);
          nextParams.set('sessionId', latest.id);
          setSearchParams(nextParams, { replace: true });
          setMessages(loaded.messages ?? []);
          initialProjectChatLoadedRef.current = true;
          return;
        }

        const created = await createChatSession(session.access_token, projectIdParam);
        if (cancelled) {
          return;
        }

        const nextParams = new URLSearchParams(searchParams);
        nextParams.set('sessionId', created.id);
        setSearchParams(nextParams, { replace: true });
        setMessages(created.messages ?? []);
        initialProjectChatLoadedRef.current = true;
      } catch (error) {
        logger.error('Failed to load project chat session', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, session?.access_token, setMessages, setSearchParams]);

  useEffect(() => {
    const projectIdParam = searchParams.get('projectId');
    const sessionIdParam = searchParams.get('sessionId');

    if (!projectIdParam?.trim() || !sessionIdParam?.trim() || !session?.access_token) {
      return;
    }

    if (!initialProjectChatLoadedRef.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      // Keep supabase session messages in sync for project workspaces.
      updateChatSessionMessages(session.access_token!, projectIdParam, sessionIdParam, {
        title: null,
        messages,
      }).catch((error) => {
        logger.error('Failed to persist project chat session', error);
      });
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [messages, searchParams, session?.access_token]);

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

    const timeoutId = window.setTimeout(async () => {
      runAnimation();

      const ensured = await ensureProjectId(promptParam);
      if (!ensured) {
        toast.error('Could not save project to cloud. Please try again.');
        return;
      }

      projectIdRef.current = ensured;

      const ensuredSessionId = await ensureProjectSessionId(ensured, promptParam);
      if (!ensuredSessionId) {
        toast.error('Could not save project chat to cloud. Please try again.');
        return;
      }

      const next = new URLSearchParams(searchParams);
      next.delete('prompt');
      next.set('projectId', ensured);
      next.set('sessionId', ensuredSessionId);
      setSearchParams(next, { replace: true });

      try {
        await append({ role: 'user', content: promptParam });
        autoSubmittedRef.current = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? '');
        toast.error(message ? `Build failed: ${message}` : 'Build failed');
        autoSubmittedRef.current = false;
      }
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [append, searchParams, session?.access_token, setSearchParams]);

  const ensureProjectId = async (titleHint?: string): Promise<string | null> => {
    if (!session?.access_token) {
      return null;
    }

    const existing = searchParams.get('projectId');
    if (existing?.trim()) {
      // Landing page can provide a client-generated id. We still must upsert it
      // in Supabase before we can create project sessions/snapshots.
      if (!projectUpsertedRef.current) {
        try {
          await upsertProject(session.access_token, { id: existing, title: titleHint?.slice(0, 80) ?? null });
          projectUpsertedRef.current = true;
          toast.success('Project saved');
        } catch (error) {
          logger.error('Failed to upsert project', error);
          toast.error('Could not save project to cloud');
          return null;
        }
      }

      return existing;
    }

    let id = '';
    try {
      id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : '';
    } catch {
      id = '';
    }

    if (!id) {
      // Very small UUIDv4 fallback; good enough for client-side id generation.
      id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
        const r = Math.floor(Math.random() * 16);
        const v = ch === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    }

    try {
      await upsertProject(session.access_token, { id, title: titleHint?.slice(0, 80) ?? null });
      projectUpsertedRef.current = true;
      toast.success('Project saved');
      return id;
    } catch (error) {
      logger.error('Failed to upsert project', error);
      toast.error('Could not save project to cloud');
      return null;
    }
  };

  useEffect(() => {
    const projectIdParam = searchParams.get('projectId');

    if (!projectIdParam?.trim() || !session?.access_token) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        // Show workspace immediately; snapshot/preview will hydrate in background.
        chatStore.setKey('started', true);
        setChatStarted(true);
        workbenchStore.showWorkbench.set(true);
        workbenchStore.currentView.set('preview');

        const snapshot = await getLatestSnapshot(session.access_token, projectIdParam);

        if (cancelled) {
          return;
        }

        if (!snapshot) {
          toast.error('This project has no saved snapshot yet.');
          workbenchStore.currentView.set('code');
          return;
        }

        await restoreSnapshotFiles(snapshot.files);
        await ensurePreviewRunning();

        if (cancelled) {
          return;
        }

        chatStore.setKey('started', true);
        setChatStarted(true);
        workbenchStore.showWorkbench.set(true);
        workbenchStore.currentView.set('preview');
      } catch (error) {
        logger.error('Failed to open project snapshot', error);
        toast.error('Failed to open project');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, session?.access_token]);

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

    const ensured = await ensureProjectId(_input);
    if (!ensured) {
      toast.error('Could not save project to cloud. Please try again.');
      return;
    }

    projectIdRef.current = ensured;

    const ensuredSessionId = await ensureProjectSessionId(ensured, _input);
    if (!ensuredSessionId) {
      toast.error('Could not save project chat to cloud. Please try again.');
      return;
    }

    const next = new URLSearchParams(searchParams);
    next.set('projectId', ensured);
    next.set('sessionId', ensuredSessionId);
    setSearchParams(next, { replace: true });

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
      await append({ role: 'user', content: `${diff}\n\n${_input}` });

      /**
       * After sending a new message we reset all modifications since the model
       * should now be aware of all the changes.
       */
      workbenchStore.resetAllFileModifications();
    } else {
      await append({ role: 'user', content: _input });
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
