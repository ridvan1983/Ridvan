export interface ErrorContext {
  route?: string;
  userId?: string;
  extra?: Record<string, unknown>;
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
