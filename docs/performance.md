# Rendimiento

## Editor con archivos grandes (#20)

**Objetivo:** archivos de al menos 5.000 líneas sin tirones visibles (Sprint 2);
50.000+ es el objetivo del Sprint 9-10 (#64).

### Cómo medir

```bash
npm run build && npx vite preview --port 4173   # en otra terminal
npm run perf:editor                              # 10, 5.000 y 50.000 líneas, CPU 4×
npm run perf:editor -- --lines 5000 --cpu 6
```

`scripts/perf/editor-large-files.mjs` abre la app en el Chrome instalado
(`playwright-core`, sin descargar navegadores) a 390×844 con la CPU
ralentizada 4× (aproximación a un móvil de gama media) y, para cada tamaño:

1. Pega el código (el manejador de pegado de CodeMirror, una transacción) y guarda.
2. Mide la **apertura**: del toque en la fila a la primera línea pintada.
3. Mide el **scroll a saltos**: 20 saltos del 5 % del documento; cuenta frames de más de 50 ms.
4. Mide la **latencia por tecla**: tecla + siguiente frame, mediana y peor caso.

### Resultados (2026-10-15, Chrome headless, CPU 4×)

| Líneas | Apertura | Tecla (mediana / peor) | Frames largos al escribir | Scroll a saltos: peor frame |
| -----: | -------: | ---------------------: | ------------------------: | --------------------------: |
|     10 |   488 ms |           66 / 90 ms |                         3 |                       17 ms |
|  5.000 |   362 ms |          63 / 165 ms |                         1 |                      267 ms |
| 50.000 |   264 ms |          77 / 177 ms |                         0 |                      100 ms |

Lectura:

- **Escribir no depende del tamaño del archivo.** La latencia por tecla de
  5.000 y 50.000 líneas es la misma que con 10. Esos ~65 ms son sobre todo el
  propio arnés (Playwright + esperar un frame a CPU 4×), no la app.
- **Abrir no depende del tamaño:** CodeMirror solo pinta el viewport y la
  gramática se carga después del primer pintado (ADR-005). Sin ralentizar, un
  archivo de 50.000 líneas se pega en ~190 ms, se guarda en ~200 ms y se abre en ~100 ms.
- **Saltar de golpe al final** de un archivo largo obliga al resaltado a
  analizar todo lo anterior: un frame de 100-270 ms a CPU 4× (≈ 25-65 ms
  reales). Con scroll táctil continuo el análisis se reparte. CodeMirror deja
  de analizar más allá de su presupuesto de tiempo en documentos enormes, por eso
  50.000 líneas sale mejor que 5.000.
- Las cifras varían entre ejecuciones según la carga de la máquina; compara
  siempre contra la fila de 10 líneas de la misma ejecución.

### En el WebView de Android

```bash
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof dev.pepino.ide)
npm run perf:editor:device                       # 10, 5.000 y 50.000 líneas
npm run perf:editor:device -- --lines 5000 --port 9222
```

`scripts/perf/editor-device.mjs` maneja la app instalada (build de depuración)
por el protocolo de DevTools, sin Playwright (no gestiona contextos de un
WebView). Hace los mismos pasos que la versión de escritorio, pero mide **dentro
de la página** para que no cuenten los viajes por adb: la apertura, del toque al
primer pintado; cada tecla, del `beforeinput` al frame que la muestra. Escribe
como un teclado en pantalla (`Input.insertText`, carácter a carácter). Crea un
proyecto `perf-device` y lo borra al terminar.

#### Resultados (2026-10-15, emulador Android 15, WebView 124, sin ralentizar)

| Líneas | Apertura antes | Apertura | Tecla (mediana / peor) | Scroll a saltos: peor frame |
| -----: | -------------: | -------: | ---------------------: | --------------------------: |
|     10 |          81 ms |   117 ms |           20 / 130 ms |                       17 ms |
|  5.000 |         747 ms |   225 ms |            29 / 57 ms |                  100-517 ms |
| 50.000 |       3.034 ms |   286 ms |            40 / 94 ms |                       83 ms |

Lectura:

- **Abrir dependía del tamaño en el dispositivo**, no en escritorio: el plugin
  `Filesystem` pasa el contenido por el puente nativo como JSON, a ~0,5 ms por
  KB (3,8 MB ≈ 2 s; CodeMirror solo añadía ~200 ms). Ahora `readText` lee con
  `fetch` del servidor local del WebView (`Capacitor.convertFileSrc`), unas 5
  veces más rápido, y conserva el BOM igual que el puente. Si falla, vuelve al
  puente y a sus errores.
- **Escribir no depende del tamaño:** 20-40 ms de mediana por tecla. Los frames
  largos que se ven mientras se escribe al final de un archivo grande son el
  parser poniéndose al día tras el salto (perfilado: Lezer, que cede el hilo
  por trozos), no el coste de cada tecla.
- **Guardar** un archivo grande sigue pasando por el puente (3,8 MB ≈ 1,4 s,
  asíncrono). Basta para el objetivo de 5.000 líneas (368 KB ≈ 160 ms); para
  50.000+ queda para #64.
- El emulador corre en un x86 de escritorio: un móvil de gama media será más
  lento. Repite la medición en uno real con el mismo comando.

### Notas

- Insertar mucho texto con `Input.insertText` (la vía de un IME) escala de
  forma cuadrática en CodeMirror (3.000 líneas ≈ 30 s). Un usuario nunca
  hace eso; pegar sí, y es lineal. Por eso los scripts pegan: el de escritorio
  con el evento de pegado; el de Android, con la misma transacción que ese
  evento (un evento sintético con el teclado abierto puede aplicarse dos veces).
