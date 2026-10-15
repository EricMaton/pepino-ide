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

### Notas

- Insertar mucho texto con `Input.insertText` (la vía de un IME) escala de
  forma cuadrática en CodeMirror (3.000 líneas ≈ 30 s). Un usuario nunca
  hace eso; pegar sí, y es lineal. Por eso el script pega.
- **Pendiente:** repetir en el WebView del emulador y en un dispositivo real
  de gama media junto con la validación táctil (#16).
