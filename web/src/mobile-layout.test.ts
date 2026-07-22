import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourcePath = (relative: string) =>
  fileURLToPath(new URL(relative, import.meta.url));

const css = readFileSync(sourcePath("./index.css"), "utf8");
const app = readFileSync(sourcePath("./App.tsx"), "utf8");
const chat = readFileSync(sourcePath("./pages/ChatPage.tsx"), "utf8");

describe("mobile dashboard viewport contract", () => {
  it("keeps the document viewport fixed instead of making the page a second scroller", () => {
    expect(css).toContain("height: 100dvh;");
    expect(css).toContain("max-height: 100dvh;");
    expect(css).toContain("overflow: hidden;");
    expect(css).not.toContain("overflow-y: auto;");
  });

  it("gives non-chat pages an internal scroller while keeping chat contained", () => {
    expect(app).toContain(
      'isChatRoute ? "overflow-hidden" : "overflow-y-auto overscroll-contain"',
    );
  });

  it("removes xterm 6 scrollbar chrome and contains terminal gestures", () => {
    expect(css).toContain(
      ".hermes-chat-xterm-host .xterm-scrollable-element > .scrollbar",
    );
    expect(css).toContain("display: none !important;");
    expect(css).toContain("overscroll-behavior: contain;");
    expect(css).toContain("touch-action: none;");
  });

  it("keeps the hidden xterm keyboard input at a mobile-safe focus size", () => {
    expect(css).toContain(
      ".hermes-chat-xterm-host .xterm-helper-textarea",
    );
    expect(css).toContain("font-size: 16px !important;");
  });

  it("uses an opaque background for the mobile navigation drawer", () => {
    expect(app).toContain(
      'background: isMobile\n                ? "var(--background-base)"',
    );
  });

  it("uses an opaque background for the mobile model and tools sheet", () => {
    expect(chat).toContain(
      'style={{ backgroundColor: "var(--background-base)" }}',
    );
    expect(chat).not.toContain(
      '"[background:var(--component-sidebar-background)]"',
    );
  });

  it("exposes the existing Hermes image attachment path through a picker", () => {
    expect(chat).toContain('accept="image/*"');
    expect(chat).toContain("uploadImagesRef.current?.(files)");
    expect(chat).toContain("imageInputRef.current?.click()");
  });

  it("tracks the visual viewport through every app-shell height", () => {
    expect(css).toContain("@media (max-width: 1023px)");
    expect(css).toContain(
      "var(--hermes-visual-viewport-height, 100dvh)",
    );
    expect(chat).toContain("--hermes-visual-viewport-height");
    expect(chat).toContain("term.scrollToBottom()");
    expect(app).toContain("h-full max-h-full");
    expect(app).not.toContain(
      'className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden',
    );
  });

  it("offers a distinct command palette and optional terminal extra keys", () => {
    expect(chat).toContain('aria-label="Open terminal command palette"');
    expect(chat).toContain('aria-label="Toggle terminal extra keys"');
    expect(chat).toContain('aria-label="Type slash"');
    expect(chat).toContain("terminalKeySequence(");
    expect(chat).toContain("DASHBOARD_SLASH_COMMANDS");
  });

  it("keeps copy-last-response in the mobile chat toolbar instead of floating over the terminal", () => {
    const toolbarStart = chat.indexOf(
      '<div className="flex shrink-0 items-center gap-1.5">',
    );
    const toolbarEnd = chat.indexOf("setEnd(null)", toolbarStart);
    const toolbar = chat.slice(toolbarStart, toolbarEnd);
    expect(toolbar).toContain('aria-label="Copy last assistant response"');
    expect(toolbar).toContain('<Copy className="h-4 w-4" />');
    expect(chat).not.toContain('"absolute z-10"');
  });

  it("keeps the active prompt pinned through the Android keyboard animation", () => {
    expect(chat).toContain("shouldRevealTerminalInput(");
    expect(chat).toContain("terminalFocusIntentUntilMs");
    expect(chat).toContain("[80, 180, 320]");
  });

  it("supports two-finger terminal text scaling", () => {
    expect(chat).toContain("terminalScaleFromPinch(");
    expect(chat).toContain("pinchDistance(");
    expect(chat).toContain("terminalFontSizeWithScale(");
    expect(chat).toContain("terminalRenderDirty = true");
    expect(chat).toContain("syncTerminalMetrics();");
    expect(chat).toContain("pinchResizePending = true");
    expect(chat).toContain("pinchState?.wasAtBottom");
    expect(chat).toContain("if (pinchState || pinchResizePending) return");
  });
});
