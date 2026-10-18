# Plugin API — Especificación v1

Los plugins de Pepino son **un script JS interpretado** (QuickJS) más **un manifest declarativo**. Nunca binarios nativos: es lo que los hace portables (Android/iOS) y válidos en App Store.

Esta spec basta para escribir un plugin sin preguntar nada. Los ejemplos reales están en [EricMaton/pepino-plugins](https://github.com/EricMaton/pepino-plugins): Formatter (comandos y ajustes), Pickle themes (solo temas) y Snippets (listas, campos de texto y almacenamiento).

## Tu primer plugin

```
hola/
├── plugin.json
└── main.js
```

`plugin.json`:

```json
{
  "id": "com.ejemplo.hola",
  "name": "Hola",
  "version": "1.0.0",
  "apiVersion": "1",
  "description": "Saluda y cuenta las líneas del archivo abierto.",
  "permissions": ["editor.read"],
  "contributes": {
    "commands": [{ "id": "saludar", "title": "Say hello" }],
    "settings": [{ "key": "nombre", "type": "string", "default": "mundo", "title": "Who to greet" }]
  }
}
```

`main.js`:

```js
plugin.onActivate((api) => {
  api.commands.register('saludar', async () => {
    const text = await api.editor.getText();
    const lines = text === '' ? 0 : text.split('\n').length;
    await api.window.showMessage(`Hola, ${api.settings.get('nombre')}: ${lines} líneas`);
  });
});
```

El comando sale en la búsqueda de arriba como **Hola: Say hello** y el aviso como "Hola: Hola, mundo: 12 líneas".

## Manifest (`plugin.json`)

| Campo | Obligatorio | Qué es |
|---|---|---|
| `id` | sí | Nombre en dominio inverso, en minúsculas: `com.ejemplo.hola` (`[a-z0-9]`, `-` y `_` dentro de cada parte, al menos un punto). Único |
| `name` | sí | Lo que ve el usuario |
| `version` | sí | `x.y.z` (semver; admite `-beta.1`). El repositorio ofrece **Update** cuando sube |
| `apiVersion` | sí | `"1"`. Una versión que la app no ejecuta hace que el plugin se rechace entero, nunca a medias |
| `description` | no | Una frase; sale en PLUGINS |
| `permissions` | no | Lista de [permisos](#permisos); los repetidos se ignoran |
| `networkJustification` | con `network` | Por qué necesita internet; se enseña al aprobar |
| `contributes.commands` | no | `[{ id, title }]`. `id`: letras, números, `-`, `_`. Cada uno tiene que registrarse en `main.js` |
| `contributes.settings` | no | `[{ key, type, default, title? }]`, `type`: `"number"`, `"string"` o `"boolean"`, y `default` de ese tipo. El usuario los cambia en PLUGINS → Manage |
| `contributes.themes` | no | Ver [Temas](#temas) |
| `contributes.toolbar` | no | `[{ command, icon?, label? }]`, que nombra uno de sus comandos. Se valida, pero la app **todavía no lo muestra** en la barra del editor |

Un manifest con errores no se carga: PLUGINS lista todos sus problemas, no solo el primero.

`main.js` es **un único archivo**, sin `import` ni `require`. Si necesitas una librería, va dentro (Formatter lleva js-beautify al final de su `main.js`). Un plugin sin comandos, como uno que solo trae temas, puede no tener `main.js`; entonces no se le arranca ningún sandbox.

## API (`main.js`)

`main.js` se ejecuta una vez al arrancar el plugin. Registra lo que hará en `plugin.onActivate`:

```js
plugin.onActivate(async (api) => {
  // registrar comandos y escuchar eventos
});
plugin.onDeactivate(() => {
  // opcional: se llama al apagarlo, desinstalarlo o actualizarlo
});
```

Todo lo de `api` que habla con la app devuelve una **promesa**; `api.settings.get` es síncrono.

| Llamada | Permiso | Qué hace |
|---|---|---|
| `api.commands.register(id, fn)` | — | `fn` (puede ser `async`) se ejecuta al elegir el comando. `id` tiene que estar en `contributes.commands`; en la app es `<id del plugin>.<id>` |
| `api.commands.execute(id)` | — | Un comando suyo por su id corto, o cualquier otro de la app por su id completo |
| `api.editor.getPath()` | `editor.read` | La ruta del archivo abierto (`proyecto/src/a.js`), por ejemplo para saber su lenguaje |
| `api.editor.getText()` | `editor.read` | Su texto completo |
| `api.editor.getSelection()` | `editor.read` | El texto seleccionado, o `''` |
| `api.editor.setText(text)` | `editor.write` | Sustituye el texto entero, como una sola edición que se puede deshacer |
| `api.editor.insert(text)` | `editor.write` | Lo pone en lugar de la selección, con el cursor detrás |
| `api.editor.insertSnippet(body)` | `editor.write` | Igual, como snippet: cada `\t` es una sangría del editor (espacios o tabulador, según el usuario); las líneas siguientes empiezan a la sangría de la línea donde entra; el cursor acaba en `$0` |
| `api.editor.onSave(fn)` / `onOpen(fn)` / `onChange(fn)` | — | `fn({ path })` al guardar, abrir o editar un archivo. `onChange` llega una vez por pausa al escribir (300 ms) |
| `api.settings.get(key)` | — | El valor que el usuario le dio, o el `default`. Si el usuario lo cambia, el plugin se reinicia para leerlo |
| `api.window.showMessage(text)` | — | Un aviso (snackbar) con el nombre del plugin delante |
| `api.window.showQuickPick(items, { title })` | — | Una lista para elegir. `items`: textos o `{ label, detail }`, hasta 1000; con más de 6 se puede filtrar. Resuelve al **índice** elegido, o `null` si se cierra |
| `api.window.showInput({ title, placeholder, value })` | — | Pide una línea de texto; resuelve al texto, o `null` si se cancela |
| `api.storage.get(key)` / `set(key, value)` / `delete(key)` | — | Datos del propio plugin (cualquier valor JSON), guardados entre arranques; hasta 256 KB por plugin. `get` de una clave que no hay da `null`; `set(key, null)` la borra. Se borran al desinstalar |
| `api.network.fetch(url, { method, headers, body })` | `network` | Solo existe si el usuario lo permitió. Resuelve a `{ status, headers, text }` |
| `console.log` / `warn` / `error` | — | Al log del plugin, en PLUGINS → Manage |

Una llamada sin su permiso se rechaza: la promesa falla con `Not allowed: <permiso>` y queda en el log. Un error dentro de un comando también va al log, y el usuario ve el aviso "Error: …".

### Temas

Un plugin puede traer temas en `contributes.themes`, sin código: solo colores sobre una base (`dark` o `light`). Salen en SETTINGS → Appearance mientras el plugin está encendido.

```json
"contributes": {
  "themes": [
    {
      "id": "night",
      "label": "Pickle night",
      "base": "dark",
      "colors": { "bg": "#0d1410", "fg": "#e6f2e8", "primary": "#3fbf5f", "onPrimary": "#0a0a0a" }
    }
  ]
}
```

| Color | Qué pinta |
|---|---|
| `bg`, `fg` | Fondo y texto |
| `surface`, `surfaceVariant` | Superficies y paneles (tarjetas, barras) |
| `primary`, `onPrimary` | El acento y el texto sobre él (si falta `onPrimary`, se elige blanco o negro según el acento) |
| `error`, `outline` | Errores, y bordes y texto apagado |
| `gitAdded`, `gitModified`, `gitRemoved`, `onGit` | Los colores de git y el texto sobre ellos |

- Solo esos nombres y solo `#rrggbb`: un tema no puede meter CSS propio. Un color que falta queda como el de su base.
- El tema elegido se guarda con una copia de sus colores, para pintarse bien desde el arranque. Si se apaga o desinstala el plugin, la app vuelve a la base del tema; si vuelve el plugin, vuelve el tema.

## Entorno y límites

- **JavaScript moderno** (QuickJS, ES2023: `async`/`await`, clases, `Map`, expresiones regulares, `JSON`…).
- **No hay** DOM, `window`, `fetch`, `setTimeout`/`setInterval`, `import`/`require` ni acceso a archivos: solo `plugin`, `console` y la `api`.
- **2 s de ejecución seguida** por callback (comando, evento, `onActivate`). Esperar una promesa de la `api` no cuenta: un comando puede esperar al usuario en `showQuickPick` el tiempo que haga falta. Si se pasa, el callback se corta y falla con un error.
- **32 MB de memoria** por plugin.
- Si el plugin deja de responder del todo (10 s sin contestar), la app lo para y lo marca como fallido: **un plugin colgado nunca congela la app**.
- Cada plugin corre aislado de los demás y de la app.

## Permisos

| Permiso | Qué permite |
|---|---|
| `editor.read` | Leer el archivo abierto: su ruta, texto y selección |
| `editor.write` | Insertar o sustituir texto en el archivo abierto (se puede deshacer) |
| `network` | `api.network.fetch`; necesita `networkJustification` |
| `git.read`, `git.write`, `fs.read`, `fs.write` | **Reservados**: se pueden declarar, pero en v1 todavía no hay `api.git` ni `api.fs` |

- Los permisos se aprueban antes de que el plugin se ejecute por primera vez: al instalarlo, o con **Review permissions**.
- Si una versión nueva pide más, se pregunta otra vez, solo por los nuevos.
- El usuario puede retirarlos en Manage (**Take back permissions**); el plugin se para hasta que los vuelva a permitir.

## Ciclo de vida

```
install → (el usuario aprueba los permisos) → main.js → onActivate → … comandos y eventos …
        → onDeactivate (al apagarlo, actualizarlo o desinstalarlo) → uninstall
```

### Instalar, actualizar y desinstalar

En PLUGINS → **Available** salen los plugins del [repositorio](#repositorio-de-plugins):

1. **Install** muestra los permisos que pide (los del `index.json`) antes de descargar nada.
2. Al aceptar, se descargan sus archivos y se comprueba el SHA-256 de cada uno. El manifest descargado tiene que ser el mismo plugin y no pedir más permisos que los mostrados; si no, no se instala nada.
3. Se guarda en los datos de la app (`plugins/<id>/`), con esos permisos aprobados, y arranca. Al abrir la app otra vez sigue ahí.
4. Si el repositorio tiene una versión más nueva, sale **Update to vX**, y la nueva sustituye a la vieja sin reiniciar.
5. **Uninstall** lo para (sus comandos, temas y listeners se van al momento) y borra sus archivos, lo que se le permitió, sus ajustes y lo que guardó en `api.storage`.

Los que vienen con Pepino (Hello world, Word count) no se desinstalan: se apagan.

### Gestionar un plugin

En PLUGINS cada plugin tiene un interruptor ON/OFF y **Manage**:
- sus permisos, cuáles están permitidos, y **Take back permissions**;
- sus ajustes (`contributes.settings`: texto, número o sí/no);
- lo que aporta (comandos y temas);
- su log.

## Repositorio de plugins

Los plugins que se pueden instalar viven en [EricMaton/pepino-plugins](https://github.com/EricMaton/pepino-plugins), sin backend propio: la app lee su `index.json` y descarga los archivos de cada plugin desde GitHub (`raw.githubusercontent.com`).

```json
{
  "schema": 1,
  "plugins": [
    {
      "id": "dev.pepino.formatter",
      "name": "Formatter",
      "version": "1.0.0",
      "apiVersion": "1",
      "description": "Formats the open JavaScript, CSS or HTML file (js-beautify).",
      "permissions": ["editor.read", "editor.write"],
      "path": "plugins/formatter",
      "files": { "plugin.json": "<sha256>", "main.js": "<sha256>" }
    }
  ]
}
```

- `index.json` se genera con `node scripts/build-index.mjs` a partir de `plugins/<carpeta>/`, y no se edita a mano.
- `files` lleva el SHA-256 de cada archivo: la app lo comprueba tras descargarlo y descarta el plugin si no coincide.
- **Para publicar uno:**
  1. Crea su carpeta con `plugin.json` (y `main.js`).
  2. Escribe sus tests: `node --test "tests/*.test.mjs"`; `tests/harness.mjs` ejecuta un `main.js` como lo hace Pepino, con una `api` que contesta el test.
  3. Regenera el índice.
  4. Abre un PR en ese repo. Su CI comprueba los manifiestos, que el índice esté al día y los tests.
- Formatter, Pickle themes y Snippets se instalan desde ahí: no vienen dentro de la app.

## Reglas de diseño inamovibles

1. **`apiVersion` versionada**: romper la API nunca mata plugins viejos.
2. **Sandbox de red**: sin `network` explícito, cero HTTP.
3. **Timeout de ejecución** en todo callback de plugin.
4. **Comandos y eventos son el único punto de entrada**: la UI nunca llama a plugins directamente.

## Implementación del host (ADR-004)

La spec no cambia con el paso a TypeScript + Capacitor; solo cambia quién la implementa:

- **Aislamiento:** cada plugin corre en **QuickJS compilado a WASM** (`quickjs-emscripten`) dentro de un **Web Worker** propio, sin DOM, sin `fetch` y fuera del hilo de UI.
- **RPC:** `api.*` es un RPC por mensajes con el host (datos planos en JSON), y por eso devuelve promesas. `api.settings.get` es síncrono porque los ajustes se copian al sandbox al activarlo.
- **Permisos:** se comprueban en el host, en el lado que recibe cada llamada. `api.network` solo existe en los plugins a los que se les permitió.
- **Timeout:** combina el interrupt handler de QuickJS (deadline por callback) y, si no basta, un watchdog que hace `worker.terminate()` y desactiva el plugin.
- **Comandos y eventos:** los comandos se registran en el `CommandRegistry` y los eventos llegan desde el `EventBus` (topics string con payloads de datos planos).
