# ADR-006: Motor git nativo (JGit en Android)

- **Estado:** Aceptada
- **Fecha:** 2026-10-15

## Contexto

El Sprint 3 necesita git local (init, status, stage, commit, branches, diff,
log) y el Sprint 4 clonar y sincronizar con GitHub. ADR-004 dejó abiertas dos
opciones: **isomorphic-git** (JS) sobre `@capacitor/filesystem`, o un **plugin
Capacitor nativo**. El spike #21 las midió en el emulador (Android 15, WebView
124, build de depuración) con las mismas operaciones y clones superficiales
(`depth: 1`, una rama) de repos reales.

El código del spike está en la rama
[`spike/21-git-engine`](https://github.com/EricMaton/pepino-ide/tree/spike/21-git-engine):

- isomorphic-git 1.44 con un `fs` sobre Capacitor ya optimizado. Lee con
  `fetch` del servidor del WebView (#20), saca los `stat` de los `readdir` y
  hace HTTP nativo con `CapacitorHttp`.
- Un plugin con JGit 6.10.

### Medidas

| Operación                             | isomorphic-git |   JGit |
| ------------------------------------- | -------------: | -----: |
| Clone express (214 archivos)          |         19,4 s |  5,4 s |
| Clone vite (2.868 archivos, 12 MB)    |        194,5 s | 42,7 s |
| Clone svelte (9.258 archivos)         |              — |   44 s |
| `status` vite (sin cambios)           |        16-20 s | 2,6-4,5 s |
| `add` + `commit` de 1 archivo, vite   |         40,6 s | 0,2-0,6 s |
| `status` svelte                       |              — | 8,5-11 s |
| Pico de memoria en el clone de vite   | 57 MB heap JS, PSS 184 MB | 26 MB heap Java, PSS 123 MB |

- **El coste de isomorphic-git es el puente**, no git. Cada `stat`, `mkdir`
  y `writeFile` es una llamada a Capacitor de ~10-50 ms. Clonar vite hizo
  16.551 `stat` y 2.881 escrituras (138 s solo de checkout), y los binarios
  cruzan en base64. `commit` reescribe como objetos sueltos todos los árboles
  del repo (1.134 escrituras en vite). No hay forma de agrupar llamadas sin
  escribir código nativo, y entonces la ventaja de isomorphic-git desaparece.
- En JGit la red es casi todo el clone de vite (~20 de 43 s). `status` crece
  con el número de archivos (~1 ms por archivo en build de depuración, que
  desactiva optimizaciones de ART). Las operaciones locales de un archivo
  bajan del medio segundo.
- isomorphic-git, además, no crea symlinks sobre Capacitor: el spike los
  escribe como archivos, igual que git con `core.symlinks=false`.

## Decisión

- **Plugin Capacitor nativo `Git`**, con **JGit** en Android, en
  `android/app/src/main/java/dev/pepino/ide/git/`. Las operaciones corren en
  un hilo propio, nunca en el del puente, y devuelven resultados ya resumidos
  (status por archivo, entradas de log, hunks de diff), no contenidos crudos.
- En TypeScript, una interfaz `GitEngine` en `src/features/git` que la UI usa
  sin saber qué hay debajo. Android usa el plugin. Para los tests de la UI y
  para `npm run dev` hay un motor falso en memoria.
- **Tests de las operaciones core (#28) en JUnit** contra JGit en la JVM
  (`android/app/src/test`), en el job `android` de CI. Son los de verdad: el
  mismo código que corre en el móvil.
- **iOS** (#69): libgit2 (p. ej. SwiftGit2) detrás de la misma interfaz
  `GitEngine` cuando llegue el sprint de iOS.
- HTTP y credenciales (Sprint 4) también por JGit (`CredentialsProvider` con
  el token de #30). No hace falta proxy CORS.

### Alternativas consideradas

- **isomorphic-git**: un solo código para Android, iOS y web, pero 4-100 veces
  más lento por el puente de Capacitor (ver tabla), y sin symlinks.
- **libgit2 por JNI en Android**: más rápido que JGit en `status` y el mismo
  motor en las dos plataformas. A cambio, NDK, compilar libgit2 + OpenSSL o
  mbedTLS para cuatro ABIs y código C/JNI que mantener. Se reconsidera si
  `status` con JGit no basta en repos grandes (#64).

## Consecuencias

- **JGit 6.x requiere Java 11.** Se compila bien y funciona en Android 15,
  pero minSdk es 26. En #22 hay que activar `coreLibraryDesugaring` y probar
  en un emulador con API 26. Si falla, las salidas son JGit 5.13 (Java 8, sin
  clone superficial) o subir minSdk.
- El APK de depuración pasa de 5,1 a 9,9 MB. En release, R8 recortará la
  parte de JGit que no se use; hay que añadir reglas `-keep` para lo que se
  carga por reflexión.
- `status` en repos de ~10.000 archivos tarda segundos: la UI lo lanza en
  segundo plano y muestra el último resultado. Las mejoras (índice de
  timestamps, FS monitor) quedan para #64.
- Escribir en el repo y en el editor pasa por el mismo disco
  (`filesDir/projects`). El editor guarda por Capacitor y git lee del disco,
  así que no hay estado duplicado. El snapshot pre-cambio (#27) puede ser un
  `stash` o un commit en una ref propia.
- Commits atómicos: JGit escribe con archivos `.lock` y renombrados. Si la app
  muere a mitad de un commit, no se corrompe el repo (criterio 3 del sprint);
  se comprobará en #28.
