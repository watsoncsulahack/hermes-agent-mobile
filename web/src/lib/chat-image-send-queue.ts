const SUBMIT_KEYS = /[\r\n]/;

export function queueForScope<T>(queues: Map<string, T[]>, scope: string): T[] {
  const existing = queues.get(scope);
  if (existing) return existing;

  const queue: T[] = [];
  queues.set(scope, queue);
  return queue;
}

/**
 * Native Hermes image attachments stay queued across slash commands and are
 * consumed by the next ordinary prompt.submit call.
 */
export function shouldConsumeQueuedImages(inputData: string, draftLine: string): boolean {
  if (!SUBMIT_KEYS.test(inputData)) return false;

  const draft = draftLine.trim();
  return draft.length > 0 && !draft.startsWith("/");
}
