import { describe, expect, it } from "vitest";

import { DASHBOARD_SLASH_COMMANDS, filterSlashCommands } from "./pty-command-menu";

describe("dashboard slash command menu", () => {
  it("offers a useful scrollable-sized command catalog", () => {
    expect(DASHBOARD_SLASH_COMMANDS.length).toBeGreaterThanOrEqual(20);
    expect(DASHBOARD_SLASH_COMMANDS.some((item) => item.command === "/help")).toBe(true);
    expect(DASHBOARD_SLASH_COMMANDS.some((item) => item.command === "/model")).toBe(true);
    expect(DASHBOARD_SLASH_COMMANDS.some((item) => item.command === "/image")).toBe(true);
  });

  it("filters by command and description without case sensitivity", () => {
    expect(filterSlashCommands("MODEL").map((item) => item.command)).toContain("/model");
    expect(filterSlashCommands("new session").map((item) => item.command)).toContain("/new");
  });
});
