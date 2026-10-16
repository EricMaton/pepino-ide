# ADR-007: Login con GitHub (Device Flow) y token en el Keystore

- **Estado:** Aceptada
- **Fecha:** 2026-10-16

## Contexto

El Sprint 4 necesita un token de GitHub para listar repos, clonar, hacer
push/pull y abrir PRs (#29-#36). ADR-004 dejó dos opciones para conseguirlo:

- **Device Flow**: la app enseña un código y el usuario lo aprueba en
  `github.com/login/device`.
- **Authorization code + PKCE**: se abre el navegador y la app vuelve por
  deep link.

Además, el token no puede aparecer nunca en logs, crash reports ni en disco
sin cifrar (criterio 3 del sprint, #30).

## Decisión

**Device Flow, con una OAuth App de GitHub, y todo en nativo.**

- El intercambio de código por token del flujo con PKCE exige el
  `client_secret` aunque se use PKCE (la documentación de GitHub lo marca
  como obligatorio). Pepino no tiene backend, así que ese secreto tendría que
  ir dentro del APK, de donde cualquiera puede sacarlo. El Device Flow no
  usa secreto: solo el `client_id`, que es público. Es lo que usan `gh` y
  GitHub Mobile. Tampoco hacen falta App Links ni deep links.
- Es una **OAuth App** y no una GitHub App. Sus tokens no caducan y el scope
  `repo` cubre clonar, push y PRs en todos los repos del usuario. Los tokens
  de usuario de una GitHub App caducan a las 8 h, y renovarlos también pide
  el secreto.
- Scopes: `repo` (repos privados incluidos), `workflow` (sin él, GitHub
  rechaza los push que tocan `.github/workflows`) y `read:user`.
- **El token no cruza el puente de Capacitor.** El plugin nativo `GitHub`
  hace el login (`GitHubAuth`, Java puro con tests JUnit contra un GitHub
  falso), guarda el token y hará las llamadas a la API. El WebView solo ve
  el código que hay que teclear y quién ha iniciado sesión. Así el token no
  puede acabar en los logs de la consola del WebView, que en las builds de
  depuración salen por logcat. Además, JGit lo usará directamente para
  clone, push y pull (ADR-006).
- **Almacenamiento (#30): `TokenStore`.** El token se cifra con AES-GCM con
  una clave generada en el **Android Keystore**, que no se puede exportar.
  En disco solo queda el texto cifrado, en unas preferencias propias
  (`pepino.secrets`). Si la clave desaparece (por ejemplo al restaurar un
  backup en otro móvil), lo que no se puede descifrar se borra y el usuario
  vuelve a iniciar sesión. Descartados:
  - `EncryptedSharedPreferences`, que está obsoleta;
  - `@capacitor/preferences`, `localStorage` e IndexedDB, que guardan en
    claro.
- **En la web** (`npm run dev`) no hay login real, porque los endpoints de
  OAuth de GitHub no admiten CORS. Un sustituto simula la aprobación para
  poder trabajar en la interfaz.

## Consecuencias

- **El usuario teclea o pega un código** de 8 caracteres en GitHub. Pepino lo
  copia al portapapeles al abrir la página y espera solo: sigue preguntando
  a GitHub aunque el navegador esté delante.
- **La OAuth App "Pepino IDE"** está registrada en la cuenta EricMaton con
  "Enable Device Flow" activado y "Expire user access tokens" desactivado:
  renovar un token caducado también pide el `client_secret`. Su `client_id`
  está en `src/features/github/github.ts` (`GITHUB_CLIENT_ID`).
- **Cerrar sesión borra el token del móvil,** pero no revoca la autorización
  en GitHub: eso necesitaría el `client_secret`. La pantalla explica cómo
  revocarla desde GitHub → Settings → Applications.
- **iOS (#69):** el mismo plugin, con el token en el Keychain.
- **El mismo `TokenStore`** guardará la API key del asistente IA (#58).
