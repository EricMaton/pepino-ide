# Sprint 4 — GitHub

**Duración:** 2 semanas
**Objetivo:** conectar con GitHub y cerrar el flujo MVP (editar → commit → PR).

## Tareas

- [ ] OAuth con PKCE contra GitHub
- [ ] Token almacenado en Android Keystore / iOS Keychain (nunca en plaintext)
- [ ] Listar repos del usuario (con búsqueda y paginación)
- [ ] Clonar repo de GitHub a la carpeta de proyectos
- [ ] Push / pull con manejo de conflictos (al mínimo: avisar y mostrar estados)
- [ ] Crear PR desde la app (rama, título, descripción, base)
- [ ] Pantalla de estado de sync (ahead/behind, último fetch)
- [ ] Manejo de errores de red y de token expirado (re-auth)

## Criterios de aceptación

1. El usuario hace login con GitHub y ve sus repos en < 5s con buena red.
2. Clonar → editar → commit → push → abrir PR funciona sin tocar un ordenador.
3. El token nunca aparece en logs, crash reports ni disco sin cifrar.
