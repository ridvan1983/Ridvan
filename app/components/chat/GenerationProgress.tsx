import { useStore } from '@nanostores/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { workbenchStore } from '~/lib/stores/workbench';

interface GenerationProgressProps {
  isStreaming: boolean;
}

const POLL_INTERVAL_MS = 500;
const DONE_VISIBLE_MS = 1000;

function getPhaseMessage(): string {
  const artifacts = workbenchStore.artifacts.get();

  for (const artifactId of [...workbenchStore.artifactIdList].reverse()) {
    const artifact = artifacts[artifactId];

    if (!artifact) {
      continue;
    }

    const actions = Object.values(artifact.runner.actions.get());
    const fileActions = actions.filter((action) => action.type === 'file');
    const shellActions = actions.filter((action) => action.type === 'shell');

    const hasInstallAction = shellActions.some((action) => action.content.toLowerCase().includes('install'));
    const hasStartPreviewAction = shellActions.some((action) => {
      const content = action.content.toLowerCase();
      return content.includes('npm run dev') || content.includes('pnpm dev') || content.includes('npm start') || content.includes('pnpm start');
    });

    if (hasStartPreviewAction) {
      return 'Starting preview...';
    }

    if (hasInstallAction) {
      return 'Installing dependencies...';
    }

    if (fileActions.length > 1) {
      return 'Writing components...';
    }

    if (fileActions.length > 0) {
      return 'Setting up project...';
    }
  }

  return 'Analyzing your prompt...';
}

export default function GenerationProgress({ isStreaming }: GenerationProgressProps) {
  useStore(workbenchStore.artifacts);
  const [message, setMessage] = useState('Analyzing your prompt...');
  const [showDone, setShowDone] = useState(false);
  const doneTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (doneTimeoutRef.current !== null) {
      window.clearTimeout(doneTimeoutRef.current);
      doneTimeoutRef.current = null;
    }

    if (isStreaming) {
      setShowDone(false);
      setMessage(getPhaseMessage());

      const intervalId = window.setInterval(() => {
        setMessage(getPhaseMessage());
      }, POLL_INTERVAL_MS);

      return () => {
        window.clearInterval(intervalId);
      };
    }

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
      <div className="w-full max-w-chat mx-auto px-4 pb-2 text-xs text-bolt-elements-textTertiary">
        <span>{showDone ? 'Done!' : message}</span>
        {isStreaming ? dots : null}
      </div>
    </>
  );
}
