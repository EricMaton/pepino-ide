# ADR-008: Terminal en Android: PTY propio, git con app_process, sin node, sin iOS

- **Estado:** Aceptada
- **Fecha:** 2026-10-17

## Contexto

El Sprint 5 (#37-#43) pone una terminal embebida en Pepino. ADR-004 fijó el
enfoque general (plugin Capacitor propio, xterm.js, binarios como `jniLibs`
por la restricción W^X de Android 10+), pero dejó abiertas tres preguntas:

- cómo conseguir `git` en la terminal (#41), cuando Android no lo trae;
- si merece la pena embeber node/npm (#42);
- qué pasa en iOS (#43).

## Decisión

### PTY: C propio con ndk-build (#37)

`src/main/jni/pty.c` (≈150 líneas) abre `/dev/ptmx`, hace `fork` y deja al
hijo en su propia sesión con el PTY como terminal de control, como Termux. Se
compila con **ndk-build** (incluido en el NDK, sin CMake) para `arm64-v8a`,
`armeabi-v7a` y `x86_64`: unos 6-10 KB por ABI. NDK 27.2, el que ya traen
los runners de GitHub. Las alternativas eran la librería de Termux desde
JitPack (un repositorio de terceros en la build) o tuberías sin PTY (sin
colores, sin edición de línea y sin Ctrl+C real).

Dos lecciones del dispositivo:

- **El hijo debe volver a las señales por defecto.** La app ignora SIGHUP y
  SIGPIPE, el hijo lo hereda y `kill` no hacía nada.
- **El shell necesita las variables del runtime de Android**
  (`BOOTCLASSPATH`, `ANDROID_ART_ROOT`…) aunque empiece con un entorno
  limpio. Sin ellas, `app_process` arranca pero no escribe nada.

### git: el JGit de la app, con app_process (#41)

Un `git` nativo necesitaría también curl, OpenSSL y certificados: varios MB
por ABI y una build compleja. En su lugar, `git` en la terminal es una
función del shell que arranca `dev.pepino.ide.cli.GitCli` con
`/system/bin/app_process`, como Android arranca `am` y `pm`.

- **Ventajas.** No añade nada al APK, y comparte repositorios y
  `.gitconfig` con la pestaña GIT. Cubre los comandos de cada día con las
  opciones y la salida de git.
- **Coste.** Cada `git` arranca una pequeña VM: ~1,5 s en el emulador x86;
  en un móvil, bastante menos.
- **Límite.** El token de GitHub vive en el Keystore de la app, que necesita
  su `Context`, así que el `git` de la terminal no tiene login. `push`
  remite a la pestaña GIT, y `fetch`/`pull`/`clone` funcionan con repos
  públicos. Un puente seguro al token (un socket local de la app) queda
  como mejora futura.

### node/npm: no, por ahora (#42)

Datos del spike (releases de `nodejs-mobile`, consultados el 2026-10-17):

| | |
| --- | --- |
| Última versión | v18.20.4, de octubre de 2024: **Node 18, sin soporte desde abril de 2025** |
| Tamaño | `nodejs-mobile-v18.20.4-android.zip`: **57 MB** comprimidos (todas las ABIs). El APK de debug de Pepino pesa hoy ~6,5 MB |
| Modelo | Librería (`libnode.so`) que arranca **una sola vez por proceso**: "the runtime expects to be run as a single instance in the process" |
| Limitaciones | Sin `child_process`/`spawn` y **sin npm en el dispositivo**: los módulos se instalan al compilar la app |

Para tener un comando `node` en la terminal haría falta, además, un lanzador
nativo propio, porque `libnode.so` no es un ejecutable. Con un Node sin
soporte, que multiplicaría el APK por diez y no traería npm, no compensa.

**Se revisará** cuando `nodejs-mobile` publique una versión con Node LTS, o
si los plugins (Sprint 6, QuickJS) piden más que un intérprete JS embebido.
Ejecutar JavaScript dentro de Pepino llegará antes por el motor de plugins
(#47) que por node.

### iOS: sin terminal (#43)

iOS no deja a ninguna app crear procesos: no hay `fork`/`exec`, ni PTY, ni
shell del sistema. Tampoco JIT, así que no sirve un intérprete que dependa
de él. Es una restricción de la plataforma, no del proyecto.

- La pestaña TERMINAL existe en iOS y lo dice: "The terminal runs on
  Android". El resto de Pepino (editor, git con la pestaña GIT, GitHub)
  funciona igual.
- La terminal va detrás de la interfaz `TerminalBackend`
  (`src/features/terminal/terminal.ts`). En iOS y en la web hoy es
  `createUnavailableTerminal()`. Si algún día hay un shell propio en JS
  sobre el espacio de proyectos (`ls`, `cat`, `cd`, `git` con el motor de la
  app…), entrará detrás de la misma interfaz sin tocar la pantalla.

## Consecuencias

- El APK no crece por la terminal más que lo que ocupa `libpepino-pty.so`.
- `git` en la terminal hace lo de cada día. Lo remoto con login sigue en la
  pestaña GIT.
- Nada de node/npm en el dispositivo por ahora. Lo que necesite JS irá por
  plugins.
- iOS tendrá todo menos la terminal, y lo dice en la propia pestaña.
