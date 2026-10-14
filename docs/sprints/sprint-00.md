# Sprint 0 — Cimientos

**Duración:** 2 semanas
**Objetivo:** repo KMP compilando para Android e iOS (stub), arquitectura base, CI verde.

## Tareas

- [x] Configurar KMP + Compose Multiplatform (Android minSdk 26, iOS framework stub)
- [ ] Crear estructura de módulos: `:core:commands`, `:core:events`, `:core:plugins` (esqueleto), `:feature:*`
- [ ] Implementar `CommandRegistry` + dispatcher + paleta de comandos básica (demo interna)
- [ ] Implementar `EventBus` tipado (subscribe/publish con tipos)
- [ ] CI en GitHub Actions: build + tests en cada PR
- [ ] Convenciones: ktlint/detekt, conventional commits, PR template, CODEOWNERS
- [ ] Escribir ADR-001 (stack) y ADR-002 (plugins como JS interpretado)

## Criterios de aceptación

1. `./gradlew build` compila para Android e iOS sin errores.
2. CI verde en `main`.
3. La app demo abre y muestra la paleta de comandos con 2 comandos de prueba funcionando.
4. Ningún código de features vive fuera de su módulo.
