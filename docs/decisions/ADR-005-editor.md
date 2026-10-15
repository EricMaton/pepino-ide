# ADR-005: Editor de código con CodeMirror 6

- **Estado:** Aceptada
- **Fecha:** 2026-10-15

## Contexto

El Sprint 2 necesita un editor de código usable en un móvil: syntax
highlighting, edición táctil precisa, archivos de miles de líneas sin tirones
y una API que puedan usar los plugins (`api.editor.getText/setText`, eventos
`onSave/onChange/onOpen`). Tras ADR-004 el editor corre en el WebView, así que
la elección es entre editores web.

## Decisión

- **CodeMirror 6** (`@codemirror/*`) en `src/features/editor`.
- Lenguajes con gramática **Lezer** cuando existe (TS/JS/JSX, JSON, Markdown,
  HTML, CSS, Python) y **modos legacy** (`@codemirror/legacy-modes`) para el
  resto (Kotlin, Java, C/C++, C#, Swift, Go, Rust, Shell, YAML, TOML, SQL).
  La extensión del archivo decide el lenguaje (`languageFor`).
- **Todo se carga bajo demanda:** la pantalla del editor es un `React.lazy` y
  cada gramática un `import()` dinámico que se aplica tras el primer render
  (un `Compartment`). El arranque de la app no paga el editor.
- **Tema desde los tokens** de `src/ui/tokens.css` (`EditorView.theme` +
  `HighlightStyle` con `var(--…)`), dentro de la paleta de Pepino: rojo para
  palabras clave, blanco para nombres y tipos, gris para comentarios y
  puntuación, mezclas rojo/blanco para literales. Un tema de la app (#44)
  re-tiñe el editor sin código adicional.
- El editor se superpone al explorer en vez de reemplazarlo: cerrarlo vuelve
  a la misma carpeta, y cambiar de pestaña lo oculta sin perder cambios.

### Alternativas consideradas

- **Monaco**: el editor de VS Code. Pesado (varios MB), pensado para
  escritorio y con soporte táctil/IME en Android flojo.
- **Ace**: maduro, pero su modelo de render y el soporte móvil son peores que
  los de CodeMirror 6, y su ecosistema está más parado.
- **tree-sitter (WASM) + render propio**: parsing excelente, pero obliga a
  escribir el editor entero (cursor, selección, IME, virtualización). Se
  puede añadir más adelante como parser de un lenguaje concreto dentro de
  CodeMirror si hiciera falta.

## Consecuencias

- Renderiza solo el viewport: base razonable para archivos grandes (#20).
- El IME de Android (Gboard, SwiftKey) sobre `contenteditable` es el riesgo
  principal; se valida en #16. Autocapitalización y autocorrección se
  desactivan en el contenido.
- Los finales de línea se normalizan a `\n` al guardar: un archivo CRLF se
  convierte a LF si se edita. Pendiente de decidir si preservarlos (#18).
- La API de plugins para el editor (#48) se construye sobre transacciones de
  CodeMirror.
