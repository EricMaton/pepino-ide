# Sprint 5 — Terminal v1 (Android only)

**Duración:** 2 semanas
**Objetivo:** terminal embebida funcional en Android.

## Tareas

- [x] PTY embebido: plugin Capacitor propio en Kotlin + NDK (`forkpty`), con binarios empaquetados como `jniLibs` por la restricción W^X de Android 10+
- [x] Shell disponible en Android (sh/toybox) + PATH de la app
- [x] Terminal UI con xterm.js: scrollback, colores, resize al abrir/cerrar teclado
- [x] Teclado terminal: fila de teclas especiales (Ctrl, Esc, Tab, flechas, |, ~)
- [x] Integración con git dentro de la terminal: el JGit de la app vía app_process (ADR-008)
- [x] Evaluar incluir node/npm embebido (nodejs-mobile) — spike: no por ahora (ADR-008)
- [x] Documentar explícitamente que iOS no tendrá terminal (restricción de plataforma)

## Criterios de aceptación

1. `git status`, `ls`, comandos básicos funcionan en la terminal embebida.
2. La tecla Ctrl llega correctamente al proceso (verificable con `cat` + Ctrl+C).
3. La terminal sobrevive a rotaciones y al background (con límite razonable).
