import { describe, expect, it } from "vitest";

import { shouldRevealTerminalInput } from "./pty-keyboard-viewport";

describe("terminal keyboard viewport reveal", () => {
  it("reveals the input when xterm's textarea is focused", () => {
    expect(
      shouldRevealTerminalInput({
        textareaFocused: true,
        focusIntentUntilMs: 0,
        nowMs: 100,
      }),
    ).toBe(true);
  });

  it("reveals during the short tap-to-keyboard race before focus settles", () => {
    expect(
      shouldRevealTerminalInput({
        textareaFocused: false,
        focusIntentUntilMs: 2_000,
        nowMs: 1_500,
      }),
    ).toBe(true);
  });

  it("preserves deliberate scrollback for unrelated viewport changes", () => {
    expect(
      shouldRevealTerminalInput({
        textareaFocused: false,
        focusIntentUntilMs: 1_000,
        nowMs: 1_001,
      }),
    ).toBe(false);
  });
});
