# Plugin API — Especificación v1

Los plugins son **scripts JS interpretados** (QuickJS) + un manifest declarativo.
Nunca binarios nativos: es lo que los hace portables (Android/iOS) y legales en App Store.

## Estructura de un plugin

```
my-plugin/
├── plugin.json   ← manifest
└── main.js       ← script (opcional si el plugin no tiene comandos: p. ej. solo temas)
```

## Manifest (`plugin.json`)

```json
{
  "id": "com.pal.beautifier",
  "name": "Beautifier",
  "version": "1.0.0",
  "apiVersion": "1",
  "permissions": ["editor.read", "editor.write"],
  "contributes": {
    "commands": [{ "id": "beautify", "title": "Formatear archivo" }],
    "toolbar":  [{ "command": "beautify", "icon": "wand" }],
    "settings": [{ "key": "indentSize", "type": "number", "default": 2 }]
  }
}
```

## API expuesta al script (`main.js`)

```js
plugin.onActivate(api => {
  api.commands.register('beautify', async () => {
    const code = await api.editor.getText();
    const formatted = doBeautify(code, api.settings.get('indentSize'));
    await api.editor.setText(formatted);
  });

  api.editor.onSave(async (file) => {
    if (file.path.endsWith('.js')) await api.commands.execute('beautify');
  });

  const status = await api.git.status(); // read-only por defecto
});
```

### Implementado (Sprint 6, #48)

