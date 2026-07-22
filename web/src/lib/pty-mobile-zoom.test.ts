import { describe, expect, it } from "vitest";

import {
  pinchDistance,
  terminalFontSizeWithScale,
  terminalScaleFromPinch,
} from "./pty-mobile-zoom";

describe("mobile terminal pinch scaling", () => {
  it("measures the distance between two touches", () => {
    expect(
      pinchDistance(
        { clientX: 0, clientY: 0 },
        { clientX: 30, clientY: 40 },
      ),
    ).toBe(50);
  });

  it("spreads fingers to increase terminal scale", () => {
    expect(terminalScaleFromPinch(1, 100, 150)).toBe(1.5);
  });

  it("pinches fingers together to decrease terminal scale", () => {
    expect(terminalScaleFromPinch(1, 100, 80)).toBe(0.8);
  });

  it("clamps scale to readable limits", () => {
    expect(terminalScaleFromPinch(1, 100, 10)).toBe(0.7);
    expect(terminalScaleFromPinch(1, 100, 500)).toBe(2.2);
  });

  it("scales and rounds the rendered terminal font", () => {
    expect(terminalFontSizeWithScale(9, 1.5)).toBe(13.5);
    expect(terminalFontSizeWithScale(7, 0.7)).toBe(6);
    expect(terminalFontSizeWithScale(14, 2.2)).toBe(24);
  });
});
