export type DashboardSlashCommand = {
  command: string;
  description: string;
  category: "Session" | "Model" | "Tools" | "Utility";
  acceptsArgument?: boolean;
};

export const DASHBOARD_SLASH_COMMANDS: DashboardSlashCommand[] = [
  { command: "/new", description: "Start a new session", category: "Session" },
  { command: "/resume", description: "Resume a named session", category: "Session", acceptsArgument: true },
  { command: "/title", description: "Name the current session", category: "Session", acceptsArgument: true },
  { command: "/branch", description: "Branch the current conversation", category: "Session" },
  { command: "/retry", description: "Retry the last request", category: "Session" },
  { command: "/undo", description: "Remove the last exchange", category: "Session" },
  { command: "/compress", description: "Compress the conversation context", category: "Session" },
  { command: "/stop", description: "Stop background processes", category: "Session" },
  { command: "/model", description: "Show or change the model", category: "Model", acceptsArgument: true },
  { command: "/reasoning", description: "Change reasoning effort", category: "Model", acceptsArgument: true },
  { command: "/personality", description: "Change the assistant personality", category: "Model", acceptsArgument: true },
  { command: "/fast", description: "Toggle fast processing", category: "Model" },
  { command: "/tools", description: "Manage available tools", category: "Tools" },
  { command: "/toolsets", description: "List enabled toolsets", category: "Tools" },
  { command: "/skills", description: "Browse and install skills", category: "Tools" },
  { command: "/skill", description: "Load a skill by name", category: "Tools", acceptsArgument: true },
  { command: "/image", description: "Attach an image by path", category: "Tools", acceptsArgument: true },
  { command: "/cron", description: "Manage scheduled jobs", category: "Tools" },
  { command: "/plugins", description: "List installed plugins", category: "Tools" },
  { command: "/help", description: "Show in-session help", category: "Utility" },
  { command: "/status", description: "Show session status", category: "Utility" },
  { command: "/usage", description: "Show token usage", category: "Utility" },
  { command: "/history", description: "Show conversation history", category: "Utility" },
  { command: "/copy", description: "Copy the last response", category: "Utility" },
  { command: "/paste", description: "Attach a clipboard image", category: "Utility" },
  { command: "/voice", description: "Control voice mode", category: "Utility", acceptsArgument: true },
  { command: "/debug", description: "Create a diagnostic report", category: "Utility" },
  { command: "/quit", description: "End the terminal session", category: "Utility" },
];

export function filterSlashCommands(query: string): DashboardSlashCommand[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return DASHBOARD_SLASH_COMMANDS;
  return DASHBOARD_SLASH_COMMANDS.filter((item) =>
    `${item.command} ${item.description} ${item.category}`.toLowerCase().includes(normalized),
  );
}
