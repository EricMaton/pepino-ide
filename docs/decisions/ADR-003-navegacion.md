# ADR-003: Navegación por estado hasta que haya pantallas reales

- **Estado:** Aceptada (actualizada el 2026-10-15 para el stack de [ADR-004](ADR-004-typescript.md) y el 2026-10-16
  con el explorador y el workspace de #114)
- **Fecha:** 2026-10-14

## Contexto

La app empieza a tener más de una superficie: proyectos locales (explorer),
y en el roadmap proyectos git en la nube, settings, editor, terminal… Hay que
decidir cómo se navega entre ellas sin comprometer el futuro.

## Decisión

- Un modelo de destinos tipado (`AppDestination`, union type en
  `src/app/destinations.ts`) y navegación por **estado React simple**
  (`useState` + render condicional en `App.tsx`). Sin librería de navegación
  ni router.
- Añadir un destino = una entrada en `DESTINATIONS` + una rama en `App.tsx`.
- Cuando existan 3+ pantallas reales con estado propio (back stack,
  deep links, argumentos), se evaluará adoptar un router; el union type de
  destinos seguirá siendo el modelo de rutas.
- La navegación *dentro* del file explorer es una pila de rutas local
  (`string[]` en estado del componente), nunca comparación de strings de
  paths: entrar apila, UP desapila, y UP se deshabilita cuando solo queda la
  raíz. Es imposible salir del project space por UI. Además, `ProjectSpace`
  normaliza y rechaza cualquier ruta que escape de la raíz.
- **Explorador y workspace** (#114): PROJECTS tiene dos modos separados, como
  abrir una carpeta en VS Code. El explorador recorre `~/projects` (tocar una
  carpeta entra en ella; abrirla como workspace es un botón aparte) y abre los
  archivos sueltos, fuera de cualquier workspace. El workspace es el proyecto
  activo: su árbol y sus archivos abiertos como pestañas. El proyecto activo
  es uno solo para el editor y Git, y sigue activo mientras se ve el
  explorador. Al explorador se llega tocando PROJECTS estando ya en PROJECTS
  (#121); desde otra sección PROJECTS solo navega, y el logo es solo marca.
- **Back de Android** (`src/ui/back.ts`): una pila de handlers. Cada
  superficie registra el suyo mientras puede "deshacer" algo
  (`useBackHandler(enabled, handler)`): los diálogos mientras están abiertos,
  el explorer mientras puede subir, la shell mientras no está en la home. El
  botón back ejecuta el último registrado; si no hay ninguno, sale de la app.

### Alternativas consideradas

- **React Router / TanStack Router desde ya**: rutas por URL no aportan nada
  en una app empaquetada con una sola pantalla real; coste sin beneficio
  todavía.
- **Integrar back con `history.pushState`**: acopla el back del sistema a la
  URL y se desincroniza fácilmente con diálogos; la pila explícita es más
  predecible.

## Consecuencias

- Cero dependencias nuevas; la shell de navegación es un componente.
- El back de Android siempre deshace primero lo más interno (diálogo → cajón
  → pestaña → árbol del workspace → explorador → carpeta → tab → salir), sin
  que ninguna pantalla conozca a las demás.
- Migrar a un router después será barato: `App.tsx` es el único punto de
  acoplamiento.
