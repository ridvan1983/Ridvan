import type { Message } from 'ai';
import { useCallback, useState } from 'react';
import { StreamingMessageParser } from '~/lib/runtime/message-parser';
import { workbenchStore } from '~/lib/stores/workbench';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('useMessageParser');
const DEBUG = import.meta.env?.VITE_RIDVAN_DEBUG === '1';

const debugLog = (...args: any[]) => {
  if (DEBUG) {
    console.log('[RIDVAN DEBUG][parser]', ...args);
  }
};

const messageParser = new StreamingMessageParser({
  callbacks: {
    onArtifactOpen: (data) => {
      logger.trace('onArtifactOpen', data);
      debugLog('onArtifactOpen', { messageId: data.messageId, artifactId: data.id, title: data.title });

      workbenchStore.showWorkbench.set(true);
      workbenchStore.addArtifact(data);
    },
    onArtifactClose: (data) => {
      logger.trace('onArtifactClose');
      debugLog('onArtifactClose', { messageId: data.messageId, artifactId: data.id });

      workbenchStore.updateArtifact(data, { closed: true });
    },
    onActionOpen: (data) => {
      logger.trace('onActionOpen', data.action);
      debugLog('onActionOpen', { messageId: data.messageId, actionId: data.actionId, type: data.action.type });

      // we only add shell actions when when the close tag got parsed because only then we have the content
      if (data.action.type !== 'shell') {
        workbenchStore.addAction(data);
      }
    },
    onActionClose: (data) => {
      logger.trace('onActionClose', data.action);
      debugLog('onActionClose', { messageId: data.messageId, actionId: data.actionId, type: data.action.type });

      if (data.action.type === 'shell') {
        workbenchStore.addAction(data);
      }

      workbenchStore.runAction(data);
    },
  },
});

export function useMessageParser() {
  const [parsedMessages, setParsedMessages] = useState<{ [key: number]: string }>({});

  const parseMessages = useCallback((messages: Message[], isLoading: boolean) => {
    let reset = false;
    debugLog('parseMessages:start', { count: messages.length, isLoading });

    if (import.meta.env.DEV && !isLoading) {
      reset = true;
      messageParser.reset();
    }

    for (const [index, message] of messages.entries()) {
      if (message.role === 'assistant') {
        debugLog('parseMessages:assistantMessage', { index, messageId: message.id, length: message.content.length });
        const newParsedContent = messageParser.parse(message.id, message.content);
        debugLog('parseMessages:parsed', { index, messageId: message.id, parsedLength: newParsedContent.length });

        setParsedMessages((prevParsed) => ({
          ...prevParsed,
          [index]: !reset ? (prevParsed[index] || '') + newParsedContent : newParsedContent,
        }));
      }
    }
    debugLog('parseMessages:done', { count: messages.length, isLoading });
  }, []);

  return { parsedMessages, parseMessages };
}
