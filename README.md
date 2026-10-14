# 🥒 Pepino

Un IDE completo para móvil. Android-first, iOS en camino.

## Visión

Un IDE de código nativo para móvil con: editor de código, git local y GitHub,
terminal (Android), sistema de plugins propio (scripts JS sandboxeados) y
asistencia de agentes IA en el futuro.

## Decisiones clave

| Decisión | Elección | Por qué |
|---|---|---|
| Plataforma | Android-first, iOS con scope reducido | iOS no permite terminal real ni JIT |
| Stack | Kotlin Multiplatform + Compose Multiplatform | 70% de código compartido, acceso nativo en Android |
| Plugins | Scripts JS interpretados (QuickJS) | Legal en iOS, sandboxeable, portable |
| Git | libgit2 vía bindings KMP | Git real, no reimplementación |

Ver [docs/roadmap.md](docs/roadmap.md) para el plan completo por sprints y
[docs/plugin-api/v1-spec.md](docs/plugin-api/v1-spec.md) para la API de plugins.

## Estado

🚧 En fase de cimientos. Sprint 0 en curso.

## Setup (cuando exista código)

```bash
# Próximamente — Sprint 0
```
