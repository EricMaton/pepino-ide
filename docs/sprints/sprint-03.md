# Sprint 3 — Git local

**Duración:** 2 semanas
**Objetivo:** control de versiones local completo.

## Tareas

- [x] Spike al inicio del sprint: isomorphic-git sobre `ProjectSpace` frente a un plugin Capacitor nativo (JGit / libgit2); decidir con medidas y documentar en un ADR ([ADR-006](../decisions/ADR-006-git.md): JGit, #21)
- [x] `git init` / abrir repo existente en un proyecto (#22)
- [x] Commits con mensaje, staging de archivos (#23; el stage parcial, por líneas, va con el diff viewer #25)
- [x] Branches: crear, cambiar, borrar, lista (#24)
- [x] Diff viewer táctil (cambios por archivo, antes/después) y stage por líneas tocando el diff (#25)
- [x] History: log de commits con autor, fecha, mensaje; cada commit abre sus archivos y su diff (#26)
- [x] Snapshot automático pre-cambio + integración con el autosave del editor: snapshots en `refs/pepino/snapshots` antes del primer guardado y de cambiar de rama, y "Earlier versions" en el editor para restaurarlos (#27)
- [x] Tests de las operaciones core de git (#28): JUnit sobre JGit en la JVM, incluido el flujo completo y matar la app a mitad de commit (`CommitCrashTest`); `GitOpsDeviceTest` en Android (API 26 y 35, a mano: `adb shell am instrument`), y el puente TS al plugin en Vitest

## Criterios de aceptación

1. Flujo completo táctil: editar → stage → commit → ver en history.
2. El diff viewer es legible en pantalla de 6 pulgadas.
3. Ningún estado se pierde si la app muere a mitad de un commit.
