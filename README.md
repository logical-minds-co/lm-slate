# Slate

A hyper-focus workspace. One window, one slate at a time, nothing else.
Each slate (tab) is either a **terminal** or a **browser** (Chromium). The UI is ink on glass.

The tab row is invisible by default. It shows up when you hover the top edge, hold `⌃` (the `⌃Tab` modifier), or for a second after you open or switch a tab.
Everything else lives in the command palette (`⌘K`): slates, commands, search engine, and "go to" for anything you type.
A new browser tab is just a centered field: type an address or a search, press enter.

## Run

```bash
npm install     # also rebuilds node-pty against Electron
npm run dev     # build + launch
npm run watch   # rebuild on change (relaunch with `npm start`)
```

## Keys

| Key | Action |
|---|---|
| `⌘K` / `⌘P` | command palette — type to filter slates and commands, `↵` to run, `⌘⌫` to close the selected slate, `esc` to dismiss; free text becomes "open / search" |
| `⌘⇧O` | overview: a live mosaic of every slate — pages tiled and zoomed out, terminals as text snapshots; `←↑→↓`/`1–9` to pick, `↵`/click to switch, `esc` to close |
| `⌘⇧R` | start / stop screen recording (mp4 in `~/Movies/Slate`; a `● 0:12` counter shows in the macOS menu bar, not in the video) |
| `⌘⌥⇧R` | start a screen recording **with the microphone** mixed in (walkthroughs); stop with `⌘⇧R` |
| `⌘⇧F` | focus on a task: type `write the report 25` → 25-minute session (minutes optional) |
| `⌘,` | settings (`slate://settings`): search engine, focus length, blocked domains, recording mode, microphone, recordings and downloads folders |
| `⌘T` | new browser tab |
| `⌘N` | new terminal tab |
| `⌘L` | edit the address (opens a browser tab if you're in a terminal) |
| `⌘W` | close tab |
| `⌘1…9` | jump to tab |
| `⌃Tab` / `⌃⇧Tab`, `⌘⇧]` / `⌘⇧[`, `⌘⌥→` / `⌘⌥←` | next / previous tab |
| `⌘[` / `⌘]` / `⌘R` | back / forward / reload (browser) |
| `⌘⇧E` | open the current page in your default browser (for things the embedded browser can't do — see below) |
| `Esc` (inside a page) | back to the address field |
| `⌘⇧D` | light ⇄ dark ink |
| `⌘⇧G` | frosted ⇄ clear glass |

Anything typed that doesn't look like a URL is searched with the engine chosen in **Browse → Search Engine** (Google by default; DuckDuckGo, Bing and Brave available — add more in `src/shared/search.ts`).
Links clicked in a terminal open in a new browser tab. The session (tabs, theme) is restored on launch.

## Focus sessions

`⌘⇧F` (or the palette's *Focus on a task…*) asks for a task and a length. While the session runs, the task and a countdown sit at the right of the top bar (click to end early), and any domain listed in settings redirects to `slate://blocked` — a page that shows the task and the time left, with a way out if you really need it. When the timer ends you get a system notification and a beep; the bar shows `✓ task` for a few seconds. Sessions survive a restart.

## Overview

`⌘⇧O` tiles every slate into a grid. Browser slates are the real `WebContentsView`s, moved into their cells and zoomed out (Chromium's floor is 25%), so they stay live; terminals are rendered from their text buffers by the overlay page. Chromium persists zoom per origin, so views reset to 100% on every navigation outside the overview.

## Screen recording

`⌘⇧R` shows a 3-second countdown on the glass (`esc` or `⌘⇧R` again cancels), then records the Slate window to `~/Movies/Slate/slate-<timestamp>.mp4` (H.264 straight from `MediaRecorder`). Two modes, chosen in settings:

- **Glass** (default when `ffmpeg` is on the PATH): records the display the window is on and crops to the window afterwards, so the frosted background in the video is the real thing. Keep the window still while recording — the crop rectangle is taken at start.
- **Window**: isolated window capture. No cropping step, but macOS renders the vibrancy on a flat backdrop, so the glass looks solid.

`⌘⌥⇧R` (or *Start screen recording with microphone* in the palette) records the same way but mixes the default microphone in as AAC, with echo cancellation and noise suppression on; the menu-bar counter reads `● 0:12 mic`. Silent recording stays the default so a stray `⌘⇧R` never captures audio.

Settings let you pick the microphone (matched by device name, so it survives re-plugging), the recordings folder (default `~/Movies/Slate`) and the downloads folder (default `~/Downloads`). Downloads from browser slates go straight there, no dialog; a notification shows when one finishes and clicking it reveals the file.

macOS will ask for Screen Recording (and, with `⌘⌥⇧R`, Microphone) permission the first time (for the Electron binary in development, for Slate once packaged). The only in-app indicator is a `● m:ss` counter in the menu bar — click it to stop — so nothing recording-related ends up in the footage.

## What the embedded browser can't do (yet)

**Passkeys.** Electron doesn't ship Chrome's WebAuthn UI. Since Electron 44 there is `session.configureWebAuthn({ touchID })`, but it only enables a *device-bound* Touch ID / Secure Enclave authenticator — not iCloud Keychain or password-manager passkeys — and it needs a signed app with the `keychain-access-groups` entitlement, which the unsigned development binary doesn't have. So a site asking for a passkey (Vercel, GitHub, …) gets no dialog. Use another sign-in method (email code, OAuth) inside Slate, or `⌘⇧E` to finish in your default browser.

## How it's built

- `src/main/` — Electron main process. `tabs.ts` owns the tab list: terminals are `node-pty` processes, browsers are `WebContentsView`s laid out under the 40px top bar. `menu.ts` holds every shortcut. `settings.ts` persists the session (tabs, theme, glass mode, search engine) to `slate.json` in the app's user-data dir. A blank browser tab keeps its Chromium view hidden, so the renderer's centered field is what you see.
- `src/main/palette.ts` — the command palette: a transparent `WebContentsView` kept above the browser views (so it works over any page), shown on demand. Actions are strings (`tab:<id>`, `cmd:<name>`, `engine:<key>`, `go:<text>`) it hands back to main.
- `src/palette/` — the palette page (list, fuzzy filter, keyboard). Commands are declared in `src/shared/palette.ts`.
- `src/main/overview.ts` — grid layout and the live tiling of browser views for `⌘⇧O`; the overlay page draws the cells.
- `src/main/recorder.ts` — picks the capture source (`setDisplayMediaRequestHandler`), writes the chunks the renderer's `MediaRecorder` streams over IPC, shows the menu-bar counter, and runs the optional ffmpeg pass (faststart remux, or crop + re-encode in glass mode).
- `src/main/focus.ts` — domain normalisation/matching, the `webRequest` hook that redirects blocked main-frame navigations, and the end-of-session notification. Session state itself lives in `TabManager` (`startFocus`, `stopFocus`, `isBlocked`).
- `src/internal/` — the `slate://` pages (`settings`, `blocked`), served by `protocol.handle` from `dist/internal/`. They talk to main through `src/preload/internal.ts`, which only exposes `window.slateInternal` on `slate:` origins; main double-checks the sender URL.
- `src/preload/` — the tiny `window.slate` bridge (context-isolated, sandboxed), shared by the main page and the palette.
- `src/renderer/` — the top bar, the address field and the xterm.js terminals. Everything is transparent; the glass comes from macOS vibrancy (`menu` material) or, in clear mode, from nothing at all.
- `scripts/build.mjs` — esbuild for all three targets into `dist/`.

`SLATE_TEST=overview|record` opens the overview / records five seconds shortly after launch, for checks without keyboard input. `SLATE_VIBRANCY=<material>` overrides the macOS material (`sidebar`, `hud`, `fullscreen-ui`, `under-window`, …) for experimenting.
