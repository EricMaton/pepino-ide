# Sprint 1 — Espacio de proyectos

**Duración:** 2 semanas
**Objetivo:** carpeta reservada de proyectos + file explorer táctil.

> **Nota (ADR-004):** las tres primeras tareas se hicieron en Kotlin y se portaron a TypeScript en #96.

## Tareas

- [x] Definir y crear la carpeta reservada en el storage de la app (scoped storage correcto)
- [x] File explorer táctil: lista de archivos, navegación, ordenación
- [x] Operaciones: crear archivo/carpeta, renombrar, mover, copiar, borrar (con confirmación)
- [x] Abrir/cerrar proyecto (proyecto = carpeta con marcador `.pepino/project.json`)
- [x] Lista de proyectos recientes en la home
- [ ] Manejo de permisos: flujo cuando el usuario no ha dado acceso (con el almacenamiento privado de la app no hace falta permiso; ver #13)
- [x] Tests unitarios de la capa de datos del filesystem

## Criterios de aceptación

1. El usuario puede crear un proyecto nuevo y ver sus archivos sin salir de la app.
2. Todas las operaciones de archivo funcionan 100% táctiles (sin menús de escritorio).
3. Los proyectos recientes persisten entre reinicios de la app.
