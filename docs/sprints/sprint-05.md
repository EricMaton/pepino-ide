# Sprint 5 — Terminal v1 (Android only)

**Duración:** 2 semanas
**Objetivo:** terminal embebida funcional en Android.

## Tareas

- [ ] PTY embebido en la app (proceso shell hijo real)
- [ ] Shell disponible en Android (sh/toybox) + PATH de la app
- [ ] Terminal UI: scrollback, colores, resize al abrir/cerrar teclado
- [ ] Teclado terminal: fila de teclas especiales (Ctrl, Esc, Tab, flechas, |, ~)
- [ ] Integración con git del sistema dentro de la terminal
- [ ] Evaluar incluir node/npm embebido (nodejs-mobile) — spike
- [ ] Documentar explícitamente que iOS no tendrá terminal (restricción de plataforma)

## Criterios de aceptación

1. `git status`, `ls`, comandos básicos funcionan en la terminal embebida.
2. La tecla Ctrl llega correctamente al proceso (verificable con `cat` + Ctrl+C).
3. La terminal sobrevive a rotaciones y al background (con límite razonable).
