# ADR-003: Navegación por estado hasta que haya pantallas reales

- **Estado:** Aceptada
- **Fecha:** 2026-10-14

## Contexto

La app empieza a tener más de una superficie: proyectos locales (explorer),
y en el roadmap proyectos git en la nube, settings, editor, terminal… Hay que
decidir cómo se navega entre ellas sin comprometer el futuro.

## Decisión

- Un modelo de destinos tipado (`AppDestination`, enum en `:app`) y
  navegación por **estado Compose simple** (`var destination by remember` +
  `when`). Sin librería de navegación.
- Añadir un destino = una entrada en el enum + una rama en el `when` de
  `App.kt`.
- Cuando existan 3+ pantallas reales con estado propio (back stack,
  deep links, argumentos), se evaluará adoptar navigation-compose u otra
  librería; el enum de destinos seguirá siendo el modelo de rutas.
- La navegación *dentro* del file explorer es una pila de rutas local
  (`List<String>` apilada en el composable), nunca comparación de strings de
  paths: entrar apila, UP desapila, y UP se deshabilita cuando solo queda la
  raíz. Es imposible salir del project space por UI, con independencia de la
  canonicalización de rutas de cada plataforma.

### Alternativas consideradas

- **navigation-compose (JetBrains) desde ya**: añade dependencia y ceremonia
  (grafos, rutas serializables) para una sola pantalla real; coste sin
  beneficio todavía.
- **Voyager / Decompose / otras**: misma conclusión; decisión pospuesta, no
  descartada.

## Consecuencias

- Cero dependencias nuevas; la shell de navegación es ~80 líneas.
- El back stack real del sistema (gesto back de Android) aún no se integra
  con los destinos; pendiente para cuando haya pantallas reales.
- Migrar a una librería de navegación después será barato: el `when` es el
  único punto de acoplamiento.
