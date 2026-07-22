export type TerminalModifierState = {
  control: boolean;
  alt: boolean;
};

const KEY_SEQUENCES = {
  slash: "/",
  escape: "\u001b",
  tab: "\t",
  up: "\u001b[A",
  down: "\u001b[B",
  right: "\u001b[C",
  left: "\u001b[D",
} as const;

export type TerminalExtraKey = keyof typeof KEY_SEQUENCES;

const NAV_DIRECTION: Partial<Record<TerminalExtraKey, string>> = {
  up: "A",
  down: "B",
  right: "C",
  left: "D",
};

export function terminalKeySequence(
  key: TerminalExtraKey,
  modifiers: TerminalModifierState = { control: false, alt: false },
): string {
  const direction = NAV_DIRECTION[key];
  if (direction && (modifiers.control || modifiers.alt)) {
    const modifier = 1 + (modifiers.alt ? 2 : 0) + (modifiers.control ? 4 : 0);
    return `\u001b[1;${modifier}${direction}`;
  }
  return KEY_SEQUENCES[key];
}

export function applyTerminalModifiers(
  data: string,
  modifiers: TerminalModifierState,
): string {
  if (data.length !== 1) return data;
  let output = data;
  if (modifiers.control) {
    const code = data.toUpperCase().charCodeAt(0);
    if (code >= 64 && code <= 95) output = String.fromCharCode(code & 31);
  }
  if (modifiers.alt) output = `\u001b${output}`;
  return output;
}
