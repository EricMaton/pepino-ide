# Sprint 2 — Editor v1

**Duración:** 2 semanas
**Objetivo:** editor usable para editar código en el móvil.

## Tareas

- [ ] Editor con syntax highlighting: CodeMirror 6 (Lezer) frente a alternativas; decidir y documentar en ADR-005
- [ ] Edición táctil: posicionar cursor preciso, selección, gestos de zoom de texto (validar el IME de Gboard/SwiftKey en el WebView)
- [ ] Toolbar configurable encima del teclado: símbolos `{}[]()=;`, tab, undo/redo (botones = comandos del `CommandRegistry`)
- [ ] Autosave con snapshot antes de cada edición (el SO mata apps: nunca perder trabajo; guardar también en el evento `pause` de la app)
- [ ] Estado del editor restaurado al reabrir (scroll, cursor, archivo abierto)
- [ ] Soportar archivos de al menos 5k líneas sin tirones visibles

## Criterios de aceptación

1. Se puede editar un archivo .kt / .js / .py con highlighting correcto.
2. Cerrar la app a mitad de edición y reabrir restaura todo sin pérdida.
3. La toolbar permite escribir símbolos comunes sin cambiar de teclado del sistema.
