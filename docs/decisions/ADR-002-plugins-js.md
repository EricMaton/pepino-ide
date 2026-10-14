# ADR-002: Plugins como scripts JS interpretados

- **Estado:** Aceptada
- **Fecha:** 2026-10-14

## Contexto

Pepino quiere ser extensible por usuarios (plugins) y por futuros agentes IA,
que consumirán la misma API. Las restricciones duras son:

- **App Store**: prohibido descargar y ejecutar código nativo; el código
  interpretado (JS, Lua…) sí está permitido.
- **Seguridad**: un plugin no debe poder colgar la app ni acceder a red o
  disco sin permiso explícito.
- **Portabilidad**: el mismo plugin debe funcionar en Android e iOS.

## Decisión

- Los plugins son **scripts JavaScript interpretados por QuickJS embebido**,
  acompañados de un manifest declarativo (`plugin.json`). Nunca binarios
  nativos ni bytecode descargable.
- La API expuesta está **versionada** (`apiVersion`), es pequeña y declarativa
  (ver `docs/plugin-api/v1-spec.md`).
- **Permisos explícitos** aprobados por el usuario al instalar
  (`editor.*`, `git.*`, `fs.*`, `network`).
- **Timeout de ejecución** en todo callback de plugin.
- El único punto de entrada de los plugins son el `CommandRegistry` y el
  `EventBus` (`:core:commands`, `:core:events`): la UI nunca llama a un
  plugin directamente.
- Los agentes IA serán un plugin más (con permiso `network`), no un caso
  especial en la arquitectura.

### Alternativas consideradas

- **Plugins nativos (Kotlin/Swift)**: imposible en iOS (restricción de Apple).
- **Lua (u otro lenguaje embebido)**: igual de legal, pero JS tiene un
  ecosistema y familiaridad muy superiores; QuickJS es pequeño y portable.
- **WASM**: viable, pero la interoperación con una API de host rica es más
  laboriosa y el tooling es menos maduro para este caso de uso.

## Consecuencias

- El sistema de plugins es **legal en App Store** al ser código interpretado.
- El rendimiento es el de un intérprete: aceptable para la API v1 (editor,
  git, settings), no para cómputo pesado.
- QuickJS es una dependencia nativa a embeber vía KMP (cinterop / expect-actual),
  coste que se asume en el Sprint 6.
- La superficie de ataque queda acotada por el sandbox de permisos y los
  timeouts; un plugin malicioso o colgado no compromete la app.
- Romper la API nunca mata plugins antiguos: `apiVersion` lo garantiza.