| Llamada | Permiso | Qué hace |
|---|---|---|
| `plugin.onActivate(api => …)` / `plugin.onDeactivate(() => …)` | — | Al activar / desactivar el plugin |
| `api.commands.register(id, fn)` | — | El comando sale en la paleta como `Plugin: Título` (id de la app: `<plugin id>.<id>`); tiene que estar en `contributes.commands` |
| `api.commands.execute(id)` | — | Un comando suyo por su id corto, o cualquier otro por el id de la app |
| `api.editor.getPath()` | `editor.read` | La ruta del archivo abierto (`proyecto/src/a.js`), p. ej. para saber su lenguaje (#51) |
| `api.editor.getText()` | `editor.read` | El texto del archivo abierto en el editor |
| `api.editor.setText(text)` | `editor.write` | Lo sustituye entero (una sola edición, deshacible) |
| `api.editor.getSelection()` | `editor.read` | El texto seleccionado, o `''` (#53) |
| `api.editor.insert(text)` | `editor.write` | Lo pone en lugar de la selección, con el cursor detrás |
| `api.editor.insertSnippet(body)` | `editor.write` | Igual, como snippet: cada `	` es una sangría del editor (espacios o tabulador, según el usuario), las líneas siguientes empiezan a la sangría de la línea donde entra, y el cursor acaba en `$0` |
| `api.editor.onSave(fn)` / `onOpen(fn)` / `onChange(fn)` | — | Reciben `{ path }`; `onChange`, una vez por pausa al escribir (300 ms) |
| `api.settings.get(key)` | — | Síncrono: el valor que el usuario le dio en PLUGINS → Manage, o el de `contributes.settings` por defecto. Si el usuario lo cambia, el plugin se reinicia para leerlo (#57) |
| `api.window.showMessage(text)` | — | Un aviso (snackbar) con el nombre del plugin delante |
| `api.window.showQuickPick(items, { title })` | — | Una lista para elegir (`items`: textos o `{ label, detail }`, hasta 1000); con más de 6 se puede filtrar. Resuelve al **índice** elegido, o `null` si se cierra (#53) |
| `api.window.showInput({ title, placeholder, value })` | — | Pide una línea de texto; resuelve al texto, o `null` si se cancela |
| `api.storage.get(key)` / `set(key, value)` / `delete(key)` | — | Datos del propio plugin (JSON), guardados entre arranques; hasta 256 KB por plugin. `get` de una clave que no hay da `null` |
| `console.log/warn/error` | — | Al log del plugin (PLUGINS → Manage) |

Una llamada sin el permiso se rechaza en el host (la promesa falla con `Not allowed: <permiso>`) y queda en el log del plugin. `git.*`, `fs.*` y la red llegan con los plugins de ejemplo (#51–#53) y la gestión de plugins (Sprint 7).

### Temas (#52)

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
| `error`, `outline` | Errores y bordes/texto apagado |
| `gitAdded`, `gitModified`, `gitRemoved`, `onGit` | Los colores de git y el texto sobre ellos |

- Solo esos nombres y solo `#rrggbb`: un tema no puede meter CSS propio. Un color que falta queda como el de su base.
- El tema elegido se guarda con una copia de sus colores, para pintarse bien desde el arranque. Si se apaga o desinstala el plugin, la app vuelve a la base del tema; si vuelve el plugin, vuelve el tema.

## Permisos (v1)

| Permiso | Acceso |
|---|---|
| `editor.read` | Leer contenido del editor |
| `editor.write` | Modificar contenido del editor |
| `git.read` | Status, log, diff |
| `git.write` | Commit, push (requiere confirmación del usuario) |
| `network` | Llamadas HTTP (requiere justificación en el manifest) |
| `fs.read` | Leer archivos del proyecto |
| `fs.write` | Escribir archivos del proyecto |

Los permisos se aprueban al instalar el plugin. Scripts con timeout;
un plugin colgado nunca congela la app.

## Reglas de diseño inamovibles

1. **`apiVersion` versionada** — romper la API nunca mata plugins viejos.
2. **Sandbox de red** — sin `network` explícito, cero HTTP.
3. **Timeout de ejecución** en todo callback de plugin.
4. **Comandos y eventos son el único punto de entrada** — la UI nunca llama a plugins directamente.

## Repositorio de plugins (#55)

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

- `index.json` se genera con `node scripts/build-index.mjs` a partir de `plugins/<carpeta>/`; su CI comprueba los manifiestos y que el índice esté al día.
- `files` lleva el SHA-256 de cada archivo: la app lo comprueba tras descargarlo, y descarta el plugin si no coincide.
- Para publicar uno: su carpeta con `plugin.json` (y `main.js`), regenerar el índice y abrir un PR en ese repo.

## Ciclo de vida

### Instalar, actualizar y desinstalar (#56)

En PLUGINS → **Available** salen los plugins del repositorio ([EricMaton/pepino-plugins](https://github.com/EricMaton/pepino-plugins)):

1. **Install** muestra los permisos que pide (los del `index.json`) antes de descargar nada.
2. Al aceptar, se descargan sus archivos y se comprueba el SHA-256 de cada uno. El manifest descargado tiene que ser el mismo plugin y no pedir más permisos que los mostrados; si no, no se instala nada.
3. Se guarda en los datos de la app (`plugins/<id>/`), con esos permisos aprobados, y arranca. Al abrir la app otra vez sigue ahí.
4. Si el repositorio tiene una versión más nueva, sale **Update to vX**, y la nueva sustituye a la vieja sin reiniciar.
5. **Uninstall** lo para (sus comandos, temas y listeners se van al momento) y borra sus archivos, lo que se le permitió y lo que guardó en `api.storage`.

Los que vienen con Pepino (Hello world, Word count) no se desinstalan: se apagan.

### Gestionar un plugin (#57)

En PLUGINS cada plugin tiene **Manage**: sus permisos (cuáles están permitidos, y **Take back permissions**, que lo para hasta que el usuario lo vuelva a permitir), sus ajustes (`contributes.settings`: texto, número o sí/no), lo que aporta (comandos y temas) y su log. Formatter, Pickle themes y Snippets se instalan desde el repositorio: ya no vienen dentro de la app.

`install → (usuario aprueba permisos) → onActivate → ... → onDeactivate → uninstall`

## Implementación del host (ADR-004)

La spec no cambia con el paso a TypeScript + Capacitor; solo cambia quién la implementa:

- Cada plugin corre en **QuickJS compilado a WASM** (`quickjs-emscripten`) dentro de un **Web Worker** propio: sin DOM, sin `fetch` y fuera del hilo de UI.
- `api.*` es un RPC por mensajes con el host, por eso todas las operaciones del editor, git y fs devuelven promesas. `api.settings.get` es síncrono porque los settings del plugin se copian al sandbox al activarlo.
- Los permisos se comprueban en el host, en el lado que recibe cada llamada. `network` expone una función de red del host solo a los plugins que lo declaran.
- El timeout combina el interrupt handler de QuickJS (deadline por callback) y, si no basta, `worker.terminate()` + desactivar el plugin.
- Los comandos se registran en el `CommandRegistry` y los eventos llegan desde el `EventBus` (topics string con payloads de datos planos).
