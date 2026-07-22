export type TerminalKeyboardRevealState = {
  textareaFocused: boolean;
  focusIntentUntilMs: number;
  nowMs: number;
};

export function shouldRevealTerminalInput({
  textareaFocused,
  focusIntentUntilMs,
  nowMs,
}: TerminalKeyboardRevealState): boolean {
  return textareaFocused || nowMs <= focusIntentUntilMs;
}
