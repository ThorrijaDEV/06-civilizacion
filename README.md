# ALDEA — civilización artificial con memoria de generaciones

Una civilización en miniatura que nace, aprende, **se olvida y se acuerda**. Los individuos no saben, son: sufren hambre y sed, guardan recuerdos, enseñan a los jóvenes y — cuando pueden escribir — dejan tablillas que **sobreviven a su muerte** y guían a las generaciones que vienen. Cuando todos mueren, el mundo se despuebla… salvo por lo escrito.

## Qué es

- **Un mundo de 70×44 celdas** (llano, bosque, agua, piedra) con bayas, madera y piedra que se regeneran con las estaciones.
- **Individuos con necesidades**: energía, hambre, sed. Su hambre les dicta planes: buscar comida, agua, materiales, recolectar para la banda, construir, escribir, aprender de un mayor o volver a casa.
- **Memoria episódica**: cada individuo recuerda hasta `memoryCap` lugares útiles (comida abundante, agua, material); los recuerdos que no se usan se olvidan.
- **Cultura**: los jóvenes aprenden de los mayores cercanos (el saber sube hasta el nivel del maestro), y una lección bien repetida mejora a toda la banda.
- **Artefactos reales**: los fogones, chozas, pozos y almacenes **hacen algo** (recuperan energía, reducen sed, guardan la reserva comunal).
- **Tecnologías**: `fuego, choza, pozo, almacen, escritura`; sin escritura no hay tablillas, y sin tablillas la civilización muere con sus ancianos.
- **Bandas**: grupos que comparten campamento y reserva de comida; el excedente personal va a la olla común.
- **Épocas**: si la población se extingue, la aldea vuelve a fundarse… pero las tablillas escritas siguen en el mundo y se leen.
- **Determinismo total**: mismo *seed* → misma historia. Semilla `7` da una civilización floreciente de referencia.

## Por qué existe

Es la pregunta de este laboratorio: **¿qué es lo que hace que una cultura recuerde cuando los individuos ya no están?** ALDEA simula la transición de la memoria individual (neuronas que olvidan) a la memoria externa (libros, mapas, leyes). Los registros escritos no solo "están ahí": se erosionan con el tiempo, se desperdigan por el mundo, y solo sirven si alguien va a leerlos. La escritura es un puente entre generaciones, exactamente como en la historia real.

## Uso

### Servidor + interfaz web (recomendado)

```bash
node server.js
# Abre http://localhost:4949   (ALDEA_PORT para cambiar el puerto)
```

Verás el mundo vivir: agentes por bandas (cada una con su color), construcciones, tablillas ámbar, la gráfica de la historia y la bitácora. Cambia la semilla y pulsa **rehacer mundo** para otro planeta.

### CLI de simulación

```bash
node sim/run.js 7 12000        # semilla, ticks; imprime historia + resumen + chequeo de determinismo
node tests/run.js              # 17 pruebas
```

### Opciones

- **`SEED` / `TICKS` / `ALDEA_PORT`**: variables de entorno equivalentes a los argumentos.

## Arquitectura

```
js/core/
  rng.js     ← mulberry32: PRNG determinista con semilla (UMD, usable en navegador y Node)
  world.js   ← World: terreno, recursos regenerativos, artefactos, registros indexados por celda, búsquedas acotadas
  agents.js  ← Agent: necesidades, memoria episódica, planes, pared, construir, escribir, leer, aprender, reproducirse
  civ.js     ← Civilization: bandas (union-find), nacimientos con herencia genética y cultural, épocas, historia
sim/run.js   ← simulación CLI + chequeo de determinismo
server.js    ← http local: API (estado / avanzar / reiniciar) + estáticos
js/web.js    ← interfaz de exploración (canvas + gráfica + bitácora)
index.html
tests/
  world.test.js  ← 6 pruebas de mundo (terreno, tóricas, blob flotante, recursos, búsquedas)
  civ.test.js    ← 11 pruebas (memoria, cultura, escritura que sobrevive, construcción, determinismo, divergencia)
```

**El bucle de la civilización** (`civ._step`):
1. El mundo regenera recursos.
2. Cada individuo decide y actúa (un plan a la vez, priorizando sobrevivir).
3. Mueren quienes no sobreviven.
4. Periodicamente las bandas se recomponen por proximidad.
5. Si no queda nadie, nace una nueva época (las tablillas esperan).
6. Las tablillas más antiguas se erosionan: la memoria escrita también envejece.

**El ciclo del saber**: mayor → enseña al joven → el joven construye/almacena/escribe → el anciano escribe una tablilla → un desconocido la lee años después → el saber resurge sin maestro vivo.

## Ejemplo real

```
$ node sim/run.js 7 9000
== ALDEA · semente 7 ==
t     pop   con   regis  construcciones
5000     6    23       3                 0
...       …     …       …                 …
8800     3    41       4                 2
   nacimientos 25 · muertes 36 · épocas 1 · conocimiento 42

determinismo (mismo seed, 4000 ticks): OK
```

(Semillas distintas dan historias muy distintas: con `seed 11` la población llegó a 90+ — el mundo y sus frutos dictan el destino.)

## Notas de honradez

- El balance de supervivencia es deliberadamente duro: una civilización puede quedarse en 8 individuos, estancarse o extinguirse. **Alguna semilla debería florecer (el test lo garantiza), no todas.**
- El efecto mariposa es real: un cambio diminuto (qué recuerdo se olvida) reescribe toda la historia. Por eso el determinismo se prueba con el mismo seed, no entre seeds.

## Estado

- Núcleo completo: mundo, agentes con memoria, cultura, bandas, artefactos, registros, épocas. 17 pruebas, CLI y web funcionando.
- Pendientes: choza/almacén con mecánica más profunda (dormitar, lonas), religión/mitos (transmisión de *significados* no técnicos), murales (arte sin utilidad funcional), fronteras entre bandas, sesgo de natalidad (más bebés cuando hay excedente), y un modo "etnógrafo" que traduzca la historia a un relato.

## Licencia

MIT