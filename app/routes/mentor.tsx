import { json, type MetaFunction } from '@remix-run/cloudflare';
import { useNavigate } from '@remix-run/react';
import { Header } from '~/components/header/Header';
import { useAuth } from '~/lib/auth/AuthContext';
import { FEATURE_FLAGS } from '~/config/feature-flags';
import { useEffect, useMemo, useRef, useState } from 'react';
import { listProjects } from '~/lib/projects/api.client';
import type { Project } from '~/lib/projects/types';
import { MentorMessageList, type MentorChatMessage } from '~/components/mentor/MentorMessageList';
import { MentorMessageInput } from '~/components/mentor/MentorMessageInput';
import { MentorTopBar } from '~/components/mentor/MentorTopBar';
import { hydrateMentorUnread, setMentorUnread } from '~/lib/stores/mentor-unread';
import type { MentorDocumentFormat } from '~/components/mentor/DocumentCard';
import { CREDIT_REFRESH_EVENT } from '~/components/credits/CreditDisplay';
import {
  mentorAsk,
  readMentorMessages,
  appendMentorMessage,
  readDailyPriority,
  generateDailyPriority,
  toggleDailyPriority,
  runMilestoneCheck,
  runHealthCheckIn,
  runMentorHealthAnalysis,
  setMentorUnreadState,
  readBrainState,
  runBrainIngestion,
  readBrainDebug,
  readVerticalContext,
  runVerticalExtract,
  type MentorAskAttachmentPayload,
  type MentorHealthAnalysisMetric,
} from '~/lib/mentor/api.client';

function hasProjectAnalyzedEvent(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const latestEvents = Array.isArray((value as { latestEvents?: unknown[] }).latestEvents)
    ? ((value as { latestEvents?: unknown[] }).latestEvents ?? [])
    : [];

  return latestEvents.some((event) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      return false;
    }

    return (event as { type?: unknown }).type === 'project.analyzed';
  });
}

export const meta: MetaFunction = () => {
  return [{ title: 'Mentor — Ridvan' }];
};

export async function loader() {
  return json({});
}

function healthStatusCopy(status: MentorHealthAnalysisMetric['status']) {
  if (status === 'good') {
    return 'Det går bra';
  }

  if (status === 'risk') {
    return 'Detta kräver din uppmärksamhet';
  }

  return 'Håll koll på detta';
}

function healthStatusAccent(status: MentorHealthAnalysisMetric['status']) {
  if (status === 'good') {
    return 'bg-emerald-500';
  }

  if (status === 'risk') {
    return 'bg-red-500';
  }

  return 'bg-amber-400';
}

function healthStatusSurface(status: MentorHealthAnalysisMetric['status']) {
  if (status === 'good') {
    return 'bg-emerald-500/10 text-emerald-700';
  }

  if (status === 'risk') {
    return 'bg-red-500/10 text-red-700';
  }

  return 'bg-amber-400/15 text-amber-800';
}

