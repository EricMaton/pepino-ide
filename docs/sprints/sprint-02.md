# Sprint 2 — Editor v1

**Duración:** 2 semanas
**Objetivo:** editor usable para editar código en el móvil.

## Tareas

- [ ] Editor con syntax highlighting (tree-sitter o equivalente; decidir y documentar)
- [ ] Edición táctil: posicionar cursor preciso, selección, gestos de zoom de texto
- [ ] Toolbar superior configurable: símbolos `{}[]()=;`, tab, undo/redo
- [ ] Autosave con snapshot antes de cada edición (el SO mata apps: nunca perder trabajo)
- [ ] Estado del editor restaurado al reabrir (scroll, cursor, archivo abierto)
- [ ] Soportar archivos de al menos 5k líneas sin tirones visibles

## Criterios de aceptación

1. Se puede editar un archivo .kt / .js / .py con highlighting correcto.
2. Cerrar la app a mitad de edición y reabrir restaura todo sin pérdida.
3. La toolbar permite escribir símbolos comunes sin cambiar de teclado del sistema.
