# Contributing to Pepino

## Conventions

- **Conventional Commits** for commit messages and PR titles:
  `feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `refactor:`, `test:`, `perf:`
  (e.g. `feat: add file explorer`). PR titles are enforced by CI and become
  the squashed commit message.
- **Prettier** for formatting — run `npm run format` before pushing.
- **ESLint** (typescript-eslint + react-hooks) — run `npm run lint`.
- **Vitest** for tests — `npm test`. Pure logic lives outside components so it
  can be tested without a DOM.
- Every PR runs CI: typecheck, lint, format check, tests, web build and the
  Android debug build.

## Code layout

```
src/
├── app/         shell: navigation, command palette, service wiring
├── core/        commands + events — the backbone plugins talk to
├── ui/          design system: tokens, components, back handling
├── features/    one folder per feature (projects, editor, git…)
└── dev/         dev-only tools (component catalog at /#catalog)
android/         Capacitor Android project (native code only)
```

- Feature work lives in `src/features/<feature>`, never in `src/app`.
- Components only use design tokens (`var(--…)`), never hardcoded colors.
- Native APIs go through Capacitor plugins behind an interface, so the logic
  can be tested with an in-memory implementation (see `FsBackend`).

## Workflow

1. Branch from `main`: `feat/<issue>-short-name` or `chore/...`, `fix/...`
2. Open a PR against `main` (template included)
3. Merge with squash once CI is green
