interface ImageAttachmentSocket {
  readonly readyState: number;
  send(message: string): void;
}

type Delay = (milliseconds: number) => Promise<void>;

const WEBSOCKET_OPEN = 1;

/**
 * Paste staged image paths into the native TUI without disturbing its current
 * composer draft. Hermes' bracketed-paste handler recognizes image paths and
 * queues them for the next prompt. The caller owns the queue so unconsumed
 * paths can be retried from the next socket's `open` handler.
 */
export async function flushImageAttachmentQueue(
  queue: string[],
  socket: ImageAttachmentSocket | null,
  delay: Delay,
): Promise<number> {
  if (!socket || socket.readyState !== WEBSOCKET_OPEN) return 0;

  let sent = 0;
  while (queue.length > 0 && socket.readyState === WEBSOCKET_OPEN) {
    const path = queue[0];
    socket.send(`\x1b[200~${path}\x1b[201~`);
    queue.shift();
    sent += 1;
    await delay(40);
  }
  return sent;
}
