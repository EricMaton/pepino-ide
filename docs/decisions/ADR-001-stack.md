# ADR-001: Stack tecnológico

- **Estado:** Reemplazada por [ADR-004](ADR-004-typescript.md)
- **Fecha:** 2026-10-14

## Contexto

Queremos un IDE móvil completo: editor, git, terminal, plugins, agentes IA futuros.

## Decisión

- **Kotlin Multiplatform + Compose Multiplatform**, targets Android (minSdk 26) e iOS.
- **Android-first**: iOS compila desde el inicio como stub, pero las features
  nativas restringidas (terminal, filesystem libre) solo existen en Android.
- **Plugins como scripts JS** ejecutados en QuickJS embebido, con manifest
  declarativo y permisos.
- **Git vía libgit2** (bindings KMP), no reimplementación.

## Consecuencias

- ~70% del código compartido entre plataformas.
- La terminal no llegará nunca a iOS (restricción de Apple, no nuestra).
- El sistema de plugins es legal en App Store (código interpretado).
- Coste inicial mayor en Sprint 0 (KMP multi-target) a cambio de no portar después.
