import { describe, expect, it } from "vitest";

import {
  beginTerminalTouch,
  moveTerminalTouch,
  stepTerminalTouchInertia,
  type TerminalTouchState,
} from "./pty-mobile-scroll";

describe("mobile terminal touch scrolling", () => {
  it("scrolls toward newer output when a finger moves upward", () => {
    const state = beginTerminalTouch(200, 0);
    const result = moveTerminalTouch(state, 170, 10, 30);

    expect(result.lines).toBe(3);
    expect(result.state.lastY).toBe(170);
  });

  it("scrolls toward older output when a finger moves downward", () => {
    const state = beginTerminalTouch(100, 0);
    const result = moveTerminalTouch(state, 130, 10, 30);

    expect(result.lines).toBe(-3);
  });

  it("accumulates sub-cell movement so slow swipes remain responsive", () => {
    let state: TerminalTouchState = beginTerminalTouch(200, 0);

    const first = moveTerminalTouch(state, 194, 10, 20);
    expect(first.lines).toBe(0);

    state = first.state;
    const second = moveTerminalTouch(state, 188, 10, 40);
    expect(second.lines).toBe(1);
    expect(second.state.remainderPx).toBe(2);
  });

  it("ignores invalid cell heights", () => {
    const state = beginTerminalTouch(100, 0);
    const result = moveTerminalTouch(state, 50, 0, 20);

    expect(result.lines).toBe(0);
    expect(result.state.lastY).toBe(50);
  });

  it("records greater release velocity for a fast swipe", () => {
    const fast = moveTerminalTouch(beginTerminalTouch(200, 0), 100, 10, 50);
    const slow = moveTerminalTouch(beginTerminalTouch(200, 0), 100, 10, 500);

    expect(fast.state.velocityPxPerMs).toBeGreaterThan(
      slow.state.velocityPxPerMs,
    );
  });

  it("continues a fast swipe with decaying momentum", () => {
    const result = stepTerminalTouchInertia(
      { velocityPxPerMs: 2, remainderPx: 0 },
      50,
      10,
    );

    expect(result.lines).toBeGreaterThan(0);
    expect(result.state.velocityPxPerMs).toBeLessThan(2);
  });
});
