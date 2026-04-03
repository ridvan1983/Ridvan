import { MentorMessageList, type MentorChatMessage } from './MentorMessageList';

export type { MentorChatMessage };

/**
 * Conversation surface for Mentor (streaming-aware wrapper around the message list).
 */
export function MentorChat(props: {
  messages: MentorChatMessage[];
  isTyping: boolean;
  typingText?: string;
  streamingMessageId?: string | null;
  isStreamingAssistant?: boolean;
  awaitingFirstStreamToken?: boolean;
  onImplement?: (prompt: string, messageId: string) => void;
  implementingMessageId?: string | null;
  implementedMessageId?: string | null;
}) {
  return (
    <MentorMessageList
      messages={props.messages}
      isTyping={props.isTyping}
      typingText={props.typingText}
      streamingMessageId={props.streamingMessageId}
      isStreamingAssistant={props.isStreamingAssistant}
      awaitingFirstStreamToken={props.awaitingFirstStreamToken}
      onImplement={props.onImplement}
      implementingMessageId={props.implementingMessageId}
      implementedMessageId={props.implementedMessageId}
    />
  );
}
