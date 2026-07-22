const PTY_ATTACH_TOKEN_KEY = "hermes.pty.token.chat";

/**
 * Keep-alive PTYs may only be reused for the same logical chat target.
 * Otherwise selecting a different session reattaches the old live process and
 * silently ignores the new `?resume=` argument supplied to the server.
 */
export function ptyAttachStorageKey(
  profile: string | undefined,
  resumeSessionId: string | null,
): string {
  const profileScope = profile || "default";
  const chatScope = resumeSessionId ? `resume:${resumeSessionId}` : "fresh";
  return `${PTY_ATTACH_TOKEN_KEY}:${encodeURIComponent(profileScope)}:${encodeURIComponent(chatScope)}`;
}
