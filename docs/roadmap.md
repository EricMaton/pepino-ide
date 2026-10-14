# Roadmap

## North star del MVP

> Editar un archivo, hacer commit y abrir un PR desde el móvil en menos de 30 segundos.

## Lo que NO entra en la fase 1 (fase 2 / backlog)

- Debugger
- LSP / IntelliSense completo
- Cargar extensiones del marketplace de VS Code
- Agentes autónomos estilo Claude Code en background
- Multi-window / tablets
- Sync de proyectos en la nube

## Sprints

| Sprint | Nombre | Objetivo |
|---|---|---|
| 0 | Cimientos | App compilando (Android + iOS stub), módulos, CI, sistema de comandos/eventos |
| 1 | Espacio de proyectos | Carpeta reservada, file explorer táctil, abrir proyecto |
| 2 | Editor v1 | Syntax highlighting, edición táctil, toolbar, autosave |
| 3 | Git local | Commits, branches, diff, history, snapshots |
| 4 | GitHub | OAuth, repos, clone/push/pull, crear PR |
| 5 | Terminal v1 (Android) | PTY, shell, teclado terminal |
| 6 | Personalización + núcleo de plugins | Temas, settings, loader de manifests, motor QuickJS |
| 7 | Plugins reales + API v1 | 3 plugins de ejemplo, docs, repo de plugins |
| 8 | Spike agente IA | Integración Claude API, diffs inline aceptar/rechazar |
| 9-10 | Pulido y release | Performance, onboarding, closed testing |

## Arquitectura de referencia

Stack: TypeScript + React + Vite dentro de Capacitor ([ADR-004](decisions/ADR-004-typescript.md)).

```
src/app                  shell: navegación, paleta de comandos, wiring de servicios
src/core/commands        registro y dispatcher de comandos (columna vertebral)
src/core/events          bus de eventos tipado
src/core/plugins         loader de manifests, sandbox QuickJS (WASM), permisos
src/ui                   design system brutalista (tokens + componentes)
src/features/projects    file explorer, gestión de proyectos
src/features/editor      editor de código (CodeMirror 6)
src/features/git         git local + GitHub
src/features/terminal    terminal embebida (Android only; PTY en plugin nativo)
src/features/settings    temas y personalización
android/ · ios/          proyectos nativos de Capacitor
```

Los agentes IA del futuro consumen la **misma API de plugins** que los
scripts de usuario: el "AI Assistant" será un plugin más con permiso `network`.
