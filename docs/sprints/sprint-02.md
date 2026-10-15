# Sprint 2 — Editor v1

**Duración:** 2 semanas
**Objetivo:** editor usable para editar código en el móvil.

## Tareas

- [x] Editor con syntax highlighting: CodeMirror 6 (Lezer), decidido en ADR-005
- [x] Edición táctil: posicionar cursor preciso, selección, gestos de zoom de texto (validado con Gboard en el WebView del emulador, #16; SwiftKey pendiente)
- [x] Toolbar configurable encima del teclado: símbolos `{}[]()=;`, tab, undo/redo (botones = comandos del `CommandRegistry`)
- [x] Autosave con snapshot antes de cada edición (el SO mata apps: nunca perder trabajo; guardar también en el evento `pause` de la app)
- [x] Estado del editor restaurado al reabrir (scroll, cursor, archivo abierto)
- [x] Soportar archivos de al menos 5k líneas sin tirones visibles (medido en [performance.md](../performance.md); falta dispositivo real, #16)
- [x] Workspace del proyecto (#106): árbol con acciones, open files, búsqueda de archivos y API
- [ ] Teclado Pepino opcional para código (#107)

## Criterios de aceptación

1. Se puede editar un archivo .kt / .js / .py con highlighting correcto.
2. Cerrar la app a mitad de edición y reabrir restaura todo sin pérdida.
3. La toolbar permite escribir símbolos comunes sin cambiar de teclado del sistema.
