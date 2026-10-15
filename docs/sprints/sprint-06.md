# Sprint 6 — Personalización + núcleo de plugins

**Duración:** 2 semanas
**Objetivo:** sistema de plugins funcionando a nivel núcleo + personalización básica.

## Tareas

- [ ] Temas: claro, oscuro, y tema custom (colores de editor + UI) redefiniendo la capa semántica de `src/ui/tokens.css`
- [ ] Settings del editor: font size, tab size, word wrap, líneas visibles
- [ ] Plugin loader: leer `plugin.json`, validar manifest, `apiVersion` check
- [ ] Motor QuickJS como WASM (`quickjs-emscripten`) en un Web Worker por plugin, ejecutando `main.js`
- [ ] Exponer al sandbox: `api.commands.register`, `api.editor.getText/setText`, eventos `onSave/onChange/onOpen`
- [ ] Sistema de permisos: declarados en manifest, aprobados por el usuario al instalar, enforceados en runtime
- [ ] Timeout en todos los callbacks de plugin (interrupt handler de QuickJS + `worker.terminate()` como último recurso)

## Criterios de aceptación

1. Un plugin de ejemplo "hola mundo" registra un comando que aparece en la paleta y ejecuta.
2. Un plugin sin permiso `editor.write` que intente escribir es bloqueado y loggeado.
3. Un plugin con un `while(true)` es detenido por timeout y la app sigue viva.
