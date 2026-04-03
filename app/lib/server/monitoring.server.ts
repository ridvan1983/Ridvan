import { supabaseAdmin } from '~/lib/supabase/server';

export interface ErrorContext {
  route?: string;
  userId?: string;
  extra?: Record<string, unknown>;
}

export type LogPersistOptions = {
  stack?: string;
  route?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeUserId(value: string | undefined): string | null {
  if (!value || !UUID_RE.test(value)) {
    return null;
  }

  return value;
}

function persistToErrorLogs(level: 'error' | 'warning', message: string, options?: LogPersistOptions): void {
  void (async () => {
    try {
      const trimmedMessage = message.length > 10000 ? `${message.slice(0, 10000)}…` : message;
      const stack =
        options?.stack && options.stack.length > 50000 ? `${options.stack.slice(0, 50000)}…` : options?.stack ?? null;

      await supabaseAdmin.from('error_logs').insert({
        level,
        message: trimmedMessage,
        stack,
        route: options?.route ? options.route.slice(0, 500) : null,
        user_id: safeUserId(options?.userId),
        metadata: options?.metadata ?? null,
      });
    } catch {
      // Never throw from logging
    }
  })();
}

/** Persists to `error_logs` via service role. Never throws. */
export function logError(message: string, options?: LogPersistOptions): void {
  persistToErrorLogs('error', message, options);
}

/** Persists to `error_logs` with level warning. Never throws. */
export function logWarning(message: string, options?: LogPersistOptions): void {
  persistToErrorLogs('warning', message, options);
}

export function captureError(error: unknown, context?: ErrorContext) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  console.error('[RIDVAN_ERROR]', {
    message,
    stack,
    route: context?.route,
    userId: context?.userId,
    extra: context?.extra,
    timestamp: new Date().toISOString(),
  });
}

export function captureMessage(message: string, context?: ErrorContext) {
  console.log('[RIDVAN_INFO]', {
    message,
    route: context?.route,
    userId: context?.userId,
    timestamp: new Date().toISOString(),
  });
}
