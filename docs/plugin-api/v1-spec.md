# Plugin API — Especificación v1

Los plugins son **scripts JS interpretados** (QuickJS) + un manifest declarativo.
Nunca binarios nativos: es lo que los hace portables (Android/iOS) y legales en App Store.

## Estructura de un plugin

```
my-plugin/
├── plugin.json   ← manifest
└── main.js       ← script
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

## Ciclo de vida

`install → (usuario aprueba permisos) → onActivate → ... → onDeactivate → uninstall`
