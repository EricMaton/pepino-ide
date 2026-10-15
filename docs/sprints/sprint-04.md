# Sprint 4 — GitHub

**Duración:** 2 semanas
**Objetivo:** conectar con GitHub y cerrar el flujo MVP (editar → commit → PR).

## Tareas

- [ ] Login con GitHub: Device Flow o authorization code + PKCE con deep link (llamadas OAuth vía `CapacitorHttp`, sin CORS)
- [ ] Token almacenado en Android Keystore / iOS Keychain mediante un plugin de Capacitor (nunca en plaintext, nunca en Preferences/IndexedDB)
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
