# Mobile Dashboard Iteration Log

This file records local, incremental mobile-UI experiments so each build can be tested and evaluated independently.

## Iteration 1 — Single viewport and cleaner terminal scrolling

### Goal

Remove the most obvious nested-scroll behavior from the mobile Chat page and make the navigation drawer easier to read, without yet changing keyboard-focus or terminal sizing behavior.

### Changes

- Locked `html`, `body`, and `#root` to the dynamic mobile viewport (`100dvh`) below 768px.
- Removed document-level mobile scrolling.
- Added an internal scrolling container for non-Chat dashboard pages.
- Kept the Chat route contained with `overflow: hidden` so xterm owns transcript scrolling.
- Preserved touch scrolling inside xterm while hiding its desktop-style scrollbar.
- Added scroll containment to stop terminal boundary swipes from propagating into the application shell.
- Made the mobile hamburger navigation drawer use the opaque dashboard base color instead of a potentially translucent themed background.

### Intentionally deferred

- Input-focus zoom and software-keyboard viewport behavior.
- Edge-to-edge terminal sizing and removal of decorative terminal padding.
- Mobile Chat header/control redesign.
- Mobile model/session side-sheet opacity.

These are deferred so feedback can isolate whether the viewport and scrolling changes improve the experience before more variables are changed.

### Files

- `web/src/index.css`
- `web/src/App.tsx`
- `web/src/mobile-layout.test.ts`

### Verification

- Focused regression test: 4 passed.
- Full frontend suite: 76 passed.
- TypeScript typecheck: passed.
- Production Vite build: passed.
- Running dashboard HTTP check on port 9119: 200.

### Mobile feedback checklist

1. Does the whole webpage stay fixed while Chat is open?
2. Does swiping inside Chat scroll only terminal history?
3. Is the right-side terminal scrollbar gone?
4. Is the hamburger drawer fully opaque and readable?
5. Can non-Chat pages still scroll normally inside the app?
6. Did anything become clipped or unreachable?

## Iteration 2 — Stable keyboard focus and real touch scrollback

### Feedback

Iteration 1 felt roughly unchanged. The highest-value interactions remain text input and scrolling through terminal output.

### Root cause findings

- The installed xterm.js 6 release renders a custom VS Code-style scrollbar under `.xterm-scrollable-element`, not the older `.xterm-viewport` native scrollbar targeted in Iteration 1. The first scrollbar rule therefore did not affect the element actually visible on screen.
- xterm's hidden keyboard textarea inherits a dashboard font size below the mobile-safe 16px focus threshold. Mobile browsers may zoom or pan when focusing it even though it is visually hidden.
- This xterm build handles mouse-wheel events but does not register its bundled touch gesture adapter on the terminal viewport. Finger drags therefore had no direct path to `term.scrollLines()`.

### Changes

- Correctly hid the xterm.js 6 custom scrollbar.
- Set the hidden xterm keyboard textarea to a 16px font size on mobile to prevent focus zoom without changing visible terminal text.
- Added a one-finger touch adapter that translates vertical drag distance into terminal scrollback lines.
- Accumulates movement smaller than one terminal row so slow drags remain responsive.
- Contains touch gestures inside Chat and preserves tap-to-focus behavior.

### Files

- `web/src/index.css`
- `web/src/pages/ChatPage.tsx`
- `web/src/lib/pty-mobile-scroll.ts`
- `web/src/lib/pty-mobile-scroll.test.ts`
- `web/src/mobile-layout.test.ts`

### Verification before device feedback

- Focused interaction tests: 9 passed.
- TypeScript production compilation: passed.
- Production Vite build: passed.

### Mobile feedback checklist

1. Does tapping the terminal still open the software keyboard?
2. Does the page remain at the same zoom level when the keyboard opens?
3. Can you type a full prompt without the terminal jumping or panning unexpectedly?
4. Does dragging downward reveal older terminal output?
5. Does dragging upward return toward newer output?
6. Does slow dragging feel responsive enough?
7. Is the previously visible right-side scrollbar now gone?

## Iteration 3 — Fast-swipe momentum

### Feedback

