# 🥒 Pepino

A full-featured IDE for mobile. Android-first, iOS on the way.

## Vision

A native code IDE for mobile with: code editor, local git and GitHub,
terminal (Android), its own plugin system (sandboxed JS scripts) and
AI agent assistance in the future.

## Key decisions

| Decision | Choice                                                                                | Why                                                 |
| -------- | ------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Platform | Android-first, iOS with reduced scope                                                 | iOS allows neither a real terminal nor JIT          |
| Stack    | TypeScript + React + Vite, Capacitor shell                                            | Full control over design, web tooling, one codebase |
| Plugins  | Interpreted JS scripts (QuickJS)                                                      | Legal on iOS, sandboxable, portable                 |
| Git      | JGit in a native plugin ([ADR-006](docs/decisions/ADR-006-git.md))                    | Full git (merge, stash, revert…) on the device      |
| Terminal | Own PTY in C + xterm.js, Android only ([ADR-008](docs/decisions/ADR-008-terminal.md)) | A real shell; iOS lets no app start processes       |

See [docs/decisions](docs/decisions) for the ADRs (stack: [ADR-004](docs/decisions/ADR-004-typescript.md)),
[docs/roadmap.md](docs/roadmap.md) for the full sprint plan and
[docs/plugin-api/v1-spec.md](docs/plugin-api/v1-spec.md) for the plugin API.

## Status

🚧 Sprint 5 (Terminal v1) in progress: projects, editor, git and GitHub are in place.

## Setup

Requirements: Node 22+. For Android builds: Android SDK (API 36), JDK 21 and NDK 27.2.12479018
(the terminal's PTY, built with ndk-build: `sdkmanager "ndk;27.2.12479018"`).
iOS builds require macOS with Xcode.

```bash
npm ci

# Browser (fast UI iteration; the filesystem lives in IndexedDB)
npm run dev            # http://localhost:5173 — component catalog at /#catalog

# Checks
npm run typecheck && npm run lint && npm test

# Android (emulator or device)
npm run build
npx cap sync android
npx cap run android    # or open android/ in Android Studio
```
