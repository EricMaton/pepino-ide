# ADR-004: Frontend en TypeScript + React + Capacitor

- **Estado:** Aceptada
- **Fecha:** 2026-10-15
- **Reemplaza a:** [ADR-001](ADR-001-stack.md)

## Contexto

Tras el Sprint 1 con Kotlin Multiplatform + Compose Multiplatform, la UI choca
con límites de diseño: tipografía y layout poco flexibles, componentes de
Material difíciles de doblegar al sistema brutalista, e iteración visual lenta
(compilar + desplegar para ver cada cambio). Para un IDE, la superficie de UI
es casi todo el producto.

Lo implementado hasta `d20e9c0` era pequeño (shell, comandos, eventos, file
explorer), así que el coste de cambiar ahora es bajo y crece con cada sprint.

## Decisión

- **TypeScript + React + Vite** para toda la app. Estilos con **CSS Modules**
  sobre **CSS custom properties** (tokens en `src/ui/tokens.css`), sin
  librería de componentes: el design system es propio.
- **Capacitor** como contenedor nativo (Android primero; iOS con `cap add ios`
  cuando toque). Las APIs nativas se consumen como plugins de Capacitor; las
  que no existan (PTY de la terminal) se escriben como plugins propios en
  Kotlin/Swift.
- Versiones: Capacitor 8, React 19, Vite 8, TypeScript 6.0 (typescript-eslint
  aún no soporta TS 7). Android: minSdk 26, target/compile 36, JDK 21 para
  compilar.
- Estructura: `src/core/*` (comandos, eventos), `src/ui/*` (design system),
  `src/features/*` (una carpeta por feature), `src/app/*` (shell). Es el
  equivalente de los módulos Gradle `:core:*` / `:feature:*` / `:app`.
- Tests con **Vitest** sobre la lógica pura; el filesystem se prueba contra un
  backend en memoria detrás de la misma interfaz (`FsBackend`).

### Impacto en otras ADRs

- **ADR-002 (plugins JS)** sigue en pie y se simplifica: el host ya es JS.
  QuickJS se ejecutará como WASM (`quickjs-emscripten`) en un Web Worker en
  vez de vía JNI/cinterop. El `EventBus` usa topics string con payloads de
  datos planos para que los eventos crucen al sandbox.
- **ADR-003 (navegación)** se mantiene con el mismo modelo, traducido a un
  union type + estado React. El back de Android se integra mediante una pila
  de handlers (ver ADR-003).

### Alternativas consideradas

- **Seguir con Compose** invirtiendo en componentes propios: posible, pero el
  ciclo de iteración visual sigue siendo lento y el ecosistema de UI de
  escritorio/web (editores, terminales, diffs) no está disponible.
- **Flutter**: buen control del render, pero obliga a Dart y deja fuera el
  ecosistema JS que necesitamos de todas formas para plugins.
- **React Native**: UI nativa, pero CodeMirror, xterm.js e isomorphic-git
  dependen del DOM o funcionan peor fuera de él.
- **Tauri mobile**: atractivo, pero menos maduro en móvil que Capacitor.

## Consecuencias

- Se pierde el código compartido vía KMP; a cambio, el 100% de la UI y la
  lógica es TypeScript compartido entre Android, iOS y navegador.
- `npm run dev` permite iterar el diseño en el navegador (el filesystem usa
  IndexedDB vía Capacitor en web) y `/#catalog` muestra los componentes.
- Componentes clave del roadmap pasan a librerías web maduras: CodeMirror 6
  (editor) y xterm.js (terminal). Git va en un plugin nativo con JGit tras
  medirlo frente a isomorphic-git (ADR-006).
- **Riesgos**: rendimiento del WebView con archivos grandes (#20) y la
  terminal, que sigue necesitando un PTY nativo en un plugin propio.