Iteration 2 substantially improved terminal scrolling and responsiveness. Slow and direct dragging feels right, but a fast swipe stops too abruptly.

### Changes

- Track swipe velocity without changing direct one-finger drag sensitivity.
- Continue scrolling after a sufficiently fast release.
- Decay momentum smoothly on animation frames.
- Stop momentum immediately when a new touch begins.
- Do not apply momentum to taps, slow drags, or cancelled gestures.

### Verification

- Momentum unit tests: 6 passed.
- Complete frontend suite: 83 passed across 13 files.
- TypeScript checks and production build: passed.

## Iteration 4 — Mobile image picker and opaque Tools sheet

### Feedback

Portrait mode needs a convenient native attachment control, and the mobile model/tools sheet still shows terminal content through its themed background.

### Changes

- Added an image-picker button to the mobile Chat header.
- Uses the existing dashboard image upload and Hermes `/image <path>` attachment flow.
- Accepts one or multiple images from Android's native camera/gallery/file chooser.
- Clears the picker after each selection so the same image can be selected again.
- Disables the picker while the PTY is disconnected.
- Removed the translucent themed background from the mobile Tools sheet and applied an explicitly opaque base color.

### Deferred to the next iterations

- General document/video staging through `@file:` references.
- Immediate portrait keyboard/cursor positioning.
- Pinch or button-driven terminal text resizing.

### Verification

- Focused mobile layout and image-path tests: 15 passed.
- Complete frontend suite: 85 passed across 13 files.
- TypeScript checks and production build: passed.

## Iteration 5 — Termux-style text scaling and keyboard-aware viewport

### Feedback

The image attachment control feels good. The remaining portrait priorities are two-finger terminal text resizing and revealing the active input line immediately when Android opens the keyboard.

### Changes

- Added terminal-scoped two-finger gestures:
  - pinch in to zoom out;
  - pinch out / spread to zoom in.
- Scales xterm's visible font within readable 6–24 px bounds rather than zooming the browser page.
- Refits the xterm grid and reports updated rows and columns to the PTY after scaling.
- Preserves the existing one-finger direct scrolling and fast-swipe momentum paths.
- Mirrors `window.visualViewport.height` into the mobile app shell while the dashboard is mounted.
- When the focused xterm input sees a visual-viewport resize, immediately refits the terminal and reveals the bottom input line.
- Keeps the hidden xterm helper textarea at 16 px, independent of visible terminal scaling.

### Verification

- Pinch calculation tests: 5 passed.
- Mobile layout tests: 9 passed.
- Full frontend suite: 14 files / 92 tests passed.
- TypeScript checks and production build: passed.

## Iteration 6 — Visual-viewport shell, command menu, and extra keys

### Feedback

The Android keyboard could still cover the active input because the inner React app shell retained its own `100dvh` height even after the document root followed `visualViewport.height`. Mobile also needed discoverable slash commands and Termux-style accessibility keys.

### Changes

- Changed the inner dashboard shell from `h-dvh max-h-dvh` to `h-full max-h-full`, so it inherits the visual-viewport-constrained root instead of overflowing it.
- Extended visual-viewport sizing through the dashboard's full mobile/tablet breakpoint (up to 1023 px), including foldable-width layouts.
- Added a `/` button beside the image button in the mobile header.
- Added a searchable, internally scrollable modal with 28 common Hermes slash commands; choosing one inserts it into the terminal composer for review.
- Added a keyboard button beside the slash button that toggles an optional horizontal extra-key row.
- Added Ctrl and Alt sticky modifiers plus Esc, Tab, and arrow keys.
- Added standard modified-arrow escape sequences for Ctrl+Arrow, Alt+Arrow, and Ctrl+Alt+Arrow.

### Verification

- Extra-key behavior tests: 5 passed.
- Slash-command menu tests: 2 passed.
- Mobile layout contract tests: 10 passed.
- Full frontend suite: 16 files / 100 tests passed.
- TypeScript checks and production build: passed.

## Iteration 7 — Keyboard focus race and clearer command affordances

### Feedback

Opening the Android keyboard still moved xterm to the beginning of scrollback before the first typed character restored the prompt. The command button looked too much like a literal slash key, commands were visually unclear in the menu, and the extra-key row needed a real `/` input key.

