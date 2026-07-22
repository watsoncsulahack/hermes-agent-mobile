export interface TerminalTouchState {
  lastY: number;
  remainderPx: number;
  lastAtMs: number;
  velocityPxPerMs: number;
}

export interface TerminalInertiaState {
  velocityPxPerMs: number;
  remainderPx: number;
}

export function beginTerminalTouch(
  clientY: number,
  atMs: number,
): TerminalTouchState {
  return {
    lastY: clientY,
    remainderPx: 0,
    lastAtMs: atMs,
    velocityPxPerMs: 0,
  };
}

export function moveTerminalTouch(
  state: TerminalTouchState,
  clientY: number,
  cellHeightPx: number,
  atMs: number,
): { lines: number; state: TerminalTouchState } {
  const movementPx = state.lastY - clientY;
  const deltaPx = movementPx + state.remainderPx;
  const elapsedMs = Math.max(1, atMs - state.lastAtMs);
  const velocityPxPerMs =
    state.velocityPxPerMs * 0.25 + (movementPx / elapsedMs) * 0.75;
  if (!Number.isFinite(cellHeightPx) || cellHeightPx <= 0) {
    return {
      lines: 0,
      state: {
        lastY: clientY,
        remainderPx: 0,
        lastAtMs: atMs,
        velocityPxPerMs,
      },
    };
  }

  const lines = Math.trunc(deltaPx / cellHeightPx);
  return {
    lines,
    state: {
      lastY: clientY,
      remainderPx: deltaPx - lines * cellHeightPx,
      lastAtMs: atMs,
      velocityPxPerMs,
    },
  };
}

export function stepTerminalTouchInertia(
  state: TerminalInertiaState,
  elapsedMs: number,
  cellHeightPx: number,
): { lines: number; state: TerminalInertiaState } {
  if (cellHeightPx <= 0 || elapsedMs <= 0) {
    return { lines: 0, state };
  }

  const deltaPx = state.velocityPxPerMs * elapsedMs + state.remainderPx;
  const lines = Math.trunc(deltaPx / cellHeightPx);
  return {
    lines,
    state: {
      velocityPxPerMs:
        state.velocityPxPerMs * Math.exp(-0.004 * elapsedMs),
      remainderPx: deltaPx - lines * cellHeightPx,
    },
  };
}
