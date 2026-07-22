/**
 * ChatPage — embeds `hermes --tui` inside the dashboard.
 *
 *   <div host> (dashboard chrome)                                         .
 *     └─ <div wrapper> (rounded, dark bg, padded — the "terminal window"  .
 *         look that gives the page a distinct visual identity)            .
 *         └─ @xterm/xterm Terminal (WebGL renderer, Unicode 11 widths)    .
 *              │ onData      keystrokes → WebSocket → PTY master          .
 *              │ onResize    terminal resize → `\x1b[RESIZE:cols;rows]`   .
 *              │ write(data) PTY output bytes → VT100 parser              .
 *              ▼                                                          .
 *     WebSocket /api/pty?token=<session>                                  .
 *          ▼                                                              .
 *     FastAPI pty_ws  (hermes_cli/web_server.py)                          .
 *          ▼                                                              .
 *     POSIX PTY → `node ui-tui/dist/entry.js` → tui_gateway + AIAgent     .
 */

import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Button } from "@nous-research/ui/ui/components/button";
import { Typography } from "@nous-research/ui/ui/components/typography/index";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  ImagePlus,
  Keyboard,
  PanelRight,
  RotateCcw,
  Search,
  SquareTerminal,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";

import { ChatSidebar } from "@/components/ChatSidebar";
import { ChatSessionList } from "@/components/ChatSessionList";
import { usePageHeader } from "@/contexts/usePageHeader";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { normalizeSessionTitle } from "@/lib/chat-title";
import { ptyAttachStorageKey } from "@/lib/pty-attach-identity";
import {
  PTY_CONNECTING_TIMEOUT_MS,
  PTY_RECONNECT_INPUT_MESSAGE,
  PTY_RESUME_RECONNECT_THROTTLE_MS,
  type PtyConnectionState,
  shouldBlockPtyInput,
  shouldReconnectPtyOnPageResume,
} from "@/lib/pty-reconnect";
import {
  MOBILE_REPLACEMENT_WINDOW_MS,
  normalizePtyMobileInput,
  shouldTreatInputAsMobileReplacement,
} from "@/lib/pty-mobile-input";
import {
  beginTerminalTouch,
  moveTerminalTouch,
  stepTerminalTouchInertia,
  type TerminalInertiaState,
  type TerminalTouchState,
} from "@/lib/pty-mobile-scroll";
import {
  pinchDistance,
  terminalFontSizeWithScale,
  terminalScaleFromPinch,
} from "@/lib/pty-mobile-zoom";
import {
  applyTerminalModifiers,
  terminalKeySequence,
  type TerminalExtraKey,
} from "@/lib/pty-extra-keys";
import {
  DASHBOARD_SLASH_COMMANDS,
  filterSlashCommands,
} from "@/lib/pty-command-menu";
import { shouldRevealTerminalInput } from "@/lib/pty-keyboard-viewport";
import {
  imageFileLooksSupported,
  imageFilesFromTransfer,
  transferMayContainImage,
  uploadChatImage,
} from "@/lib/chatImagePaste";
import { flushImageAttachmentQueue } from "@/lib/chat-image-attachment-queue";
import {
  queueForScope,
  shouldConsumeQueuedImages,
} from "@/lib/chat-image-send-queue";
import { PluginSlot } from "@/plugins";
import { useTheme } from "@/themes";
import { useProfileScope } from "@/contexts/useProfileScope";

// Stable per-browser token identifying THIS chat tab's keep-alive PTY session.
// Sent as ?attach=; lets a refresh/disconnect reattach to the same live process
// instead of spawning a fresh one. Per-localStorage, so other devices can't grab it.
// ``rotate`` mints a new token — used when the user explicitly starts a fresh
// session so the old keep-alive PTY is NOT reattached (the registry reaps it).
function ptyAttachToken(storageKey: string, rotate = false): string {
  let t = "";
  if (!rotate) {
    try {
      t = window.localStorage.getItem(storageKey) ?? "";
    } catch {
      /* private mode / storage blocked */
    }
  }
  if (!t) {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    t = Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
    try {
      window.localStorage.setItem(storageKey, t);
    } catch {
      /* ignore */
    }
  }
  return t;
}