export default function MentorRoute() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;
  const navigate = useNavigate();
  const showHealthControls = FEATURE_FLAGS.mentorHealth;
  const showDailyPriorityControls = FEATURE_FLAGS.mentorDailyPriority;
  const enableMilestones = FEATURE_FLAGS.mentorMilestones;
  const enableHealthCheckIn = FEATURE_FLAGS.mentorHealthCheckIn;
  const enableDocumentGeneration = FEATURE_FLAGS.documentGeneration;

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [messages, setMessages] = useState<MentorChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [eventsWritten, setEventsWritten] = useState<number | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingText, setThinkingText] = useState('Analyserar...');
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [brainPreview, setBrainPreview] = useState<unknown>(null);
  const [brainDebug, setBrainDebug] = useState<unknown>(null);
  const [verticalText, setVerticalText] = useState('');
  const [verticalContext, setVerticalContext] = useState<unknown>(null);
  const [verticalNeedsGeo, setVerticalNeedsGeo] = useState<string>('');
  const [isVerticalRunning, setIsVerticalRunning] = useState(false);
  const [opportunityContext, setOpportunityContext] = useState<unknown>(null);
  const [conversationSessionId, setConversationSessionId] = useState<string>('');

  const [dailyPriority, setDailyPriority] = useState<null | { id: string; priority_text: string; date: string; completed: boolean }>(null);
  const [isDailyPriorityLoading, setIsDailyPriorityLoading] = useState(false);

  const [isHealthOpen, setIsHealthOpen] = useState(false);
  const [healthMetrics, setHealthMetrics] = useState<MentorHealthAnalysisMetric[]>([]);
  const [healthTopAction, setHealthTopAction] = useState('');
  const [healthRecordedAt, setHealthRecordedAt] = useState('');
  const [healthError, setHealthError] = useState('');
  const [isHealthAnalyzing, setIsHealthAnalyzing] = useState(false);
  const [visibleHealthMetricCount, setVisibleHealthMetricCount] = useState(0);
  const [pendingAttachments, setPendingAttachments] = useState<MentorAskAttachmentPayload[]>([]);
  const [isAutoIntroLoading, setIsAutoIntroLoading] = useState(false);
  const [hasLoadedMentorMessages, setHasLoadedMentorMessages] = useState(false);
  const [hasStoredMentorMessages, setHasStoredMentorMessages] = useState(false);
  const [implementingMessageId, setImplementingMessageId] = useState<string | null>(null);
  const [implementedMessageId, setImplementedMessageId] = useState<string | null>(null);

  const autoIntroAttemptedRef = useRef<Set<string>>(new Set());

  const canSend = Boolean(accessToken && selectedProjectId && (draft.trim().length > 0 || pendingAttachments.length > 0) && !isSending);

  useEffect(() => {
    if (!accessToken) {
      setProjects([]);
      setSelectedProjectId('');
      setMessages([]);
      setDraft('');
      setError('');
      return;
    }

    try {
      (window as any).__RIDVAN_PROJECT_ID__ = selectedProjectId;
    } catch {
      // ignore
    }

    listProjects(accessToken)
      .then((items) => {
        setProjects(items);
        if (!selectedProjectId && items.length > 0) {
          setSelectedProjectId(items[0].id);
        }
      })
      .catch(() => {
        setProjects([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    try {
      (window as any).__RIDVAN_PROJECT_ID__ = selectedProjectId;
    } catch {
      // ignore
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (!isHealthOpen || healthMetrics.length === 0) {
      setVisibleHealthMetricCount(0);
      return;
    }

    setVisibleHealthMetricCount(0);

    const timeouts = healthMetrics.map((_, index) =>
      window.setTimeout(() => {
        setVisibleHealthMetricCount((prev) => Math.max(prev, index + 1));
      }, index * 100),
    );

    return () => {
      timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [healthMetrics, isHealthOpen]);

  useEffect(() => {
    if (!selectedProjectId) {
      setConversationSessionId('');
      return;
    }

    try {
      const storageKey = `ridvan:mentor-session:${selectedProjectId}`;
      const existing = window.localStorage.getItem(storageKey);
      if (existing && existing.trim().length > 0) {
        setConversationSessionId(existing);
        return;
      }

      const nextSessionId = crypto.randomUUID();
      window.localStorage.setItem(storageKey, nextSessionId);
      setConversationSessionId(nextSessionId);
    } catch {
      setConversationSessionId(crypto.randomUUID());
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }
    hydrateMentorUnread();
    setMentorUnread(selectedProjectId, false);

    if (accessToken) {
      setMentorUnreadState(accessToken, selectedProjectId, false).catch(() => {
        // ignore
      });
    }
  }, [selectedProjectId]);

  const selectedProject = useMemo(() => projects.find((p) => p.id === selectedProjectId) ?? null, [projects, selectedProjectId]);

  useEffect(() => {
    if (!accessToken || !selectedProjectId) {
      setBrainPreview(null);
      setBrainDebug(null);
      setVerticalContext(null);
      setVerticalNeedsGeo('');
      setOpportunityContext(null);
      setDailyPriority(null);
      setMessages([]);
      setHasLoadedMentorMessages(false);
      setHasStoredMentorMessages(false);
      setIsAutoIntroLoading(false);
      setDraft('');
      setError('');
      return;
    }

    readMentorMessages(accessToken, selectedProjectId)
      .then((res) => {
        const rows = Array.isArray(res.messages) ? res.messages : [];
        setHasLoadedMentorMessages(true);
        setHasStoredMentorMessages(rows.length > 0);
        if (rows.length === 0) {
          setMessages([
            {
              id: `system-${selectedProjectId}`,
              role: 'system',
              content: 'Beskriv läget i bolaget just nu, vad du vill uppnå, och vad som känns mest oklart.',
              createdAt: new Date().toISOString(),
            },
          ]);
          return;
        }

        const latestSessionId = [...rows].reverse().find((row) => typeof row.session_id === 'string' && row.session_id.trim().length > 0)?.session_id ?? null;
        if (latestSessionId) {
          setConversationSessionId(latestSessionId);
          try {
            window.localStorage.setItem(`ridvan:mentor-session:${selectedProjectId}`, latestSessionId);
          } catch {
            // ignore
          }
        }

        setMessages(
          rows.map((r) => ({
            id: r.id,
            role: r.role === 'user' ? ('user' as const) : ('mentor' as const),
            content: r.content,
            createdAt: r.created_at,
          })),
        );
      })
      .catch(() => {
        setHasLoadedMentorMessages(true);
        setHasStoredMentorMessages(false);
        setMessages([
          {
            id: `system-${selectedProjectId}`,
            role: 'system',
            content: 'Beskriv läget i bolaget just nu, vad du vill uppnå, och vad som känns mest oklart.',
            createdAt: new Date().toISOString(),
          },
        ]);
      });

    readBrainState(accessToken, selectedProjectId)
      .then(setBrainPreview)
      .catch(() => {
        setBrainPreview(null);
      });

    readBrainDebug(accessToken, selectedProjectId)
      .then(setBrainDebug)
      .catch(() => {
        setBrainDebug(null);
      });

    readVerticalContext(accessToken, selectedProjectId)
      .then(setVerticalContext)
      .catch(() => {
        setVerticalContext(null);
      });

    if (showDailyPriorityControls) {
      readDailyPriority(accessToken, selectedProjectId)
        .then((res) => setDailyPriority(res.priority))
        .catch(() => {
          setDailyPriority(null);
        });
    } else {
      setDailyPriority(null);
    }

    if (enableMilestones) {
      runMilestoneCheck(accessToken, selectedProjectId)
        .then((res) => {
          const items = Array.isArray(res.milestones) ? res.milestones : [];
          if (items.length === 0) {
            return;
          }
          setMessages((prev) => [
            ...prev,
            ...items.map((m) => ({
              id: `milestone-${Date.now()}-${Math.random().toString(16).slice(2)}`,
              role: 'mentor' as const,
              content: String(m.message ?? ''),
              createdAt: new Date().toISOString(),
            })),
          ]);
        })
        .catch(() => {
          // ignore
        });
    }

    if (enableHealthCheckIn) {
      runHealthCheckIn(accessToken, selectedProjectId)
        .then((res) => {
          const items = Array.isArray(res.messages) ? res.messages : [];
          if (items.length === 0) {
            return;
          }
          setMessages((prev) => [
            ...prev,
            ...items.map((msg) => ({
              id: `health-${Date.now()}-${Math.random().toString(16).slice(2)}`,
              role: 'mentor' as const,
              content: String(msg ?? ''),
              createdAt: new Date().toISOString(),
            })),
          ]);
        })
        .catch(() => {
          // ignore
        });
    }

    fetch(`/api/opportunity/context/${encodeURIComponent(selectedProjectId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setOpportunityContext(data);
      })
      .catch(() => {
        setOpportunityContext(null);
      });
  }, [accessToken, selectedProjectId, enableHealthCheckIn, enableMilestones, showDailyPriorityControls]);

  useEffect(() => {
    if (!accessToken || !selectedProjectId || !conversationSessionId || !hasLoadedMentorMessages || hasStoredMentorMessages) {
      return;
    }

    if (!hasProjectAnalyzedEvent(brainDebug)) {
      return;
    }

    if (autoIntroAttemptedRef.current.has(selectedProjectId)) {
      return;
    }

    autoIntroAttemptedRef.current.add(selectedProjectId);
    setIsAutoIntroLoading(true);

    const systemInstruction = `Det här är första gången användaren öppnar Mentor för detta projekt.
Du är deras AI co-founder. Du har redan analyserat deras byggda projekt.
Gör följande i ditt första meddelande:
1. Presentera dig kort som deras co-founder — en mening max
2. Ge 3 konkreta observationer om deras byggda projekt baserat på projektanalys
3. Identifiera den viktigaste möjligheten att tjäna mer pengar just nu
4. Identifiera den viktigaste risken eller det som saknas
5. Avsluta med EN konkret fråga — inte flera
Håll det under 150 ord. Direkt och konkret. Aldrig generiskt.`;

    void mentorAsk(accessToken, {
      projectId: selectedProjectId,
      message: 'Skapa första proaktiva kontakt för detta projekt.',
      sessionId: conversationSessionId,
      systemInstruction,
    })
      .then(async (res) => {
        const mentorText = typeof res.reply === 'string' ? res.reply.trim() : '';
        if (!mentorText) {
          return;
        }

        const createdAt = new Date().toISOString();
        await appendMentorMessage(accessToken, {
          projectId: selectedProjectId,
          role: 'mentor',
          content: mentorText,
          createdAt,
          sessionId: conversationSessionId,
        });

        setHasStoredMentorMessages(true);
        setMessages((prev) => {
          const filtered = prev.filter((message) => !(message.role === 'system' && message.id === `system-${selectedProjectId}`));
          return [
            ...filtered,
            {
              id: `mentor-first-${selectedProjectId}`,
              role: 'mentor',
              content: mentorText,
              createdAt,
            },
          ];
        });
      })
      .catch(() => undefined)
      .finally(() => {
        setIsAutoIntroLoading(false);
      });
  }, [accessToken, brainDebug, conversationSessionId, hasLoadedMentorMessages, hasStoredMentorMessages, selectedProjectId]);

  const onGenerateDailyPriority = async () => {
    if (!accessToken || !selectedProjectId) {
      return;
    }

    setIsDailyPriorityLoading(true);
    setError('');
    try {
      const res = await generateDailyPriority(accessToken, selectedProjectId);
      setDailyPriority(res.priority);

      const text = String(res.priority?.priority_text ?? '').trim();
      if (text.length > 0) {
        const metaMatch = /(\bPåverkar\b[^.\n]+|\b(påverkar|påverka)\b[^.\n]+)$/i.exec(text);
        const meta = metaMatch ? metaMatch[0] : 'Tar max 2 timmar · Påverkar revenue/cost/risk';
        setMessages((prev) => [
          ...prev,
          {
            id: `priority-${Date.now()}`,
            role: 'mentor',
            content: '',
            createdAt: new Date().toISOString(),
            priorityCard: {
              title: '📌 Dagens prioritet',
              actionText: text,
              meta,
            },
          },
        ]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Daily priority failed';
      setError(msg);
    } finally {
      setIsDailyPriorityLoading(false);
    }
  };

  const onToggleDailyPriority = async (completed: boolean) => {
    if (!accessToken || !selectedProjectId) {
      return;
    }

    setError('');
    try {
      const res = await toggleDailyPriority(accessToken, selectedProjectId, completed);
      setDailyPriority(res.priority);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Daily priority update failed';
      setError(msg);
    }
  };

  const onSend = async () => {
    if (!accessToken || !selectedProjectId) {
      return;
    }

    const text = draft.trim();
    if (!text && pendingAttachments.length === 0) {
      return;
    }

    if (text.startsWith('/doc')) {
      if (!enableDocumentGeneration) {
        setError('Dokumentgenerering är avstängd för MVP.');
        return;
      }

      setDraft('');
      setIsSending(true);
      setError('');

      try {
        const parts = text.split(' ').filter(Boolean);
        const docType = (parts[1] ?? 'business_summary').trim();
        const instructions = parts.slice(2).join(' ').trim();

        const res = await fetch('/api/documents/generate', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ projectId: selectedProjectId, documentType: docType, instructions }),
        });

        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) {
          throw new Error(typeof json?.error === 'string' ? json.error : '[RIDVAN-E981] Document generation failed');
        }

        const title = typeof json?.title === 'string' ? json.title : 'Document';
        const documentType = typeof json?.type === 'string' ? json.type : docType;
        const content = typeof json?.content === 'string' ? json.content : '';

        const docMsg: MentorChatMessage = {
          id: `doc-${Date.now()}`,
          role: 'mentor',
          content: 'Klart — redo att ladda ner.',
          createdAt: new Date().toISOString(),
          documentCard: {
            title,
            documentType,
            formats: documentType.includes('budget') || documentType.includes('cashflow') ? ['xlsx', 'pptx'] : ['pdf', 'docx', 'pptx'],
            content,
          },
        };

        setMessages((prev) => [...prev, docMsg]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Document generation failed';
        setError(msg);
      } finally {
        setIsSending(false);
      }

      return;
    }

    const userMsgCreatedAt = new Date().toISOString();

    if (text) {
      const userMsg: MentorChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text,
        createdAt: userMsgCreatedAt,
      };
      setMessages((prev) => [...prev, userMsg]);
      appendMentorMessage(accessToken, {
        projectId: selectedProjectId,
        role: 'user',
        content: text,
        createdAt: userMsgCreatedAt,
        sessionId: conversationSessionId,
      }).catch(() => {
        // ignore
      });
    }
    setDraft('');
    const attachmentsForRequest = [...pendingAttachments];
    setPendingAttachments([]);

    setIsSending(true);
    setIsThinking(true);
    setThinkingText(attachmentsForRequest.length > 0 ? 'Läser dokumentet och analyserar...' : 'Analyserar...');
    setError('');

    try {
      const res = await mentorAsk(accessToken, {
        projectId: selectedProjectId,
        message: text || 'Analysera den bifogade filen åt mig.',
        sessionId: conversationSessionId,
        attachments: attachmentsForRequest,
      });
      setEventsWritten(typeof res.eventsWritten === 'number' ? res.eventsWritten : null);

      const mentorText = typeof res.reply === 'string' ? res.reply : '';
      const events = Array.isArray(res.events) ? res.events : [];

      const docMessages: MentorChatMessage[] = [];
      for (const ev of events) {
        if (String(ev.type).trim() !== 'document.ready') {
          continue;
        }

        const payload = ev.payload ?? {};
        const title = typeof payload.title === 'string' ? payload.title : 'Document';
        const documentType = typeof payload.documentType === 'string' ? payload.documentType : 'document';
        const content = typeof payload.content === 'string' ? payload.content : '';
        const formatsRaw = Array.isArray(payload.formats) ? payload.formats : [];
        const formats = formatsRaw
          .map((f) => String(f).toLowerCase().trim())
          .filter((f): f is MentorDocumentFormat => f === 'pdf' || f === 'docx' || f === 'xlsx' || f === 'pptx');

        docMessages.push({
          id: `doc-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          role: 'mentor',
          content: '',
          createdAt: new Date().toISOString(),
          documentCard: {
            title,
            documentType,
            formats: formats.length > 0 ? formats : ['pdf'],
            content,
          },
        });
      }

      if (mentorText.trim().length > 0 || events.some((ev) => String(ev.type).trim() === 'document.ready')) {
        window.dispatchEvent(new Event(CREDIT_REFRESH_EVENT));
      }

      const messagesToAppend: MentorChatMessage[] = [];

      if (docMessages.length > 0) {
        const trimmedReply = mentorText.trim();
        if (trimmedReply.length > 0) {
          docMessages[0] = { ...docMessages[0], content: trimmedReply };
        }
        messagesToAppend.push(...docMessages);
      } else if (mentorText.trim().length > 0) {
        messagesToAppend.push({
          id: `mentor-${Date.now()}`,
          role: 'mentor',
          content: mentorText,
          createdAt: new Date().toISOString(),
        });
      }

      if (messagesToAppend.length > 0) {
        setMessages((prev) => [...prev, ...messagesToAppend]);

        for (const m of messagesToAppend) {
          const storageText =
            typeof m.content === 'string' && m.content.trim().length > 0
              ? m.content
              : m.documentCard
                ? `Dokument: ${m.documentCard.title}`
                : m.priorityCard
                  ? m.priorityCard.actionText
                  : '';

          if (storageText.trim().length === 0) {
            continue;
          }

          appendMentorMessage(accessToken, {
            projectId: selectedProjectId,
            role: 'mentor',
            content: storageText,
            createdAt: m.createdAt,
            sessionId: conversationSessionId,
          }).catch(() => {
            // ignore
          });
        }
      }

      if (enableMilestones) {
        runMilestoneCheck(accessToken, selectedProjectId)
          .then((milestoneRes) => {
            const items = Array.isArray(milestoneRes.milestones) ? milestoneRes.milestones : [];
            if (items.length === 0) {
              return;
            }
            setMessages((prev) => [
              ...prev,
              ...items.map((m) => ({
                id: `milestone-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                role: 'mentor' as const,
                content: String(m.message ?? ''),
                createdAt: new Date().toISOString(),
              })),
            ]);
          })
          .catch(() => {
            // ignore
          });
      }

      const refreshBrain = async () => {
        const delays = [200, 500, 900];
        for (const delay of delays) {
          await new Promise((r) => setTimeout(r, delay));
          try {
            const next = await readBrainState(accessToken, selectedProjectId);
            setBrainPreview(next);
            readBrainDebug(accessToken, selectedProjectId)
              .then(setBrainDebug)
              .catch(() => {
                setBrainDebug(null);
              });
            return;
          } catch {
            // ignore
          }
        }
      };

      void refreshBrain();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Mentor request failed';
      setError(msg);
    } finally {
      setIsSending(false);
      setIsThinking(false);
      setThinkingText('Analyserar...');
    }
  };

  const onPickFile = () => {
    fileInputRef.current?.click();
  };

  const onRemovePendingAttachment = (filename: string) => {
    setPendingAttachments((prev) => prev.filter((attachment) => attachment.filename !== filename));
  };

  const onFileSelected = async (file: File | null) => {
    if (!file || !accessToken || !selectedProjectId) {
      return;
    }

    setError('');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let bin = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        bin += String.fromCharCode(...bytes.slice(i, i + chunkSize));
      }
      const dataBase64 = btoa(bin);

      const res = await fetch('/api/mentor/attachments', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId: selectedProjectId,
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          dataBase64,
        }),
      });

      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        throw new Error(typeof json?.error === 'string' ? json.error : '[RIDVAN-E982] Upload failed');
      }

      setPendingAttachments((prev) => [
        ...prev,
        {
          filename: String(json?.attachment?.filename ?? file.name),
          mimeType: String(json?.attachment?.mimeType ?? file.type ?? 'application/octet-stream'),
          url: typeof json?.attachment?.url === 'string' ? json.attachment.url : undefined,
          extractedText: typeof json?.attachment?.extractedText === 'string' ? json.attachment.extractedText : null,
          byteSize: typeof json?.attachment?.byteSize === 'number' ? json.attachment.byteSize : undefined,
          storage:
            json?.attachment?.storage && typeof json.attachment.storage === 'object'
              ? {
                  bucket: typeof json.attachment.storage.bucket === 'string' ? json.attachment.storage.bucket : undefined,
                  path: typeof json.attachment.storage.path === 'string' ? json.attachment.storage.path : undefined,
                }
              : undefined,
        },
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      setError(msg);
    }
  };

  const onRunVerticalExtract = async () => {
    if (!accessToken || !selectedProjectId) {
      return;
    }

    setIsVerticalRunning(true);
    setVerticalNeedsGeo('');
    setError('');

    try {
      const text = verticalText.trim().length > 0 ? verticalText.trim() : `Project: ${selectedProject?.title ?? selectedProjectId}`;
      const res = (await runVerticalExtract(accessToken, { projectId: selectedProjectId, text })) as any;

      const needsGeo = res?.needsUserInput?.geo;
      if (typeof needsGeo === 'string' && needsGeo.length > 0) {
        setVerticalNeedsGeo(needsGeo);
      }

      const ctx = await readVerticalContext(accessToken, selectedProjectId);
      setVerticalContext(ctx);

      fetch(`/api/opportunity/context/${encodeURIComponent(selectedProjectId)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          setOpportunityContext(data);
        })
        .catch(() => {
          setOpportunityContext(null);
        });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Vertical extract failed';
      setError(msg);
    } finally {
      setIsVerticalRunning(false);
    }
  };

  const onRunIngestion = async () => {
    if (!accessToken || !selectedProjectId) {
      return;
    }

    setIsIngesting(true);
    setIngestResult('');
    setError('');

    try {
      const res = await runBrainIngestion(accessToken, selectedProjectId);
      setIngestResult(`Ingested: ${res.ingested}`);

      const next = await readBrainState(accessToken, selectedProjectId);
      setBrainPreview(next);

      readBrainDebug(accessToken, selectedProjectId)
        .then(setBrainDebug)
        .catch(() => {
          setBrainDebug(null);
        });

      fetch(`/api/opportunity/context/${encodeURIComponent(selectedProjectId)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          setOpportunityContext(data);
        })
        .catch(() => {
          setOpportunityContext(null);
        });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ingestion failed';
      setError(msg);
    } finally {
      setIsIngesting(false);
    }
  };

  const onOpenHealth = async () => {
    if (!accessToken || !selectedProjectId) {
      return;
    }

    setIsHealthOpen(true);
    setHealthError('');
    setHealthMetrics([]);
    setHealthTopAction('');
    setHealthRecordedAt('');
    setVisibleHealthMetricCount(0);
    setIsHealthAnalyzing(true);

    try {
      const startedAt = Date.now();
      const res = await runMentorHealthAnalysis(accessToken, selectedProjectId);
      const remainingDelay = Math.max(0, 2200 - (Date.now() - startedAt));

      if (remainingDelay > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remainingDelay));
      }

      setHealthMetrics(res.metrics);
      setHealthTopAction(res.topAction);
      setHealthRecordedAt(res.recordedAt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Health load failed';
      setHealthError(msg);
    } finally {
      setIsHealthAnalyzing(false);
    }
  };

  const onTalkWithMentorAboutHealth = () => {
    setDraft('Mentor, låt oss prata om hälsokollet du just visade mig.');
    setIsHealthOpen(false);
  };

  const onImplementRecommendation = (prompt: string, messageId: string) => {
    if (!selectedProjectId || !prompt.trim()) {
      return;
    }

    setImplementingMessageId(messageId);
    setImplementedMessageId(null);

    window.setTimeout(() => {
      setImplementingMessageId(null);
      setImplementedMessageId(messageId);
      navigate(`/chat?projectId=${encodeURIComponent(selectedProjectId)}&prompt=${encodeURIComponent(prompt)}`);
      window.setTimeout(() => {
        setImplementedMessageId((current) => (current === messageId ? null : current));
      }, 2500);
    }, 350);
  };

  return (
    <div className="flex flex-col h-full w-full">
      <Header />
      <main className="flex-1 min-h-0 bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary flex flex-col">
        {!accessToken ? (
          <div className="mx-auto w-full max-w-3xl px-6 py-10">
            <p className="text-bolt-elements-textSecondary">Logga in för att använda Mentor.</p>
          </div>
        ) : (
          <>
            <MentorTopBar
              projects={projects}
              selectedProjectId={selectedProjectId}
              onSelectProjectId={setSelectedProjectId}
              canRunVertical={Boolean(accessToken && selectedProjectId)}
              canRunIngest={Boolean(accessToken && selectedProjectId)}
              isVerticalRunning={isVerticalRunning}
              isIngesting={isIngesting}
              onRunVertical={onRunVerticalExtract}
              onRunIngestion={onRunIngestion}
              showHealthControls={showHealthControls}
              onOpenHealth={onOpenHealth}
              showDailyPriorityControls={showDailyPriorityControls}
              dailyPriority={dailyPriority}
              isDailyPriorityLoading={isDailyPriorityLoading}
              onGenerateDailyPriority={onGenerateDailyPriority}
              onToggleDailyPriority={onToggleDailyPriority}
            />

            {showHealthControls && isHealthOpen ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                <button type="button" className="absolute inset-0" onClick={() => setIsHealthOpen(false)} aria-label="Close" />
                <div className="relative w-full max-w-[600px] max-h-[90vh] overflow-auto rounded-[12px] border border-black/10 bg-[#F8F7F4] p-5 shadow-2xl">
                  <button
                    type="button"
                    className="absolute right-4 top-4 text-xl text-black/50 transition hover:text-black"
                    onClick={() => setIsHealthOpen(false)}
                    aria-label="Stäng"
                  >
                    ×
                  </button>
                  <div className="flex items-center justify-between pr-8">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Hälsokoll</div>
                      <div className="mt-1 text-sm text-slate-600">En snabb, personlig koll på hur bolaget mår just nu.</div>
                    </div>
                  </div>

                  {isHealthAnalyzing ? (
                    <div className="flex min-h-[360px] flex-col items-center justify-center px-6 text-center">
                      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-pink-500 text-3xl text-white shadow-lg animate-pulse">
                        M
                      </div>
                      <div className="mt-5 text-lg font-semibold text-slate-900">Mentor analyserar ditt bolag...</div>
                      <div className="mt-2 max-w-sm text-sm text-slate-600">Jag tittar på signalerna i bolaget och kokar ner dem till det som faktiskt spelar roll just nu.</div>
                    </div>
                  ) : healthError ? (
                    <div className="mt-4 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{healthError}</div>
                  ) : (
                    <div className="mt-4">
                      <div className="grid gap-3">
                        {healthMetrics.map((metric, index) => {
                          const isVisible = index < visibleHealthMetricCount;
                          const shouldPulse = metric.status !== 'good';

                          return (
                            <div
                              key={metric.category}
                              className={`flex overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm transition-all duration-500 ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
                            >
                              <div className={`w-1.5 ${healthStatusAccent(metric.status)}`} />
                              <div className="flex-1 p-4">
                                <div className="flex items-start gap-3">
                                  <div
                                    className={`flex h-11 w-11 items-center justify-center rounded-2xl text-xl ${healthStatusSurface(metric.status)} ${shouldPulse ? 'animate-pulse' : ''}`}
                                    style={shouldPulse ? { animationDuration: metric.status === 'risk' ? '1s' : '1.8s' } : undefined}
                                  >
                                    {metric.emoji}
                                  </div>
                                  <div>
                                    <div className="text-base font-semibold text-slate-900">{metric.category}</div>
                                    <div className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{healthStatusCopy(metric.status)}</div>
                                    <div className="mt-3 text-sm leading-6 text-slate-700">{metric.message}</div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {healthTopAction ? (
                        <div className="mt-5 rounded-2xl bg-gradient-to-r from-[#7C3AED] to-[#EC4899] p-[1px] shadow-lg">
                          <div className="rounded-2xl bg-white/10 px-5 py-5 text-white backdrop-blur-sm">
                            <div className="text-sm font-semibold">Det viktigaste du kan göra just nu:</div>
                            <div className="mt-2 text-base font-medium leading-7">{healthTopAction}</div>
                          </div>
                        </div>
                      ) : null}

                      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-xs text-slate-500">
                          {healthRecordedAt ? `Analyserad ${new Date(healthRecordedAt).toLocaleString('sv-SE')}` : ''}
                        </div>
                        <button
                          type="button"
                          className="inline-flex items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg"
                          style={{ background: 'linear-gradient(135deg, #7C3AED, #EC4899)' }}
                          onClick={onTalkWithMentorAboutHealth}
                        >
                          Prata med Mentor om detta →
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            <MentorMessageList
              messages={messages}
              isTyping={isThinking || isAutoIntroLoading}
              typingText={isAutoIntroLoading ? 'Mentor analyserar ditt projekt...' : thinkingText}
              onImplement={onImplementRecommendation}
              implementingMessageId={implementingMessageId}
              implementedMessageId={implementedMessageId}
            />

            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                void onFileSelected(file);
                e.target.value = '';
              }}
            />

            <div className="border-t border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-4 py-3">
              <div className="mx-auto w-full max-w-3xl">
                {error ? (
                  <div className="mb-3 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
                ) : null}

                {verticalNeedsGeo ? (
                  <div className="mb-3 rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-4 py-3 text-sm text-bolt-elements-textSecondary">
                    {verticalNeedsGeo}
                  </div>
                ) : null}

                <details className="mb-3">
                  <summary className="cursor-pointer select-none text-sm text-bolt-elements-textSecondary">Details</summary>
                  <div className="mt-3 grid gap-3">
                    <div>
                      <div className="text-xs text-bolt-elements-textTertiary">Vertical input (optional)</div>
                      <textarea
                        rows={2}
                        className="mt-2 w-full resize-none rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-4 py-3 text-sm text-bolt-elements-textPrimary focus:outline-none"
                        value={verticalText}
                        onChange={(e) => setVerticalText(e.target.value)}
                        placeholder="T.ex: Vi är en frisörsalong i Sverige och vill ta bokningar…"
                      />
                    </div>

                    <div className="text-xs text-bolt-elements-textTertiary">Events written: {eventsWritten ?? 0}</div>
                    {ingestResult ? <div className="text-xs text-bolt-elements-textTertiary">{ingestResult}</div> : null}

                    <div className="text-xs text-bolt-elements-textTertiary">Opportunities</div>
                    <pre className="max-h-[180px] overflow-auto rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-3 text-xs text-bolt-elements-textSecondary">
                      {opportunityContext ? JSON.stringify((opportunityContext as any).opportunities ?? [], null, 2) : 'No opportunities loaded'}
                    </pre>

                    <div className="text-xs text-bolt-elements-textTertiary">Vertical context</div>
                    <pre className="max-h-[180px] overflow-auto rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-3 text-xs text-bolt-elements-textSecondary">
                      {verticalContext ? JSON.stringify(verticalContext, null, 2) : 'No vertical context loaded'}
                    </pre>

                    <div className="text-xs text-bolt-elements-textTertiary">Brain state</div>
                    <pre className="max-h-[180px] overflow-auto rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-3 text-xs text-bolt-elements-textSecondary">
                      {brainPreview ? JSON.stringify(brainPreview, null, 2) : 'No brain state loaded'}
                    </pre>

                    <div className="text-xs text-bolt-elements-textTertiary">Brain debug</div>
                    <pre className="max-h-[180px] overflow-auto rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-3 text-xs text-bolt-elements-textSecondary">
                      {brainDebug ? JSON.stringify(brainDebug, null, 2) : 'No debug loaded'}
                    </pre>
                  </div>
                </details>
              </div>
            </div>

            <MentorMessageInput
              value={draft}
              onChange={setDraft}
              onSend={onSend}
              onPickFile={onPickFile}
              pendingAttachments={pendingAttachments.map((attachment) => ({ filename: attachment.filename }))}
              onRemovePendingAttachment={onRemovePendingAttachment}
              inputDisabled={!Boolean(accessToken && selectedProjectId)}
              sendDisabled={!canSend}
            />
          </>
        )}
      </main>
    </div>
  );
}
