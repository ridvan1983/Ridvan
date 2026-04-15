import { useStore } from '@nanostores/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActionState } from '~/lib/runtime/action-runner';
import { workbenchStore } from '~/lib/stores/workbench';

interface GenerationProgressProps {
  isStreaming: boolean;
}

const POLL_INTERVAL_MS = 500;
const DONE_VISIBLE_MS = 1000;
const SLOW_AFTER_MS = 30_000;
const PROMPT_ANALYSIS_MS = 4_000;

type PhaseInfo = {
  title: string;
  eta?: string;
};

function getWorkbenchPhase(): PhaseInfo | null {
  const artifacts = workbenchStore.artifacts.get();

  for (const artifactId of [...workbenchStore.artifactIdList].reverse()) {
    const artifact = artifacts[artifactId];

    if (!artifact) {
      continue;
    }

    const actions = Object.values(artifact.runner.actions.get()) as ActionState[];
    const fileActions = actions.filter((action) => action.type === 'file');
    const shellActions = actions.filter((action) => action.type === 'shell');

    const hasInstallAction = shellActions.some((action) => action.content.toLowerCase().includes('install'));
    const hasStartPreviewAction = shellActions.some((action) => {
      const content = action.content.toLowerCase();
      return (
        content.includes('npm run dev') ||
        content.includes('pnpm dev') ||
        content.includes('npm start') ||
        content.includes('pnpm start')
      );
    });

    if (hasStartPreviewAction) {
      return { title: 'Startar preview…', eta: 'Ofta 30 s–2 min' };
    }

    if (hasInstallAction) {
      return { title: 'Installerar paket…', eta: 'Ofta 1–6 min första gången' };
    }

    if (fileActions.length > 1) {
      return { title: 'Genererar kod…', eta: 'Ofta 1–8 min' };
    }

    if (fileActions.length > 0) {
      return { title: 'Genererar kod…', eta: 'Ofta 1–8 min' };
    }
  }

  return null;
}

function getPhaseForElapsed(elapsedMs: number): PhaseInfo {
  const fromWorkbench = getWorkbenchPhase();
  if (fromWorkbench) {
    return fromWorkbench;
  }

  if (elapsedMs < PROMPT_ANALYSIS_MS) {
    return { title: 'Analyserar din prompt…', eta: 'Några sekunder' };
  }

  return { title: 'Genererar kod…', eta: 'Ofta 1–8 min' };
}

export default function GenerationProgress({ isStreaming }: GenerationProgressProps) {
  useStore(workbenchStore.artifacts);
  const [phase, setPhase] = useState<PhaseInfo>({ title: 'Analyserar din prompt…', eta: 'Några sekunder' });
  const [showDone, setShowDone] = useState(false);
  const [slowNotice, setSlowNotice] = useState(false);
  const doneTimeoutRef = useRef<number | null>(null);
  const streamStartedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (doneTimeoutRef.current !== null) {
      window.clearTimeout(doneTimeoutRef.current);
      doneTimeoutRef.current = null;
    }

    if (isStreaming) {
      if (streamStartedAtRef.current === null) {
        streamStartedAtRef.current = Date.now();
      }

      setShowDone(false);
      setSlowNotice(false);

      const tick = () => {
        const started = streamStartedAtRef.current ?? Date.now();
        const elapsed = Date.now() - started;
        setPhase(getPhaseForElapsed(elapsed));
        setSlowNotice(elapsed >= SLOW_AFTER_MS);
      };

      tick();
      const intervalId = window.setInterval(tick, POLL_INTERVAL_MS);

      return () => {
        window.clearInterval(intervalId);
      };
    }

    streamStartedAtRef.current = null;
    setSlowNotice(false);
    setShowDone(true);
    doneTimeoutRef.current = window.setTimeout(() => {
      setShowDone(false);
      doneTimeoutRef.current = null;
    }, DONE_VISIBLE_MS);

    return () => {
      if (doneTimeoutRef.current !== null) {
        window.clearTimeout(doneTimeoutRef.current);
        doneTimeoutRef.current = null;
      }
    };
  }, [isStreaming]);

  const visible = isStreaming || showDone;

  const dots = useMemo(() => {
    return (
      <span className="inline-flex items-center gap-1 ml-2" aria-hidden="true">
        <span className="h-1 w-1 rounded-full bg-bolt-elements-textTertiary animate-[generation-progress-dot_1.2s_infinite_ease-in-out]" />
        <span className="h-1 w-1 rounded-full bg-bolt-elements-textTertiary animate-[generation-progress-dot_1.2s_0.2s_infinite_ease-in-out]" />
        <span className="h-1 w-1 rounded-full bg-bolt-elements-textTertiary animate-[generation-progress-dot_1.2s_0.4s_infinite_ease-in-out]" />
      </span>
    );
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <>
      <style>{`@keyframes generation-progress-dot { 0%, 80%, 100% { opacity: 0.3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-1px); } }`}</style>
      <div className="w-full max-w-chat mx-auto px-4 pb-2 text-xs text-bolt-elements-textTertiary space-y-1">
        <div>
          <span>{showDone ? 'Klart!' : phase.title}</span>
          {isStreaming ? dots : null}
        </div>
        {!showDone && isStreaming && phase.eta ? (
          <div className="text-[11px] text-bolt-elements-textTertiary/90">Ungefärlig tid: {phase.eta}</div>
        ) : null}
        {!showDone && isStreaming && slowNotice ? (
          <div className="text-[11px] text-amber-700/90">Detta tar lite längre än vanligt…</div>
        ) : null}
      </div>
    </>
  );
}
