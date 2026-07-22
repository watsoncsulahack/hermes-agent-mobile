import { describe, expect, it } from "vitest";

import {
  applyTerminalModifiers,
  terminalKeySequence,
} from "./pty-extra-keys";

describe("mobile terminal extra keys", () => {
  it("emits standard terminal sequences for navigation and literal keys", () => {
    expect(terminalKeySequence("slash")).toBe("/");
    expect(terminalKeySequence("up")).toBe("\u001b[A");
    expect(terminalKeySequence("down")).toBe("\u001b[B");
    expect(terminalKeySequence("right")).toBe("\u001b[C");
    expect(terminalKeySequence("left")).toBe("\u001b[D");
    expect(terminalKeySequence("escape")).toBe("\u001b");
    expect(terminalKeySequence("tab")).toBe("\t");
  });

  it("combines control and alt with navigation keys", () => {
    expect(terminalKeySequence("up", { control: true, alt: false })).toBe("\u001b[1;5A");
    expect(terminalKeySequence("left", { control: false, alt: true })).toBe("\u001b[1;3D");
    expect(terminalKeySequence("right", { control: true, alt: true })).toBe("\u001b[1;7C");
  });

  it("applies a sticky control modifier to a printable key", () => {
    expect(applyTerminalModifiers("c", { control: true, alt: false })).toBe("\u0003");
  });

  it("applies a sticky alt modifier as an escape prefix", () => {
    expect(applyTerminalModifiers("x", { control: false, alt: true })).toBe("\u001bx");
  });

  it("leaves multi-character mobile replacement input intact", () => {
    expect(applyTerminalModifiers("campus", { control: true, alt: true })).toBe("campus");
  });

  it("supports combined control and alt modifiers", () => {
    expect(applyTerminalModifiers("c", { control: true, alt: true })).toBe("\u001b\u0003");
  });
});
