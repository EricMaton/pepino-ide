# Contributing to Pepino

## Conventions

- **Conventional Commits** for commit messages and PR titles:
  `feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `refactor:`, `test:`, `perf:`
  (e.g. `feat: add file explorer`). PR titles are enforced by CI and become
  the squashed commit message.
- **ktlint** for Kotlin formatting — run `./gradlew ktlintFormat` before pushing.
- **detekt** for static analysis — run `./gradlew detekt`.
- Every PR runs CI: lint, Android build + tests, iOS framework build.
- Feature work happens in its own module (`:core:*`, `:feature:*`), never in `:app`.

## Workflow

1. Branch from `main`: `feat/<issue>-short-name` or `chore/...`, `fix/...`
2. Open a PR against `main` (template included)
3. Merge with squash once CI is green
