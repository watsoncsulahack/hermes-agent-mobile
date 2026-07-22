export interface TouchPoint {
  clientX: number;
  clientY: number;
}

const MIN_TERMINAL_SCALE = 0.7;
const MAX_TERMINAL_SCALE = 2.2;
const MIN_TERMINAL_FONT_PX = 6;
const MAX_TERMINAL_FONT_PX = 24;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function pinchDistance(a: TouchPoint, b: TouchPoint): number {
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

export function terminalScaleFromPinch(
  startScale: number,
  startDistance: number,
  currentDistance: number,
): number {
  if (startDistance <= 0 || !Number.isFinite(currentDistance)) {
    return startScale;
  }
  return clamp(
    startScale * (currentDistance / startDistance),
    MIN_TERMINAL_SCALE,
    MAX_TERMINAL_SCALE,
  );
}

export function terminalFontSizeWithScale(
  baseFontPx: number,
  scale: number,
): number {
  const scaled = clamp(
    baseFontPx * scale,
    MIN_TERMINAL_FONT_PX,
    MAX_TERMINAL_FONT_PX,
  );
  return Math.round(scaled * 2) / 2;
}
