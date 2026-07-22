import { describe, expect, it } from "vitest";

import { queueForScope, shouldConsumeQueuedImages } from "./chat-image-send-queue";

describe("queueForScope", () => {
  it("keeps pending images isolated by logical chat", () => {
    const queues = new Map<string, string[]>();
    queueForScope(queues, "session-a").push("a.png");

    expect(queueForScope(queues, "session-a")).toEqual(["a.png"]);
    expect(queueForScope(queues, "session-b")).toEqual([]);
  });
});

describe("shouldConsumeQueuedImages", () => {
  it("consumes queued images when an ordinary prompt is submitted", () => {
    expect(shouldConsumeQueuedImages("\r", "What is shown here?")).toBe(true);
  });

  it("keeps queued images across slash commands", () => {
    expect(shouldConsumeQueuedImages("\r", "/help")).toBe(false);
    expect(shouldConsumeQueuedImages("\r", "  /model gpt-5  ")).toBe(false);
  });

  it("does not consume images for typing or an empty submission", () => {
    expect(shouldConsumeQueuedImages("hello", "hello")).toBe(false);
    expect(shouldConsumeQueuedImages("\r", "   ")).toBe(false);
  });
});
