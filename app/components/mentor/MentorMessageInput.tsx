import { useCallback } from 'react';

export function MentorMessageInput(props: {
  value: string;
  onChange: (next: string) => void;
  onSend: () => void;
  onPickFile?: () => void;
  pendingAttachments?: Array<{ filename: string }>;
  onRemovePendingAttachment?: (filename: string) => void;
  inputDisabled: boolean;
  sendDisabled: boolean;
}) {
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!props.sendDisabled) {
          props.onSend();
        }
      }
    },
    [props],
  );

  return (
    <div className="border-t border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-4 py-4">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        {props.pendingAttachments && props.pendingAttachments.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {props.pendingAttachments.map((attachment) => (
              <div
                key={attachment.filename}
                className="inline-flex items-center gap-2 rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm text-bolt-elements-textPrimary"
              >
                <span>📎 {attachment.filename}</span>
                <button
                  type="button"
                  onClick={() => props.onRemovePendingAttachment?.(attachment.filename)}
                  disabled={props.inputDisabled}
                  className="text-bolt-elements-textSecondary transition hover:text-bolt-elements-textPrimary disabled:opacity-60"
                  aria-label={`Remove ${attachment.filename}`}
                  title={`Remove ${attachment.filename}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-3">
        <button
          type="button"
          onClick={props.onPickFile}
          disabled={props.inputDisabled || !props.onPickFile}
          className="h-[44px] w-[44px] flex items-center justify-center rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary disabled:opacity-60"
          aria-label="Attach file"
          title="Attach file"
        >
          📎
        </button>
        <textarea
          rows={2}
          className="min-h-[44px] flex-1 resize-none rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-4 py-3 text-sm text-bolt-elements-textPrimary focus:outline-none"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Write a message…"
          disabled={props.inputDisabled}
        />
        <button
          onClick={props.onSend}
          disabled={props.sendDisabled}
          className="rounded-2xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          style={{ backgroundImage: 'linear-gradient(90deg, var(--bolt-color-accent), var(--bolt-color-accent))' }}
        >
          Send
        </button>
        </div>
      </div>
      <div className="mx-auto mt-2 w-full max-w-3xl text-[11px] text-bolt-elements-textTertiary">
        Enter to send, Shift+Enter for new line
      </div>
    </div>
  );
}