### Changes

- Records a two-second terminal-focus intent window on touch so visual-viewport resize handling can recognize the tap-to-keyboard race before the hidden xterm textarea becomes `document.activeElement`.
- Pins the prompt before and after each fit, then repeats the fit/reveal at 80, 180, and 320 ms as Android completes its keyboard animation.
- Keeps unrelated viewport resizes from forcing deliberate scrollback to the bottom.
- Replaced the tilted slash header icon with a square terminal/command-palette icon.
- Redesigned command rows so the literal `/command` is the prominent first line, arguments are explicit, descriptions sit below, and categories appear as compact pills without decorative left bars.
- Added a literal `/` key to the optional terminal extra-key row.
- Sticky Ctrl/Alt now disarm after any input and leave multi-character mobile replacement input unchanged, preventing modifiers from contaminating IME replacement bursts.

### Verification

- Focused keyboard, key, command, and layout tests: 4 files / 22 tests passed.
- Full frontend suite: 17 files / 105 tests passed.
- TypeScript checks and production build: passed.
- The built dashboard was served locally and its production bundle contained the new command-palette and slash-key controls.
- Real-device confirmation of the Android keyboard animation remains the required subjective check.

## Iteration 8 — Reliable session switching and reconnect-safe image attach

### Feedback

Selecting a conversation from the mobile Model and Tools sheet changed the apparent selection but left Chat at a fresh-session screen with no restored history. Image bytes could upload successfully while the PTY disconnected, after which the UI asked the user to try the whole upload again.

### Root causes

- Every Chat target reused one browser-tab-wide PTY keep-alive token. The backend registry therefore reattached the already-running PTY and never invoked the spawn closure containing the newly selected `?resume=<id>` argument.
- Image paths were driven directly into whichever WebSocket happened to be open when the HTTP upload completed. A transient close in that window discarded the attachment handoff even though the staged file already existed.

### Changes

- Scoped PTY keep-alive identities by profile and resumed session, with a separate rotatable identity for fresh chats.
- Added a component-level pending image-path queue.
- Retains staged image paths while disconnected and flushes them from the next PTY socket's `open` handler.

### Verification

- New session-identity and attachment-queue tests: 4 passed.
- Complete frontend suite: 19 files / 112 tests passed.
- TypeScript checks and production build: passed.
- Real-device confirmation: switching sessions from the hamburger sheet now works; large-history xterm hydration can still render blank rows temporarily while replay catches up.

## Iteration 9 — Multi-image queue for the next prompt

### Feedback

The image button should behave like a modern multimodal chat composer: selecting one or more images stages them visibly, allows more images to be added, and sends the full set with the next ordinary prompt rather than presenting upload transport details.

### Design

- Hermes already has the required native semantics: each `image.attach` appends to the TUI session's `attached_images`, and `prompt.submit` atomically consumes that list with the next user message.
- The dashboard uploads browser `File` objects, then injects each server path as bracketed paste. The TUI recognizes the path as an image without replacing an existing composer draft.
- Slash commands do not consume the image queue; the next ordinary prompt does.

### Changes

- Added a compact, horizontally scrollable **Attached for next prompt** tray with per-image upload/connection/ready/error status and an add-more button.
- Added an attachment-count badge to the mobile image button and permits staging during transient reconnects.
- Keeps pending upload handoffs isolated by logical profile/session so an image queued in session A cannot leak into session B.
- Serializes reconnect flushes to prevent duplicate attachment commands.
- Clears the visible tray when the next ordinary prompt is submitted while retaining it across slash commands and temporary PTY reconnects.

### Verification

- Queue semantics, reconnect handoff, and session-isolation regressions: 8 focused tests passed.
- Complete frontend suite: 20 files / 116 tests passed.
- TypeScript checks and production build: passed; 499 modules transformed.
- The live dashboard returned HTTP 200 and served the new production bundle containing the queue tray, add-more action, and reconnect state.
- Python gateway tests were not runnable in the Android environment because the project test environment attempts to build `psutil`, which rejects Android. The gateway code was inspected but not modified in this iteration.