// Channel id ties this chat tab's PTY child (publisher) to its sidebar
// (subscriber).  Generated once per mount so a tab refresh starts a fresh
// channel — the previous PTY child terminates with the old WS, and its
// channel auto-evicts when no subscribers remain.
function generateChannelId(scope?: string): string {
  const prefix = scope ? "chat" : "chat-fresh";
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2)}-${Date.now().toString(
    36,
  )}`;
}

// Colors for the terminal body.  Matches the dashboard's dark teal canvas
// with cream foreground — we intentionally don't pick monokai or a loud
// theme, because the TUI's skin engine already paints the content; the
// terminal chrome just needs to sit quietly inside the dashboard.
const DEFAULT_TERMINAL_BACKGROUND = "#000000";
const DEFAULT_TERMINAL_FOREGROUND = "#f0e6d2";

type QueuedChatImage = {
  id: string;
  name: string;
  scope: string;
  status: "uploading" | "attaching" | "ready" | "error";
};

function buildTerminalTheme(background: string, foreground: string) {
  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground:
      foreground.length === 7 ? `${foreground}44` : foreground,
  };
}

/**
 * CSS width for xterm font tiers.
 *
 * Prefer the terminal host's `clientWidth` — Chrome DevTools device mode often
 * keeps `window.innerWidth` at the full desktop value while the *drawn* layout
 * is phone-sized, which made us pick desktop font sizes (~14px) and look huge.
 */
function terminalTierWidthPx(host: HTMLElement | null): number {
  if (typeof window === "undefined") return 1280;
  const fromHost = host?.clientWidth ?? 0;
  if (fromHost > 2) return Math.round(fromHost);
  const doc = document.documentElement?.clientWidth ?? 0;
  const vv = window.visualViewport;
  const inner = window.innerWidth;
  const vvw = vv?.width ?? inner;
  const layout = Math.min(inner, vvw, doc > 0 ? doc : inner);
  return Math.max(1, Math.round(layout));
}

function terminalFontSizeForWidth(layoutWidthPx: number): number {
  if (layoutWidthPx < 300) return 7;
  if (layoutWidthPx < 360) return 8;
  if (layoutWidthPx < 420) return 9;
  if (layoutWidthPx < 520) return 10;
  if (layoutWidthPx < 720) return 11;
  if (layoutWidthPx < 1024) return 12;
  return 14;
}

function terminalLineHeightForWidth(layoutWidthPx: number): number {
  return layoutWidthPx < 1024 ? 1.02 : 1.15;
}

export default function ChatPage({ isActive = true }: { isActive?: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const uploadImagesRef = useRef<((files: File[]) => void) | null>(null);
  const pendingImagePathsByScopeRef = useRef(new Map<string, string[]>());
  const pendingImageIdsByScopeRef = useRef(new Map<string, string[]>());
  const flushImageAttachmentsRef = useRef<(() => Promise<void>) | null>(null);
  const flushImageAttachmentsInFlightRef = useRef<Promise<void> | null>(null);
  const terminalScaleRef = useRef(1);
  // Exposed to the main metrics-sync effect so it can refit the terminal
  // the moment `isActive` flips back to true (display:none → display:flex
  // collapses the host's box, so ResizeObserver never fires on return).
  const syncMetricsRef = useRef<(() => void) | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // Lazy-init: the missing-token check happens at construction so the effect
  // body doesn't have to setState (React 19's set-state-in-effect rule).
  // In gated (OAuth) mode the server intentionally omits the session token —
  // the dashboard API layer authenticates the WS via a single-use ticket,
  // so a missing token there is expected, not an error.
  const [banner, setBanner] = useState<string | null>(() =>
    typeof window !== "undefined" &&
    !window.__HERMES_SESSION_TOKEN__ &&
    !window.__HERMES_AUTH_REQUIRED__
      ? "Session token unavailable. Open this page through `hermes dashboard`, not directly."
      : null,
  );
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const forceFreshPtyRef = useRef(false);
  const blockedInputNoticeRef = useRef(false);
  const lastResumeReconnectAtRef = useRef(0);
  // True from the moment the connect effect begins until the socket resolves
  // (open or close). Guards the page-resume reconnect against firing during
  // the async ticket/URL await gap where wsRef.current is not yet assigned.
  const connectInFlightRef = useRef(false);
  const connectingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ptyInputLineRef = useRef("");
  const mobileReplacementInputUntilRef = useRef(0);
  const controlArmedRef = useRef(false);
  const altArmedRef = useRef(false);
  const [extraKeysOpen, setExtraKeysOpen] = useState(false);
  const [controlArmed, setControlArmed] = useState(false);
  const [altArmed, setAltArmed] = useState(false);
  const [commandMenuOpenRaw, setCommandMenuOpenRaw] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [queuedImages, setQueuedImages] = useState<QueuedChatImage[]>([]);
  const visibleQueuedImageCountRef = useRef(0);
  const [ptyState, setPtyState] =
    useState<PtyConnectionState>("connecting");
  const ptyStateRef = useRef<PtyConnectionState>("connecting");
  const [lastCloseCode, setLastCloseCode] = useState<number | null>(null);
  // NS-504: when the agent process exits cleanly (the user typed `/exit`, or
  // started a new session that ended the current PTY child), the PTY socket
  // closes with a normal code. Before this fix the terminal just printed
  // "[session ended]" and went dead — the only recovery was a full page
  // refresh. `ptyState === "ended"` renders an explicit "Start new session"
  // affordance; clicking it bumps `reconnectNonce`, which is a dependency of
  // the connect effect, so a fresh PTY spawns in place.
  const [reconnectNonce, setReconnectNonce] = useState(0);
  useEffect(() => {
    ptyStateRef.current = ptyState;
  }, [ptyState]);
  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);
  const reconnectPty = useCallback(() => {
    forceFreshPtyRef.current = false;
    reconnectAttemptRef.current = 0;
    clearReconnectTimer();
    blockedInputNoticeRef.current = false;
    ptyInputLineRef.current = "";
    mobileReplacementInputUntilRef.current = 0;
    setBanner(null);
    setLastCloseCode(null);
    setPtyState("connecting");
    setReconnectNonce((n) => n + 1);
  }, [clearReconnectTimer]);
  const startFreshPty = useCallback(() => {
    forceFreshPtyRef.current = true;
    reconnectAttemptRef.current = 0;
    clearReconnectTimer();
    blockedInputNoticeRef.current = false;
    ptyInputLineRef.current = "";
    mobileReplacementInputUntilRef.current = 0;
    pendingImagePathsByScopeRef.current.clear();
    pendingImageIdsByScopeRef.current.clear();
    setQueuedImages([]);
    setBanner(null);
    setLastCloseCode(null);
    setPtyState("connecting");
    setReconnectNonce((n) => n + 1);
  }, [clearReconnectTimer]);
  const startFreshDashboardChat = useCallback(() => {
    const next = new URLSearchParams(searchParams);

    next.delete("resume");
    forceFreshPtyRef.current = true;
    reconnectAttemptRef.current = 0;
    clearReconnectTimer();
    blockedInputNoticeRef.current = false;
    ptyInputLineRef.current = "";
    mobileReplacementInputUntilRef.current = 0;
    pendingImagePathsByScopeRef.current.clear();
    pendingImageIdsByScopeRef.current.clear();
    setQueuedImages([]);
    setSearchParams(next, { replace: true });
    setBanner(null);
    setLastCloseCode(null);
    setPtyState("connecting");
    setReconnectNonce((n) => n + 1);
  }, [clearReconnectTimer, searchParams, setSearchParams]);
  // Raw state for the mobile side-sheet + a derived value that force-
  // closes whenever the chat tab isn't active.  The *derived* value is
  // what side-effects (body-scroll lock, keydown listener, portal render)
  // key on — that way switching to another tab triggers the effect's
  // cleanup, releasing the scroll-lock on /sessions etc.  Returning to
  // /chat re-runs the effect (derived flips back to true) and re-locks.
  // Keying on the raw state would leak the body.overflow="hidden" across
  // tabs because the dep wouldn't change on tab switch.
  const [mobilePanelOpenRaw, setMobilePanelOpenRaw] = useState(false);
  const mobilePanelOpen = isActive && mobilePanelOpenRaw;
  const { setEnd, setTitle } = usePageHeader();
  const [sessionTitleState, setSessionTitleState] = useState<{
    scope: string;
    title: string | null;
  }>({ scope: "", title: null });
  const { t } = useI18n();
  const closeMobilePanel = useCallback(() => setMobilePanelOpenRaw(false), []);
  const openImagePicker = useCallback(() => imageInputRef.current?.click(), []);
  const clearTerminalModifiers = useCallback(() => {
    controlArmedRef.current = false;
    altArmedRef.current = false;
    setControlArmed(false);
    setAltArmed(false);
  }, []);
  const toggleTerminalModifier = useCallback((modifier: "control" | "alt") => {
    if (modifier === "control") {
      controlArmedRef.current = !controlArmedRef.current;
      setControlArmed(controlArmedRef.current);
    } else {
      altArmedRef.current = !altArmedRef.current;
      setAltArmed(altArmedRef.current);
    }
    requestAnimationFrame(() => termRef.current?.focus());
  }, []);
  const sendTerminalExtraKey = useCallback(
    (key: TerminalExtraKey) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        terminalKeySequence(key, {
          control: controlArmedRef.current,
          alt: altArmedRef.current,
        }),
      );
      clearTerminalModifiers();
      requestAnimationFrame(() => termRef.current?.focus());
    },
    [clearTerminalModifiers],
  );
  const insertSlashCommand = useCallback((command: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(command);
    setCommandMenuOpenRaw(false);
    setCommandQuery("");
    requestAnimationFrame(() => termRef.current?.focus());
  }, []);
  const handleImagePickerChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const selected = Array.from(event.currentTarget.files ?? []);
      const files = selected.filter(imageFileLooksSupported);
      if (selected.length && !files.length) {
        setBanner("That file is not a supported PNG, JPEG, GIF, WebP, or BMP image.");
      } else {
        uploadImagesRef.current?.(files);
      }
      event.currentTarget.value = "";
    },
    [],
  );
  const modelToolsLabel = useMemo(
    () => `${t.app.modelToolsSheetTitle} ${t.app.modelToolsSheetSubtitle}`,
    [t.app.modelToolsSheetSubtitle, t.app.modelToolsSheetTitle],
  );
  const [portalRoot] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" ? document.body : null,
  );
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 1023px)").matches
      : false,
  );
  const commandMenuOpen = isActive && narrow && commandMenuOpenRaw;
  const visibleSlashCommands = useMemo(
    () => filterSlashCommands(commandQuery),
    [commandQuery],
  );

  const { theme } = useTheme();
  const terminalBg = theme.terminalBackground ?? DEFAULT_TERMINAL_BACKGROUND;
  const terminalFg = theme.terminalForeground ?? DEFAULT_TERMINAL_FOREGROUND;
  const terminalTheme = useMemo(
    () => buildTerminalTheme(terminalBg, terminalFg),
    [terminalBg, terminalFg],
  );

  // The dashboard keeps ChatPage mounted persistently so the PTY survives tab
  // switches. That is great for ordinary /chat navigation, but it means query
  // param changes do NOT remount the component. Resume-in-chat from the
  // Sessions page relies on `/chat?resume=<id>` changing at runtime, so we must
  // treat the current resume target as part of the PTY identity and rebuild the
  // terminal session when it changes.
  const resumeParam = searchParams.get("resume");
  // Profile-scoped chat: spawn the PTY under the globally selected
  // management profile. Changing it remounts the terminal (key below /
  // effect dep) so the user explicitly starts a fresh scoped session.
  const { profile: scopedProfile } = useProfileScope();
  const imageQueueScope = ptyAttachStorageKey(scopedProfile, resumeParam);
  const visibleQueuedImages = queuedImages.filter(
    (image) => image.scope === imageQueueScope,
  );
  visibleQueuedImageCountRef.current = visibleQueuedImages.length;
  const consumeVisibleQueuedImages = useCallback(() => {
    setQueuedImages((images) =>
      images.filter((image) => image.scope !== imageQueueScope),
    );
  }, [imageQueueScope]);
  const channel = useMemo(
    () => generateChannelId(`${resumeParam ?? ""}\0${scopedProfile}`),
    [resumeParam, scopedProfile],
  );
  const titleScope = `${channel}\0${reconnectNonce}`;
  const sessionTitle =
    sessionTitleState.scope === titleScope ? sessionTitleState.title : null;
  const handleSessionTitleChange = useCallback(
    (title: string | null) => setSessionTitleState({ scope: titleScope, title }),
    [titleScope],
  );

  useEffect(() => {
    if (!isActive) {
      setTitle(null);
      return;
    }

    setTitle(sessionTitle);
    return () => setTitle(null);
  }, [isActive, sessionTitle, setTitle]);

  useEffect(() => {
    if (!resumeParam) return;

    let cancelled = false;

    api
      .getSessionDetail(resumeParam, scopedProfile)
      .then((session) => {
        if (cancelled) return;
        handleSessionTitleChange(normalizeSessionTitle(session.title));
      })
      .catch(() => {
        // Best-effort: the PTY-side session.info stream can still supply it.
      });

    return () => {
      cancelled = true;
    };
  }, [resumeParam, scopedProfile, handleSessionTitleChange]);

  useEffect(() => {
    if (!resumeParam) return;

    let cancelled = false;

    api
      .getSessionLatestDescendant(resumeParam, scopedProfile)
      .then((res) => {
        if (cancelled || !res.session_id || res.session_id === resumeParam) {
          return;
        }

        const next = new URLSearchParams(searchParams);
        next.set("resume", res.session_id);
        setSearchParams(next, { replace: true });
      })
      .catch(() => {
        // Best-effort: old servers or missing sessions should not block chat.
      });

    return () => {
      cancelled = true;
    };
  }, [resumeParam, scopedProfile, searchParams, setSearchParams]);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 1023px)");
    const sync = () => setNarrow(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!mobilePanelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMobilePanel();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [mobilePanelOpen, closeMobilePanel]);

  useEffect(() => {
    if (!commandMenuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCommandMenuOpenRaw(false);
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [commandMenuOpen]);

  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setMobilePanelOpenRaw(false);
        setCommandMenuOpenRaw(false);
        setExtraKeysOpen(false);
      }
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const handleCopyLast = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Send the slash as a burst, wait long enough for Ink's tokenizer to
    // emit a keypress event for each character (not coalesce them into a
    // paste), then send Return as its own event.
    ws.send("/copy");
    setTimeout(() => {
      const socket = wsRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) socket.send("\r");
    }, 100);
    setCopyState("copied");
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
    copyResetRef.current = setTimeout(() => setCopyState("idle"), 1500);
    termRef.current?.focus();
  }, []);

  useEffect(() => {
    // When hidden (non-chat tab) we must not register the header button —
    // another page owns the header's end slot at that point.
    if (!isActive) {
      setEnd(null);
      return;
    }
    if (!narrow) {
      setEnd(null);
      return;
    }
    setEnd(
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          ghost
          size="icon"
          onClick={handleCopyLast}
          disabled={ptyState !== "open"}
          title={
            copyState === "copied"
              ? "Copied last response"
              : "Copy last assistant response as raw markdown"
          }
          aria-label="Copy last assistant response"
          className={cn(
            "shrink-0 rounded border border-current/20 text-text-secondary hover:text-midground",
            copyState === "copied" && "bg-midground/10 text-midground",
          )}
        >
          <Copy className="h-4 w-4" />
        </Button>
        <Button
          ghost
          size="icon"
          onClick={() => setCommandMenuOpenRaw(true)}
          disabled={ptyState !== "open"}
          title="Open terminal command palette"
          aria-label="Open terminal command palette"
          aria-haspopup="dialog"
          aria-expanded={commandMenuOpen}
          className="shrink-0 rounded border border-current/20 text-text-secondary hover:text-midground"
        >
          <SquareTerminal className="h-4 w-4" />
        </Button>
        <Button
          ghost
          size="icon"
          onClick={() => setExtraKeysOpen((open) => !open)}
          disabled={ptyState !== "open"}
          title="Toggle terminal extra keys"
          aria-label="Toggle terminal extra keys"
          aria-pressed={extraKeysOpen}
          className={cn(
            "shrink-0 rounded border border-current/20 text-text-secondary hover:text-midground",
            extraKeysOpen && "bg-midground/10 text-midground",
          )}
        >
          <Keyboard className="h-4 w-4" />
        </Button>
        <Button
          ghost
          size="icon"
          onClick={openImagePicker}
          disabled={ptyState === "ended" || ptyState === "closed"}
          title="Attach images"
          aria-label="Attach images"
          className="relative shrink-0 rounded border border-current/20 text-text-secondary hover:text-midground"
        >
          <ImagePlus className="h-4 w-4" />
          {visibleQueuedImages.length > 0 && (
            <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-midground px-1 text-[9px] font-bold leading-none text-background-base">
              {visibleQueuedImages.length}
            </span>
          )}
        </Button>
        <Button
          ghost
          onClick={() => setMobilePanelOpenRaw(true)}
          aria-expanded={mobilePanelOpen}
          aria-controls="chat-side-panel"
          className={cn(
            "shrink-0 rounded border border-current/20",
            "px-2 py-1 text-xs font-medium tracking-wide",
            "text-text-secondary hover:text-midground hover:bg-midground/5",
          )}
        >
          <span className="inline-flex items-center gap-1.5">
            <PanelRight className="h-3 w-3 shrink-0" />
            {modelToolsLabel}
          </span>
        </Button>
      </div>,
    );
    return () => setEnd(null);
  }, [
    commandMenuOpen,
    copyState,
    extraKeysOpen,
    handleCopyLast,
    isActive,
    narrow,
    mobilePanelOpen,
    modelToolsLabel,
    openImagePicker,
    ptyState,
    setEnd,
    visibleQueuedImages.length,
  ]);

  // `100dvh` still follows the layout viewport in some Android browser modes.
  // Mirror the visual viewport into CSS so the app shell shrinks as soon as
  // the software keyboard opens rather than waiting for typed input to pan it.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const syncHeight = () => {
      root.style.setProperty(
        "--hermes-visual-viewport-height",
        `${Math.round(viewport.height)}px`,
      );
    };
    syncHeight();
    viewport.addEventListener("resize", syncHeight);
    return () => {
      viewport.removeEventListener("resize", syncHeight);
      root.style.removeProperty("--hermes-visual-viewport-height");
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const token = window.__HERMES_SESSION_TOKEN__;
    const gated = !!window.__HERMES_AUTH_REQUIRED__;
    // Banner already initialised above; just bail before wiring xterm/WS.
    // In gated mode the token is absent by design — api.buildWsUrl() mints
    // a WS ticket instead, so don't bail; let the effect reach that path.
    if (!token && !gated) {
      return;
    }

    const tierW0 = terminalTierWidthPx(host);
    const term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily:
        "'JetBrains Mono', 'Cascadia Mono', 'Fira Code', 'MesloLGS NF', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace",
      fontSize: terminalFontSizeWithScale(
        terminalFontSizeForWidth(tierW0),
        terminalScaleRef.current,
      ),
      lineHeight: terminalLineHeightForWidth(tierW0),
      letterSpacing: 0,
      fontWeight: "400",
      fontWeightBold: "700",
      macOptionIsMeta: true,
      // Hold Option (Alt on Linux/Windows) to force native text selection
      // even when the inner Hermes TUI has enabled xterm mouse-events
      // mode (CSI ?1000h family). Without this, click-and-drag in the
      // chat canvas selects nothing and Cmd+C falls back to copying the
      // entire visible buffer, which is rarely what the user wants.
      // See #25720.
      macOptionClickForcesSelection: true,
      // Right-click selects the word under the pointer. xterm.js default
      // is false; enabling it gives users a single-action selection
      // path on top of the modifier-based bypass above.
      rightClickSelectsWord: true,
      // Browser-embedded chat runs the TUI in inline mode. Keep transcript
      // history in xterm.js so the browser wheel can scroll it directly.
      scrollback: 5000,
      theme: terminalTheme,
    });
    termRef.current = term;

    // --- Clipboard integration ---------------------------------------
    //
    // Four independent paths all route to the system clipboard:
    //
    //   1. **Selection → Ctrl+C (or Cmd+C on macOS).**  Ink's own handler
    //      in useInputHandlers.ts turns Ctrl+C into a copy when the
    //      terminal has a selection, then emits an OSC 52 escape.  Our
    //      OSC 52 handler below decodes that escape and writes to the
    //      browser clipboard — so the flow works just like it does in
    //      `hermes --tui`.
    //
    //   2. **Ctrl/Cmd+Shift+C.**  Belt-and-suspenders shortcut that
    //      operates directly on xterm's selection, useful if the TUI
    //      ever stops listening (e.g. overlays / pickers) or if the user
    //      has selected with the mouse outside of Ink's selection model.
    //
    //   3. **Ctrl/Cmd+Shift+V.**  Prefers clipboard.read() for images
    //      (upload → `/image`), else readText() into term.paste().
    //      preventDefault here suppresses the DOM paste event, so image
    //      handling must live in this key path — not only the host
    //      listener below.
    //
    //   4. **DOM paste / drop on the host.**  Bare Ctrl+V and context-menu
    //      paste fire a ClipboardEvent; drag-drop lands files. Image
    //      payloads upload to HERMES_HOME/images then drive `/image`.
    //
    // OSC 52 reads (terminal asking to read the clipboard) are not
    // supported — that would let any content the TUI renders exfiltrate
    // the user's clipboard.
    term.parser.registerOscHandler(52, (data) => {
      // Format: "<targets>;<base64 | '?'>"
      const semi = data.indexOf(";");
      if (semi < 0) return false;
      const payload = data.slice(semi + 1);
      if (payload === "?" || payload === "") return false; // read/clear — ignore
      try {
        const binary = atob(payload);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        const text = new TextDecoder("utf-8").decode(bytes);
        navigator.clipboard.writeText(text).catch((err) => {
          // Most common reason: the Clipboard API requires a user gesture.
          // This can fail when the OSC 52 response arrives outside the
          // original keydown event's activation. Log to aid debugging.
          console.warn("[dashboard clipboard] OSC 52 write failed:", err.message);
        });
      } catch {
        console.warn("[dashboard clipboard] malformed OSC 52 payload");
      }
      return true;
    });

    const isMac =
      typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

    // ── Image paste / drop ───────────────────────────────────────────────
    // The Chat tab is an xterm mirror of a TUI inside the gateway. Server-side
    // clipboard.paste / xclip never see the browser clipboard, so image paste
    // uploads browser bytes to HERMES_HOME/images, then injects the resulting
    // path as bracketed paste. The native TUI recognizes that path, preserves
    // any composer draft, and queues the image for the next ordinary prompt.
    const pendingImagePaths = queueForScope(
      pendingImagePathsByScopeRef.current,
      imageQueueScope,
    );
    const pendingImageIds = queueForScope(
      pendingImageIdsByScopeRef.current,
      imageQueueScope,
    );
    const reportImageUploadError = (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[dashboard chat] image upload failed:", message);
      setBanner(`Image upload failed: ${message}`);
    };
    const flushPendingImageAttachments = async (): Promise<void> => {
      if (flushImageAttachmentsInFlightRef.current) {
        await flushImageAttachmentsInFlightRef.current;
        if (
          pendingImagePaths.length > 0 &&
          wsRef.current?.readyState === WebSocket.OPEN
        ) {
          await flushPendingImageAttachments();
        }
        return;
      }

      const run = (async () => {
        const sent = await flushImageAttachmentQueue(
          pendingImagePaths,
          wsRef.current,
          (milliseconds) =>
            new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds)),
        );
        const attachedIds = pendingImageIds.splice(0, sent);
        if (attachedIds.length > 0) {
          const attached = new Set(attachedIds);
          setQueuedImages((images) =>
            images.map((image) =>
              attached.has(image.id) ? { ...image, status: "ready" } : image,
            ),
          );
          term.focus();
        }
        if (pendingImagePaths.length > 0) {
          setBanner("Images are waiting for chat to reconnect.");
        }
      })();

      flushImageAttachmentsInFlightRef.current = run;
      try {
        await run;
      } finally {
        if (flushImageAttachmentsInFlightRef.current === run) {
          flushImageAttachmentsInFlightRef.current = null;
        }
      }
    };
    flushImageAttachmentsRef.current = flushPendingImageAttachments;
    const uploadAndAttachImages = (files: File[]) => {
      if (!files.length) return;

      const staged = files.map((file) => ({
        file,
        image: {
          id:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name || "Pasted image",
          scope: imageQueueScope,
          status: "uploading" as const,
        },
      }));
      setQueuedImages((images) => [...images, ...staged.map(({ image }) => image)]);

      void (async () => {
        for (const { file, image } of staged) {
          try {
            const uploaded = await uploadChatImage(file, scopedProfile);
            pendingImagePaths.push(uploaded.path);
            pendingImageIds.push(image.id);
            setQueuedImages((images) =>
              images.map((item) =>
                item.id === image.id ? { ...item, status: "attaching" } : item,
              ),
            );
          } catch (err) {
            setQueuedImages((images) =>
              images.map((item) =>
                item.id === image.id ? { ...item, status: "error" } : item,
              ),
            );
            reportImageUploadError(err);
          }
        }
        await flushImageAttachmentsRef.current?.();
      })();
    };
    uploadImagesRef.current = uploadAndAttachImages;
    const handleBrowserPaste = (ev: ClipboardEvent) => {
      const files = imageFilesFromTransfer(ev.clipboardData);
      if (!files.length) return;
      ev.preventDefault();
      ev.stopPropagation();
      uploadAndAttachImages(files);
    };
    const handleBrowserDragOver = (ev: DragEvent) => {
      if (!transferMayContainImage(ev.dataTransfer)) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
    };
    const handleBrowserDrop = (ev: DragEvent) => {
      const files = imageFilesFromTransfer(ev.dataTransfer);
      if (!files.length) return;
      ev.preventDefault();
      ev.stopPropagation();
      uploadAndAttachImages(files);
    };
    host.addEventListener("paste", handleBrowserPaste, { capture: true });
    host.addEventListener("dragover", handleBrowserDragOver, { capture: true });
    host.addEventListener("drop", handleBrowserDrop, { capture: true });

    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== "keydown") return true;

      // Copy: Cmd+C on macOS, Ctrl+Shift+C on other platforms. Bare Ctrl+C
      // is reserved for SIGINT to the TUI child — matches xterm / gnome-terminal /
      // konsole / Windows Terminal. Ctrl+Shift+C only copies if a selection exists;
      // without a selection it passes through to the TUI so agents can still
      // react to the keypress.
      // Paste: Cmd+Shift+V on macOS, Ctrl+Shift+V on others.
      const copyModifier = isMac ? ev.metaKey : ev.ctrlKey && ev.shiftKey;
      const pasteModifier = isMac ? ev.metaKey : ev.ctrlKey && ev.shiftKey;

      if (copyModifier && ev.key.toLowerCase() === "c") {
        const sel = term.getSelection();
        if (sel) {
          // Direct writeText inside the keydown handler preserves the user
          // gesture — async round-trips through OSC 52 can lose activation
          // and fail with "Document is not focused".
          navigator.clipboard.writeText(sel).catch((err) => {
            console.warn("[dashboard clipboard] direct copy failed:", err.message);
          });
          // Clear xterm.js's highlight after copy (matches gnome-terminal).
          term.clearSelection();
          ev.preventDefault();
          return false;
        }
        // No selection → fall through so the TUI receives Ctrl+Shift+C
        // (or the bare ev if the user used a different modifier).
      }

      if (pasteModifier && ev.key.toLowerCase() === "v") {
        // preventDefault suppresses the DOM paste event, so image paste must
        // be handled here via clipboard.read() — readText() alone misses
        // image-only clipboards (the Discord / #24860 failure mode).
        ev.preventDefault();
        void (async () => {
          try {
            const read = navigator.clipboard?.read;
            if (typeof read === "function") {
              const items = await read.call(navigator.clipboard);
              const files: File[] = [];
              for (const item of items) {
                const type = item.types.find((t) => t.startsWith("image/"));
                if (!type) continue;
                const blob = await item.getType(type);
                const ext = type.split("/")[1]?.split("+")[0] || "png";
                files.push(
                  new File([blob], `clipboard.${ext}`, { type }),
                );
              }
              if (files.length) {
                uploadAndAttachImages(files);
                return;
              }
            }
          } catch {
            /* fall through to text paste */
          }
          try {
            const text = await navigator.clipboard.readText();
            if (text) term.paste(text);
          } catch (err) {
            const message =
              err instanceof Error ? err.message : String(err);
            console.warn("[dashboard clipboard] paste failed:", message);
          }
        })();
        return false;
      }

      return true;
    });

    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);

    // Dashboard chat should scroll the browser-side transcript, not send
    // mouse-wheel protocol bytes through the PTY.
    term.attachCustomWheelEventHandler((ev) => {
      const delta = ev.deltaY;
      if (!delta) {
        return false;
      }

      const step = Math.max(1, Math.round(Math.abs(delta) / 50));
      term.scrollLines(delta > 0 ? step : -step);

      ev.preventDefault();
      ev.stopPropagation();
      return false;
    });

    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = "11";

    term.loadAddon(new WebLinksAddon());

    let mobileInputCleanup: (() => void) | null = null;
    term.open(host);

    // xterm.js 6 handles mouse wheels but does not register its bundled
    // gesture adapter on the terminal viewport. Translate one-finger drags
    // into scrollback lines so mobile history behaves like a native terminal.
    let touchState: TerminalTouchState | null = null;
    let pinchState: {
      distance: number;
      scale: number;
      wasAtBottom: boolean;
    } | null = null;
    let terminalRenderDirty = false;
    // A pinch can change xterm's local grid dozens of times per second. Keep
    // those intermediate fits browser-local and publish one authoritative PTY
    // resize when the gesture settles; flooding Ink with resize/redraw frames
    // can leave long transcripts on an empty xterm viewport.
    let pinchResizePending = false;
    let pinchSettleRaf = 0;
    let inertiaFrame: number | null = null;
    let terminalFocusIntentUntilMs = 0;
    const terminalCellHeight = () =>
      Math.max(
        1,
        (term.options.fontSize ?? 14) * (term.options.lineHeight ?? 1),
      );
    const cancelInertia = () => {
      if (inertiaFrame === null) return;
      window.cancelAnimationFrame(inertiaFrame);
      inertiaFrame = null;
    };
    const startInertia = (velocityPxPerMs: number) => {
      if (Math.abs(velocityPxPerMs) < 0.12) return;
      let inertia: TerminalInertiaState = {
        velocityPxPerMs,
        remainderPx: 0,
      };
      let previousAt = performance.now();
      const tick = (atMs: number) => {
        const elapsedMs = Math.min(32, atMs - previousAt);
        previousAt = atMs;
        const moved = stepTerminalTouchInertia(
          inertia,
          elapsedMs,
          terminalCellHeight(),
        );
        inertia = moved.state;
        if (moved.lines) term.scrollLines(moved.lines);
        if (Math.abs(inertia.velocityPxPerMs) >= 0.03) {
          inertiaFrame = window.requestAnimationFrame(tick);
        } else {
          inertiaFrame = null;
        }
      };
      inertiaFrame = window.requestAnimationFrame(tick);
    };
    const handleTouchStart = (ev: TouchEvent) => {
      cancelInertia();
      if (ev.touches.length === 2) {
        touchState = null;
        pinchState = {
          distance: pinchDistance(ev.touches[0], ev.touches[1]),
          scale: terminalScaleRef.current,
          wasAtBottom:
            term.buffer.active.viewportY >= term.buffer.active.baseY,
        };
        return;
      }
      pinchState = null;
      if (ev.touches.length !== 1) {
        touchState = null;
        return;
      }
      terminalFocusIntentUntilMs = Date.now() + 2_000;
      touchState = beginTerminalTouch(ev.touches[0].clientY, ev.timeStamp);
    };
    const handleTouchMove = (ev: TouchEvent) => {
      if (ev.touches.length === 2) {
        if (!pinchState) {
          pinchState = {
            distance: pinchDistance(ev.touches[0], ev.touches[1]),
            scale: terminalScaleRef.current,
            wasAtBottom:
              term.buffer.active.viewportY >= term.buffer.active.baseY,
          };
        }
        const activePinch = pinchState;
        terminalScaleRef.current = terminalScaleFromPinch(
          activePinch.scale,
          activePinch.distance,
          pinchDistance(ev.touches[0], ev.touches[1]),
        );
        term.options.fontSize = terminalFontSizeWithScale(
          terminalFontSizeForWidth(terminalTierWidthPx(host)),
          terminalScaleRef.current,
        );
        terminalRenderDirty = true;
        pinchResizePending = true;
        scheduleHostSync();
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      if (!touchState || ev.touches.length !== 1) return;
      const moved = moveTerminalTouch(
        touchState,
        ev.touches[0].clientY,
        terminalCellHeight(),
        ev.timeStamp,
      );
      touchState = moved.state;
      if (!moved.lines) return;
      term.scrollLines(moved.lines);
      ev.preventDefault();
      ev.stopPropagation();
    };
    const settlePinch = (revealBottom: boolean) => {
      pinchState = null;
      touchState = null;
      if (pinchSettleRaf) cancelAnimationFrame(pinchSettleRaf);
      pinchSettleRaf = requestAnimationFrame(() => {
        pinchSettleRaf = 0;
        syncTerminalMetrics();
        if (revealBottom) term.scrollToBottom();
      });
    };
    const handleTouchEnd = () => {
      if (pinchState) {
        settlePinch(pinchState.wasAtBottom);
        return;
      }
      if (touchState) startInertia(touchState.velocityPxPerMs);
      touchState = null;
    };
    const handleTouchCancel = () => {
      if (pinchState) {
        settlePinch(pinchState.wasAtBottom);
        return;
      }
      touchState = null;
    };
    host.addEventListener("touchstart", handleTouchStart, { passive: true });
    host.addEventListener("touchmove", handleTouchMove, { passive: false });
    host.addEventListener("touchend", handleTouchEnd, { passive: true });
    host.addEventListener("touchcancel", handleTouchCancel, { passive: true });

    const textarea = term.textarea;
    if (textarea) {
      textarea.setAttribute("autocomplete", "off");
      textarea.setAttribute("autocorrect", "off");
      textarea.setAttribute("autocapitalize", "off");
      textarea.setAttribute("spellcheck", "false");

      const isMobileLike =
        typeof navigator !== "undefined" &&
        /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
      const markReplacementInput = (ev: Event) => {
        const input = ev as InputEvent;
        if (
          shouldTreatInputAsMobileReplacement(
            input.inputType,
            input.data,
            isMobileLike,
          )
        ) {
          mobileReplacementInputUntilRef.current = Date.now() + MOBILE_REPLACEMENT_WINDOW_MS;
        }
      };
      const markCompositionEnd = () => {
        mobileReplacementInputUntilRef.current = Date.now() + MOBILE_REPLACEMENT_WINDOW_MS;
      };

      textarea.addEventListener("beforeinput", markReplacementInput, true);
      textarea.addEventListener("compositionend", markCompositionEnd, true);
      mobileInputCleanup = () => {
        textarea.removeEventListener("beforeinput", markReplacementInput, true);
        textarea.removeEventListener("compositionend", markCompositionEnd, true);
      };
    }

    // WebGL draws from a texture atlas sized with device pixels. On phones and
    // in DevTools device mode that often produces *visually* much larger cells
    // than `fontSize` suggests — users see "huge" text even at 7–9px settings.
    // The canvas/DOM renderer tracks `fontSize` faithfully; use it for narrow
    // hosts.  Wide layouts still get WebGL for crisp box-drawing.
    const useWebgl = terminalTierWidthPx(host) >= 768;
    if (useWebgl) {
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch (err) {
        console.warn(
          "[hermes-chat] WebGL renderer unavailable; falling back to default",
          err,
        );
      }
    }

    // Initial fit + resize observer.  fit.fit() reads the container's
    // current bounding box and resizes the terminal grid to match.
    //
    // The subtle bit: the dashboard has CSS transitions on the container
    // (backdrop fade-in, rounded corners settling as fonts load).  If we
    // call fit() at mount time, the bounding box we measure is often 1-2
    // cell widths off from the final size.  ResizeObserver *does* fire
    // when the container settles, but if the pixel delta happens to be
    // smaller than one cell's width, fit() computes the same integer
    // (cols, rows) as before and doesn't emit onResize — so the PTY
    // never learns the final size.  Users see truncated long lines until
    // they resize the browser window.
    //
    // We force one extra fit + explicit RESIZE send after two animation
    // frames.  rAF→rAF guarantees one layout commit between the two
    // callbacks, giving CSS transitions and font metrics time to finalize
    // before we take the authoritative measurement.
    let hostSyncRaf = 0;
    const scheduleHostSync = () => {
      if (hostSyncRaf) return;
      hostSyncRaf = requestAnimationFrame(() => {
        hostSyncRaf = 0;
        syncTerminalMetrics();
      });
    };

    let metricsDebounce: ReturnType<typeof setTimeout> | null = null;
    const syncTerminalMetrics = () => {
      // display:none hosts have clientWidth/Height = 0, which fit() turns
      // into a 1x1 terminal.  Skip entirely while hidden; the visibility
      // effect below runs another fit as soon as the tab is shown again.
      if (!host.isConnected || host.clientWidth <= 0 || host.clientHeight <= 0) {
        return;
      }
      const w = terminalTierWidthPx(host);
      const nextSize = terminalFontSizeWithScale(
        terminalFontSizeForWidth(w),
        terminalScaleRef.current,
      );
      const nextLh = terminalLineHeightForWidth(w);
      const fontChanged =
        terminalRenderDirty ||
        term.options.fontSize !== nextSize ||
        term.options.lineHeight !== nextLh;
      if (fontChanged) {
        term.options.fontSize = nextSize;
        term.options.lineHeight = nextLh;
      }
      try {
        fit.fit();
      } catch {
        return;
      }
      // xterm can preserve a now-invalid ydisp while its row count and buffer
      // reflow during a pinch. If the gesture began at the live prompt, keep
      // that prompt pinned after every local fit instead of showing blank rows.
      if (pinchState?.wasAtBottom) {
        term.scrollToBottom();
      }
      terminalRenderDirty = false;
      if (fontChanged && term.rows > 0) {
        try {
          term.refresh(0, term.rows - 1);
        } catch {
          /* ignore */
        }
      }
      if (
        !pinchState &&
        pinchResizePending &&
        wsRef.current?.readyState === WebSocket.OPEN
      ) {
        pinchResizePending = false;
        wsRef.current.send(`\x1b[RESIZE:${term.cols};${term.rows}]`);
      }
    };
    syncMetricsRef.current = syncTerminalMetrics;

    const scheduleSyncTerminalMetrics = () => {
      if (metricsDebounce) clearTimeout(metricsDebounce);
      metricsDebounce = setTimeout(() => {
        metricsDebounce = null;
        syncTerminalMetrics();
      }, 60);
    };

    const ro = new ResizeObserver(() => scheduleHostSync());
    ro.observe(host);

    let keyboardSyncRaf = 0;
    let keyboardRevealTimers: Array<ReturnType<typeof setTimeout>> = [];
    const clearKeyboardRevealSchedule = () => {
      if (keyboardSyncRaf) cancelAnimationFrame(keyboardSyncRaf);
      keyboardSyncRaf = 0;
      keyboardRevealTimers.forEach(clearTimeout);
      keyboardRevealTimers = [];
    };
    const revealTerminalInput = () => {
      // Scroll before and after fitting. xterm can preserve the previous ydisp
      // during a row-count change, which looks like a jump to old scrollback.
      term.scrollToBottom();
      syncTerminalMetrics();
      term.scrollToBottom();
    };
    const scheduleKeyboardReveal = () => {
      clearKeyboardRevealSchedule();
      revealTerminalInput();
      keyboardSyncRaf = requestAnimationFrame(() => {
        keyboardSyncRaf = 0;
        revealTerminalInput();
      });
      keyboardRevealTimers = [80, 180, 320].map((delay) =>
        setTimeout(revealTerminalInput, delay),
      );
    };
    const handleTextareaFocus = () => {
      terminalFocusIntentUntilMs = Date.now() + 2_000;
      scheduleKeyboardReveal();
    };
    const handleVisualViewportResize = () => {
      scheduleSyncTerminalMetrics();
      if (
        !shouldRevealTerminalInput({
          textareaFocused: Boolean(textarea && document.activeElement === textarea),
          focusIntentUntilMs: terminalFocusIntentUntilMs,
          nowMs: Date.now(),
        })
      ) {
        return;
      }
      scheduleKeyboardReveal();
    };
    textarea?.addEventListener("focus", handleTextareaFocus);
    window.addEventListener("resize", scheduleSyncTerminalMetrics);
    window.visualViewport?.addEventListener(
      "resize",
      handleVisualViewportResize,
    );
    scheduleHostSync();
    requestAnimationFrame(() => scheduleHostSync());

    // Double-rAF authoritative fit.  On the second frame the layout has
    // committed at least once since mount; fit.fit() then reads the
    // stable container size.  We always send a RESIZE escape afterwards
    // (even if fit's cols/rows didn't change, so the PTY has the same
    // dims registered as our JS state — prevents a drift where Ink
    // thinks the terminal is one col bigger than what's on screen).
    let settleRaf1 = 0;
    let settleRaf2 = 0;
    settleRaf1 = requestAnimationFrame(() => {
      settleRaf1 = 0;
      settleRaf2 = requestAnimationFrame(() => {
        settleRaf2 = 0;
        syncTerminalMetrics();
      });
    });

    // WebSocket. In gated mode (``window.__HERMES_AUTH_REQUIRED__``) this
    // awaits a single-use ticket via /api/auth/ws-ticket before opening;
    // in loopback mode it resolves synchronously against the injected
    // session token. The IIFE keeps the outer effect synchronous so its
    // ``return cleanup`` stays at the top level; handlers + disposables
    // are hoisted to ``let`` bindings the cleanup closes over.
    let unmounting = false;
    let onDataDisposable: { dispose(): void } | null = null;
    let onResizeDisposable: { dispose(): void } | null = null;
    const forceFresh = forceFreshPtyRef.current;
    forceFreshPtyRef.current = false;
    // A connect attempt is now in flight — set synchronously (before the async
    // socket-open IIFE below awaits its ticket URL) so a page-resume event in
    // that gap doesn't fire a redundant reconnect (wsRef isn't assigned yet).
    connectInFlightRef.current = true;
    const clearConnectingTimer = () => {
      if (connectingTimerRef.current) {
        clearTimeout(connectingTimerRef.current);
        connectingTimerRef.current = null;
      }
    };
    const scheduleReconnect = (code: number) => {
      if (reconnectTimerRef.current) {
        return;
      }
      const attempt = Math.min(reconnectAttemptRef.current + 1, 5);
      reconnectAttemptRef.current = attempt;
      const delayMs = Math.min(250 * 2 ** (attempt - 1), 3000);
      setBanner(null);
      setLastCloseCode(code);
      setPtyState("reconnecting");
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        setReconnectNonce((n) => n + 1);
      }, delayMs);
    };
    void (async () => {
      if (unmounting) return;
      const params: Record<string, string> = { channel };
      if (resumeParam) params.resume = resumeParam;
      if (forceFresh) params.fresh = "1";
      // Keep-alive identity: reattach to this tab's living PTY across
      // refresh/transient drops. A forced-fresh start rotates the token so
      // the previous keep-alive PTY is not reattached (registry reaps it).
      params.attach = ptyAttachToken(
        ptyAttachStorageKey(scopedProfile, resumeParam),
        forceFresh,
      );
      // Profile-scoped chat: the PTY child gets HERMES_HOME pointed at the
      // selected profile, so the conversation runs with that profile's model,
      // skills, memory, and sessions (see web_server._resolve_chat_argv).
      if (scopedProfile) params.profile = scopedProfile;
      const url = await api.buildWsUrl("/api/pty", params);
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      // W2 (NS-591): a mobile socket can wedge in CONNECTING after a radio
      // handoff and never fire onclose, so neither the resume predicate nor
      // scheduleReconnect can recover it. Force-close if it hasn't opened
      // within the budget; the resulting onclose routes into scheduleReconnect.
      clearConnectingTimer();
      connectingTimerRef.current = setTimeout(() => {
        connectingTimerRef.current = null;
        if (wsRef.current === ws && ws.readyState === WebSocket.CONNECTING) {
          try {
            ws.close();
          } catch {
            /* already tearing down */
          }
        }
      }, PTY_CONNECTING_TIMEOUT_MS);

    ws.onopen = () => {
      clearReconnectTimer();
      clearConnectingTimer();
      connectInFlightRef.current = false;
      reconnectAttemptRef.current = 0;
      setBanner(null);
      setLastCloseCode(null);
      setPtyState("open");
      blockedInputNoticeRef.current = false;
      void flushImageAttachmentsRef.current?.();
      // Connected — cancel any pending reconnect from a prior transient drop.
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      // Send the initial RESIZE immediately so Ink has *a* size to lay
      // out against on its first paint.  The double-rAF block above will
      // follow up with the authoritative measurement — at worst Ink
      // reflows once after the PTY boots, which is imperceptible.
      ws.send(`\x1b[RESIZE:${term.cols};${term.rows}]`);
      // One-shot: a ?learn=<text> param (set by the Skills page "Learn a
      // skill" panel) is typed into the composer as a /learn command once the
      // PTY is up. /learn resolves via command.dispatch → a normal agent turn,
      // so this reuses the existing composer path — no special PTY protocol.
      const learnSeed = searchParams.get("learn");
      if (learnSeed) {
        const next = new URLSearchParams(searchParams);
        next.delete("learn");
        setSearchParams(next, { replace: true });
        const cmd = `/learn ${learnSeed}`.trim();
        // Delay so Ink's composer has mounted and grabbed focus before input.
        setTimeout(() => {
          try {
            wsRef.current?.send(cmd + "\r");
          } catch {
            /* PTY not ready / closed — user can retype */
          }
        }, 800);
      }
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        term.write(ev.data);
      } else {
        term.write(new Uint8Array(ev.data as ArrayBuffer));
      }
    };

    ws.onclose = (ev) => {
      wsRef.current = null;
      connectInFlightRef.current = false;
      clearConnectingTimer();
      if (unmounting) {
        return;
      }
      // Surface the real cause to the browser console on every close so a
      // "chat won't connect" report can be diagnosed without server access.
      // The server sends a machine-parseable reason on every rejection (see
      // pty_ws in web_server.py); echo it verbatim alongside the close code.
      const why = ev.reason ? ` reason=${ev.reason}` : "";
      console.warn(`[chat] PTY WebSocket closed code=${ev.code}${why}`);
      setLastCloseCode(ev.code);
      if (ev.code === 4401) {
        setPtyState("closed");
        setBanner(
          ev.reason
            ? `Auth failed (${ev.reason}). Reload to refresh the session.`
            : "Auth failed. Reload the page to refresh the session token.",
        );
        return;
      }
      if (ev.code === 4403) {
        // Host/Origin mismatch (DNS-rebinding guard).
        setPtyState("closed");
        setBanner(
          ev.reason
            ? `Refused: ${ev.reason}.`
            : "Refused: request host/origin doesn't match the dashboard.",
        );
        return;
      }
      if (ev.code === 4404) {
        setPtyState("closed");
        setBanner(
          ev.reason
            ? `Chat websocket unavailable: ${ev.reason}.`
            : "Chat websocket unavailable on this server.",
        );
        return;
      }
      if (ev.code === 4408) {
        setPtyState("closed");
        setBanner(
          ev.reason
            ? `Refused: ${ev.reason}.`
            : "Refused: your client isn't permitted (server bound to localhost only).",
        );
        return;
      }
      if (ev.code === 1011) {
        // Server already wrote an ANSI error frame.
        setPtyState("closed");
        return;
      }
      // Keep-alive close-code contract (web_server.pty_ws + pty_session):
      //   4410 = the agent PROCESS exited (real end) → restart affordance.
      //   4409 = superseded by a newer tab attaching the same token → stay quiet.
      if (ev.code === 4410) {
        term.write(`\r\n\x1b[90m[session ended]\x1b[0m\r\n`);
        setPtyState("ended");
        return;
      }
      if (ev.code === 4409) {
        setPtyState("closed");
        return;
      }
      if (!ev.wasClean || ev.code === 1001 || ev.code === 1006) {
        // Transient transport drop (refresh, sleep/wake, signal loss).
        // Reconnect with backoff; the same ?attach= token reattaches to
        // the still-living PTY, so the conversation continues in place.
        scheduleReconnect(ev.code);
        return;
      }
      // Normal/clean exit: the agent process ended (e.g. the user typed
      // `/exit`, or started a new session). NS-504: surface an explicit
      // restart affordance instead of leaving a dead terminal that only a
      // full page refresh could recover.
      term.write(
        `\r\n\x1b[90m[session ended (code ${ev.code})]\x1b[0m\r\n`,
      );
      setPtyState("ended");
    };

    // Keystrokes → PTY.
    //
    // IMPORTANT:
    // The embedded web chat has occasionally surfaced stray letters/digits
    // in the input line after a turn completes. The most likely culprit is
    // browser-side terminal control traffic being forwarded back into the
    // PTY as if it were user text. SGR mouse tracking is the highest-risk
    // path here: xterm.js emits raw CSI reports (`\x1b[<...`) that look like
    // ordinary bytes to the backend.
    //
    // For the browser embed we prefer input stability over terminal-style
    // mouse reporting, so we drop SGR mouse reports entirely instead of
    // forwarding them into Hermes. Keyboard input, paste, and resize still
    // behave normally.
      // eslint-disable-next-line no-control-regex -- intentional ESC byte in xterm SGR mouse report parser
      const SGR_MOUSE_RE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/;
      onDataDisposable = term.onData((data) => {
        // Mouse reports (scroll wheel etc.) are not typed input — swallow
        // them before the blocked-input check so scrolling a disconnected
        // terminal doesn't trip the "reconnecting" notice.
        if (SGR_MOUSE_RE.test(data)) {
          return;
        }

        if (
          ws.readyState !== WebSocket.OPEN ||
          shouldBlockPtyInput(ptyStateRef.current)
        ) {
          if (!blockedInputNoticeRef.current) {
            blockedInputNoticeRef.current = true;
            term.write(
              `\r\n\x1b[33m[${PTY_RECONNECT_INPUT_MESSAGE}]\x1b[0m\r\n`,
            );
          }
          return;
        }

        const hasArmedModifier =
          controlArmedRef.current || altArmedRef.current;
        const modifiedData = hasArmedModifier
          ? applyTerminalModifiers(data, {
              control: controlArmedRef.current,
              alt: altArmedRef.current,
            })
          : data;
        if (hasArmedModifier && data.length > 0) {
          clearTerminalModifiers();
        }
        const draftBeforeInput = ptyInputLineRef.current;
        const normalized = normalizePtyMobileInput(
          modifiedData,
          draftBeforeInput,
          Date.now() <= mobileReplacementInputUntilRef.current,
        );
        ptyInputLineRef.current = normalized.nextLine;
        if (normalized.normalized) {
          mobileReplacementInputUntilRef.current = 0;
        }
        ws.send(normalized.data);
        if (
          visibleQueuedImageCountRef.current > 0 &&
          shouldConsumeQueuedImages(normalized.data, draftBeforeInput)
        ) {
          consumeVisibleQueuedImages();
        }
      });

      onResizeDisposable = term.onResize(({ cols, rows }) => {
        if (pinchState || pinchResizePending) return;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(`\x1b[RESIZE:${cols};${rows}]`);
        }
      });
    })();

    term.focus();

    return () => {
      unmounting = true;
      if (uploadImagesRef.current === uploadAndAttachImages) {
        uploadImagesRef.current = null;
      }
      if (flushImageAttachmentsRef.current === flushPendingImageAttachments) {
        flushImageAttachmentsRef.current = null;
      }
      syncMetricsRef.current = null;
      onDataDisposable?.dispose();
      onResizeDisposable?.dispose();
      mobileInputCleanup?.();
      cancelInertia();
      if (pinchSettleRaf) cancelAnimationFrame(pinchSettleRaf);
      host.removeEventListener("touchstart", handleTouchStart);
      host.removeEventListener("touchmove", handleTouchMove);
      host.removeEventListener("touchend", handleTouchEnd);
      host.removeEventListener("touchcancel", handleTouchCancel);
      host.removeEventListener("paste", handleBrowserPaste, true);
      host.removeEventListener("dragover", handleBrowserDragOver, true);
      host.removeEventListener("drop", handleBrowserDrop, true);
      if (metricsDebounce) clearTimeout(metricsDebounce);
      window.removeEventListener("resize", scheduleSyncTerminalMetrics);
      window.visualViewport?.removeEventListener(
        "resize",
        handleVisualViewportResize,
      );
      textarea?.removeEventListener("focus", handleTextareaFocus);
      clearKeyboardRevealSchedule();
      ro.disconnect();
      if (hostSyncRaf) cancelAnimationFrame(hostSyncRaf);
      if (settleRaf1) cancelAnimationFrame(settleRaf1);
      if (settleRaf2) cancelAnimationFrame(settleRaf2);
      clearReconnectTimer();
      clearConnectingTimer();
      connectInFlightRef.current = false;
      // Phase 5.3: ``ws`` is local to the IIFE that opens it (the gated-mode
      // ticket fetch makes the open async). The cleanup runs at the outer
      // effect's top level so it can't reach into that scope — close via
      // the ref instead. ``?.`` covers the race where unmount fires before
      // the ticket fetch resolves and ``wsRef.current`` was never assigned.
      wsRef.current?.close();
      wsRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      if (copyResetRef.current) {
        clearTimeout(copyResetRef.current);
        copyResetRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [
    channel,
    clearReconnectTimer,
    clearTerminalModifiers,
    consumeVisibleQueuedImages,
    imageQueueScope,
    resumeParam,
    scopedProfile,
    reconnectNonce,
  ]);

  // When the user returns to the chat tab (isActive: false → true), the
  // terminal host just transitioned from display:none to display:flex.
  // ResizeObserver won't fire on that kind of style-driven box change —
  // xterm thinks its grid is still whatever it was when the tab was
  // hidden (or 0×0, if it was hidden before first fit).  Force a refit
  // after two animation frames so layout has committed.
  //
  // Focus handling: we only steal focus back into the terminal when
  // nothing else inside ChatPage was holding it (typically the first
  // activation after mount, where document.activeElement is <body>; or
  // a return after the user had been typing in the terminal, where
  // focus was already on the xterm textarea before the tab got hidden
  // and has since fallen back to <body>).  If the user had clicked
  // into the sidebar (model picker, tool-call entry) before switching
  // tabs, we must not yank focus away from wherever they left it when
  // they come back — that's a surprise and an a11y foot-gun.
  useEffect(() => {
    if (!isActive) return;
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf1 = 0;
      raf2 = requestAnimationFrame(() => {
        raf2 = 0;
        syncMetricsRef.current?.();
        const host = hostRef.current;
        const active = typeof document !== "undefined"
          ? document.activeElement
          : null;
        const focusIsElsewhereInChatPage =
          active !== null &&
          active !== document.body &&
          host !== null &&
          !host.contains(active);
        if (!focusIsElsewhereInChatPage) {
          termRef.current?.focus();
        }
      });
    });
    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [isActive]);

  const maybeReconnectOnPageResume = useCallback(() => {
    const visibilityState =
      typeof document !== "undefined" ? document.visibilityState : "visible";
    const online =
      typeof navigator === "undefined" ? true : navigator.onLine !== false;
    const socketReadyState = wsRef.current?.readyState ?? null;

    if (banner && ptyStateRef.current === "closed") {
      return;
    }

    if (
      shouldReconnectPtyOnPageResume({
        isActive,
        visibilityState,
        online,
        socketReadyState,
        ptyState: ptyStateRef.current,
        connectInFlight: connectInFlightRef.current,
      })
    ) {
      const now = Date.now();
      if (now - lastResumeReconnectAtRef.current < PTY_RESUME_RECONNECT_THROTTLE_MS) {
        return;
      }
      lastResumeReconnectAtRef.current = now;
      reconnectPty();
    }
  }, [banner, isActive, reconnectPty]);

  useEffect(() => {
    if (!isActive || typeof window === "undefined") {
      return;
    }

    const onResume = () => maybeReconnectOnPageResume();

    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("pageshow", onResume);
    window.addEventListener("focus", onResume);
    window.addEventListener("online", onResume);

    return () => {
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("pageshow", onResume);
      window.removeEventListener("focus", onResume);
      window.removeEventListener("online", onResume);
    };
  }, [isActive, maybeReconnectOnPageResume]);

  // Keep the live xterm theme in sync when the active theme's terminal
  // colors change (e.g. user switches to a custom YAML theme mid-session).
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = terminalTheme;
  }, [terminalTheme]);

  // Layout:
  //   outer flex column — sits inside the dashboard's content area
  //   row split — terminal pane (flex-1) + sidebar (fixed width, lg+)
  //   terminal wrapper — rounded, dark, padded — the "terminal window"
  //   copy action — icon button in the mobile header toolbar. Sends
  //     `/copy\n` to Ink, which emits OSC 52 → our clipboard handler.
  //   sidebar — ChatSidebar opens its own JSON-RPC sidecar; renders
  //     model badge, tool-call list, model picker. Best-effort: if the
  //     sidecar fails to connect the terminal pane keeps working.
  //
  // Mobile model/tools sheet is portaled to `document.body` so it stacks
  // above the app sidebar (`z-50`) and mobile chrome (`z-40`).  The main
  // dashboard column uses `relative z-2`, which traps `position:fixed`
  // descendants below those layers (see Toast.tsx).
  const reconnectBanner =
    ptyState === "reconnecting"
      ? `Chat connection interrupted${
          lastCloseCode ? ` (code ${lastCloseCode})` : ""
        }. Reconnecting...`
      : null;
  const visibleBanner = banner ?? reconnectBanner;
  const showReconnectOverlay =
    ptyState === "reconnecting" || (ptyState === "closed" && !banner);
  const commandMenuPortal =
    commandMenuOpen &&
    portalRoot &&
    createPortal(
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6">
        <button
          type="button"
          className="absolute inset-0 bg-black/70"
          aria-label="Close slash command menu"
          onClick={() => setCommandMenuOpenRaw(false)}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="slash-command-title"
          className="relative flex max-h-[min(34rem,calc(var(--hermes-visual-viewport-height,100dvh)-1.5rem))] w-full max-w-lg min-h-0 flex-col overflow-hidden rounded-lg border border-current/25 bg-background-base text-midground shadow-2xl"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-current/20 px-4 py-3">
            <div className="min-w-0">
              <div id="slash-command-title" className="font-mondwest text-base font-bold tracking-wide">
                Slash commands
              </div>
              <div className="text-[11px] text-text-secondary">
                Choose from {DASHBOARD_SLASH_COMMANDS.length} actions to insert
              </div>
            </div>
            <Button
              ghost
              size="icon"
              aria-label="Close slash command menu"
              onClick={() => setCommandMenuOpenRaw(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <label className="relative mx-3 mt-3 shrink-0">
            <span className="sr-only">Filter slash commands</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
            <input
              autoFocus
              value={commandQuery}
              onChange={(event) => setCommandQuery(event.target.value)}
              placeholder="Find a command"
              className="h-11 w-full rounded border border-current/25 bg-transparent pl-9 pr-3 text-base text-midground outline-none focus:border-current/60"
            />
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
            {visibleSlashCommands.length ? (
              <div className="grid gap-1.5">
                {visibleSlashCommands.map((item) => (
                  <button
                    key={item.command}
                    type="button"
                    onClick={() =>
                      insertSlashCommand(
                        `${item.command}${item.acceptsArgument ? " " : ""}`,
                      )
                    }
                    className="group flex min-h-16 w-full items-start gap-3 rounded-md border border-current/15 bg-black/10 px-3 py-2.5 text-left transition-colors hover:border-current/35 hover:bg-midground/5 focus-visible:border-current/50 focus-visible:outline-none"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-sm font-semibold tracking-tight text-midground">
                        {item.command}
                        {item.acceptsArgument && (
                          <span className="ml-1 font-normal text-text-secondary">&lt;argument&gt;</span>
                        )}
                      </span>
                      <span className="mt-1 block text-xs leading-snug text-text-secondary">
                        {item.description}
                      </span>
                    </span>
                    <span className="mt-0.5 shrink-0 rounded-full border border-current/20 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-text-secondary">
                      {item.category}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-3 py-10 text-center text-sm text-text-secondary">
                No matching commands.
              </div>
            )}
          </div>
        </div>
      </div>,
      portalRoot,
    );
  const mobileModelToolsPortal =
    isActive &&
    narrow &&
    portalRoot &&
    createPortal(
      <>
        {mobilePanelOpen && (
          <Button
            ghost
            aria-label={t.app.closeModelTools}
            onClick={closeMobilePanel}
            className={cn(
              "fixed inset-0 z-[55] p-0 block",
              "bg-black/60",
            )}
          />
        )}

        <div
          id="chat-side-panel"
          role="complementary"
          aria-label={modelToolsLabel}
          className={cn(
            "font-mondwest fixed top-0 right-0 z-[60] flex h-dvh max-h-dvh w-64 min-w-0 flex-col antialiased",
            "border-l border-current/20 text-midground",
            "transition-transform duration-200 ease-out",
            "[clip-path:var(--component-sidebar-clip-path)]",
            "[border-image:var(--component-sidebar-border-image)]",
            mobilePanelOpen
              ? "translate-x-0"
              : "pointer-events-none translate-x-full",
          )}
          style={{ backgroundColor: "var(--background-base)" }}
        >
          <div
            className={cn(
              "flex h-14 shrink-0 items-center justify-between gap-2 border-b border-current/20 px-5",
            )}
          >
            <Typography
              mondwest
              className="text-display font-bold text-[1.125rem] leading-[0.95] tracking-[0.0525rem] text-midground"
            >
              {t.app.modelToolsSheetTitle}
              <br />
              {t.app.modelToolsSheetSubtitle}
            </Typography>

            <Button
              ghost
              size="icon"
              onClick={closeMobilePanel}
              aria-label={t.app.closeModelTools}
              className="text-text-secondary hover:text-midground"
            >
              <X />
            </Button>
          </div>

          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto overflow-x-hidden",
              "border-t border-current/10",
            )}
          >
            <div className="border-b border-current/10 px-1 py-2">
              <ChatSidebar
                channel={channel}
                profile={scopedProfile}
                onDashboardNewSessionRequest={startFreshDashboardChat}
                onSessionTitleChange={handleSessionTitleChange}
              />
            </div>
            <ChatSessionList
              activeSessionId={resumeParam}
              profile={scopedProfile}
              onPicked={closeMobilePanel}
              onNewChat={startFreshDashboardChat}
            />
          </div>
        </div>
      </>,
      portalRoot,
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <PluginSlot name="chat:top" />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleImagePickerChange}
      />
      {mobileModelToolsPortal}
      {commandMenuPortal}

      {visibleBanner && (
        <div className="border border-warning/50 bg-warning/10 text-warning px-3 py-2 text-xs tracking-wide">
          {visibleBanner}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row lg:gap-3">
        <div
          className={cn(
            "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg",
            "p-2 sm:p-3",
          )}
          style={{
            backgroundColor: terminalBg,
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
          }}
        >
          {narrow && extraKeysOpen && (
            <div
              className="mb-2 flex shrink-0 items-center gap-1 overflow-x-auto overscroll-contain pb-0.5"
              role="toolbar"
              aria-label="Terminal extra keys"
            >
              <button
                type="button"
                aria-pressed={controlArmed}
                onClick={() => toggleTerminalModifier("control")}
                className={cn(
                  "h-9 shrink-0 rounded border px-2.5 text-xs font-bold",
                  controlArmed
                    ? "border-midground bg-midground text-background-base"
                    : "border-current/30 bg-black/20",
                )}
                style={{ color: controlArmed ? undefined : terminalFg }}
              >
                Ctrl
              </button>
              <button
                type="button"
                aria-pressed={altArmed}
                onClick={() => toggleTerminalModifier("alt")}
                className={cn(
                  "h-9 shrink-0 rounded border px-2.5 text-xs font-bold",
                  altArmed
                    ? "border-midground bg-midground text-background-base"
                    : "border-current/30 bg-black/20",
                )}
                style={{ color: altArmed ? undefined : terminalFg }}
              >
                Alt
              </button>
              <button type="button" aria-label="Type slash" title="Type /" onClick={() => sendTerminalExtraKey("slash")} className="h-9 w-9 shrink-0 rounded border border-current/30 bg-black/20 font-mono text-base font-semibold" style={{ color: terminalFg }}>/</button>
              <button type="button" onClick={() => sendTerminalExtraKey("escape")} className="h-9 shrink-0 rounded border border-current/30 bg-black/20 px-2.5 text-xs" style={{ color: terminalFg }}>Esc</button>
              <button type="button" onClick={() => sendTerminalExtraKey("tab")} className="h-9 shrink-0 rounded border border-current/30 bg-black/20 px-2.5 text-xs" style={{ color: terminalFg }}>Tab</button>
              <button type="button" aria-label="Left arrow" onClick={() => sendTerminalExtraKey("left")} className="grid h-9 w-9 shrink-0 place-items-center rounded border border-current/30 bg-black/20" style={{ color: terminalFg }}><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" aria-label="Down arrow" onClick={() => sendTerminalExtraKey("down")} className="grid h-9 w-9 shrink-0 place-items-center rounded border border-current/30 bg-black/20" style={{ color: terminalFg }}><ChevronDown className="h-4 w-4" /></button>
              <button type="button" aria-label="Up arrow" onClick={() => sendTerminalExtraKey("up")} className="grid h-9 w-9 shrink-0 place-items-center rounded border border-current/30 bg-black/20" style={{ color: terminalFg }}><ChevronUp className="h-4 w-4" /></button>
              <button type="button" aria-label="Right arrow" onClick={() => sendTerminalExtraKey("right")} className="grid h-9 w-9 shrink-0 place-items-center rounded border border-current/30 bg-black/20" style={{ color: terminalFg }}><ChevronRight className="h-4 w-4" /></button>
            </div>
          )}
          <div
            ref={hostRef}
            className="hermes-chat-xterm-host min-h-0 min-w-0 flex-1"
          />

          {visibleQueuedImages.length > 0 && (
            <div
              className="mt-2 shrink-0 rounded border border-current/25 bg-black/25 px-2.5 py-2"
              style={{ color: terminalFg }}
              aria-label="Images attached for the next prompt"
            >
              <div className="mb-1.5 flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest opacity-75">
                <span>Attached for next prompt</span>
                <span>{visibleQueuedImages.length}</span>
              </div>
              <div className="flex gap-1.5 overflow-x-auto overscroll-contain pb-0.5">
                {visibleQueuedImages.map((image) => (
                  <div
                    key={image.id}
                    className={cn(
                      "flex min-w-0 max-w-56 shrink-0 items-center gap-2 rounded border px-2 py-1.5",
                      image.status === "error"
                        ? "border-warning/60 bg-warning/10"
                        : "border-current/25 bg-black/25",
                    )}
                  >
                    <ImagePlus className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0">
                      <span className="block truncate text-xs leading-tight">
                        {image.name}
                      </span>
                      <span className="block text-[9px] uppercase tracking-wider opacity-65">
                        {image.status === "ready"
                          ? "ready"
                          : image.status === "attaching"
                            ? "connecting"
                            : image.status}
                      </span>
                    </span>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={openImagePicker}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded border border-dashed border-current/35 bg-black/15"
                  aria-label="Attach another image"
                  title="Attach another image"
                >
                  <ImagePlus className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {showReconnectOverlay && (
            <div className="absolute inset-x-3 top-3 z-20 flex justify-center sm:inset-x-auto sm:right-3 sm:justify-end">
              <div className="flex max-w-[min(28rem,calc(100vw-3rem))] flex-col items-start gap-2 border border-warning/60 bg-black/80 px-3 py-2 text-xs text-warning shadow-lg">
                <div className="tracking-wide">
                  {ptyState === "reconnecting"
                    ? "Chat is reconnecting."
                    : "Chat disconnected."}
                </div>
                <Button
                  size="sm"
                  outlined
                  onClick={reconnectPty}
                  prefix={<RotateCcw className="h-4 w-4" />}
                  aria-label="Reconnect chat"
                >
                  Reconnect now
                </Button>
              </div>
            </div>
          )}

          {/* NS-504: the agent process exited (e.g. `/exit` or a new session).
              Offer an in-place restart so the user never has to refresh the
              whole page to get a working chat back. */}
          {ptyState === "ended" && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/60">
              <div className="text-sm tracking-wide text-white/80">
                Session ended.
              </div>
              <Button
                onClick={startFreshPty}
                prefix={<RotateCcw className="h-4 w-4" />}
                aria-label="Start a new chat session"
              >
                Start new session
              </Button>
            </div>
          )}
        </div>

        {!narrow && (
          <div
            id="chat-side-panel"
            role="complementary"
            aria-label={modelToolsLabel}
            className="flex min-h-0 shrink-0 flex-col gap-3 overflow-hidden lg:h-full lg:w-60"
          >
            {/* Model picker — keeps the rail thin. */}
            <div className="shrink-0">
              <ChatSidebar
                channel={channel}
                profile={scopedProfile}
                onDashboardNewSessionRequest={startFreshDashboardChat}
                onSessionTitleChange={handleSessionTitleChange}
              />
            </div>

            {/* Session switcher fills the remaining height below the model box. */}
            <div className="min-h-0 flex-1 overflow-hidden">
              <ChatSessionList
                activeSessionId={resumeParam}
                profile={scopedProfile}
                onNewChat={startFreshDashboardChat}
              />
            </div>
          </div>
        )}
      </div>
      <PluginSlot name="chat:bottom" />
    </div>
  );
}

declare global {
  interface Window {
    __HERMES_SESSION_TOKEN__?: string;
    __HERMES_AUTH_REQUIRED__?: boolean;
  }
}
