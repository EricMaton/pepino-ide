# Sprint 8 — Spike agente IA

**Duración:** 2 semanas
**Objetivo:** asistencia IA asistida (no autónoma) integrada como plugin.

## Tareas

- [ ] Integrar API de Claude (streaming) desde el plugin "AI Assistant"; la petición la hace el host vía el permiso `network`
- [ ] Selección de código → "Explícame esto" / "Refactoriza"
- [ ] Ediciones inline como diff con aceptar/rechazar por bloque
- [ ] Historial de conversación por proyecto (persistido)
- [ ] Rate limiting y manejo de errores de API (offline, quota)
- [ ] Reflexión: ¿qué necesitaría la API de plugins para agentes más autónomos? → notas para fase 2

## Criterios de aceptación

1. El AI Assistant es un plugin normal instalable con permiso `network` — no código especial en el core.
2. Aceptar/rechazar diffs funciona 100% táctil.
3. Sin conexión, la app degrada con mensaje claro, nunca crashea.
