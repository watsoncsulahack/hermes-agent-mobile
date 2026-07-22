import { describe, expect, it } from "vitest";

import { ptyAttachStorageKey } from "./pty-attach-identity";

describe("ptyAttachStorageKey", () => {
  it("uses a different keep-alive identity for each resumed session", () => {
    expect(ptyAttachStorageKey("", "session-a")).not.toBe(
      ptyAttachStorageKey("", "session-b"),
    );
  });

  it("separates fresh chats and profiles from resumed sessions", () => {
    expect(ptyAttachStorageKey("", null)).not.toBe(
      ptyAttachStorageKey("", "session-a"),
    );
    expect(ptyAttachStorageKey("work", "session-a")).not.toBe(
      ptyAttachStorageKey("", "session-a"),
    );
  });
});
