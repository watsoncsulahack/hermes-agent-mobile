import { describe, expect, it } from "vitest";

import { flushImageAttachmentQueue } from "./chat-image-attachment-queue";

describe("flushImageAttachmentQueue", () => {
  it("keeps uploaded paths queued while chat is disconnected", async () => {
    const queue = ["/tmp/photo.png"];

    const sent = await flushImageAttachmentQueue(queue, null, async () => {});

    expect(sent).toBe(0);
    expect(queue).toEqual(["/tmp/photo.png"]);
  });

  it("attaches queued images after a socket opens", async () => {
    const queue = ["/tmp/a.png", "/tmp/b.jpg"];
    const messages: string[] = [];
    const socket = {
      readyState: 1,
      send(message: string) {
        messages.push(message);
      },
    };

    const sent = await flushImageAttachmentQueue(queue, socket, async () => {});

    expect(sent).toBe(2);
    expect(queue).toEqual([]);
    expect(messages).toEqual([
      "\x1b[200~/tmp/a.png\x1b[201~",
      "\x1b[200~/tmp/b.jpg\x1b[201~",
    ]);
  });
});
