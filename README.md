# 🥒 Pepino

A full-featured IDE for mobile. Android-first, iOS on the way.

## Vision

A native code IDE for mobile with: code editor, local git and GitHub,
terminal (Android), its own plugin system (sandboxed JS scripts) and
AI agent assistance in the future.

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| Platform | Android-first, iOS with reduced scope | iOS allows neither a real terminal nor JIT |
| Stack | Kotlin Multiplatform + Compose Multiplatform | 70% shared code, native access on Android |
| Plugins | Interpreted JS scripts (QuickJS) | Legal on iOS, sandboxable, portable |
| Git | libgit2 via KMP bindings | Real git, not a reimplementation |

See [docs/roadmap.md](docs/roadmap.md) for the full sprint plan and
[docs/plugin-api/v1-spec.md](docs/plugin-api/v1-spec.md) for the plugin API.

## Status

🚧 Laying the foundations. Sprint 0 in progress.

## Setup

Requirements: JDK 17+, Android SDK (API 35). iOS builds require macOS with Xcode.

```bash
# Android app
./gradlew :app:assembleDebug

# iOS framework (macOS only)
./gradlew :app:linkDebugFrameworkIosSimulatorArm64
```
