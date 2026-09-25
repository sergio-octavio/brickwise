# Marca

Logotipo horizontal de Brickwise: el **tile del icono de la app** (la "B" en Stack Sans Notch
Bold, ladrillo `#b84f30` sobre `#181818`) y el nombre a su derecha, en la misma tipografía,
en mayúsculas y con el mismo tracking que el logo del navbar (`.font-brand`, `0.04em`).

Cuatro variantes, todas con el mismo dibujo. Cada una en `.svg` (maestro vectorial) y en
`.png` + `@2x.png` (1171×256 y 2342×512, fondo transparente).

| Variante | Texto | Cuándo |
|---|---|---|
| `brickwise-logo` | `#202020` | Fondos claros. Es la de por defecto |
| `brickwise-logo-dark` | `#f5f5f5` | Dentro de la app, donde `#f5f5f5` es el token de fondo |
| `brickwise-logo-white` | `#ffffff` | Blanco puro: negro absoluto, fotos, vídeo, diapositivas |
| `brickwise-logo-mono-white` | `#ffffff` | **Un solo color**: el tile se rellena de blanco y la "B" queda calada. Para serigrafía, sellos, marcas de agua y encima de cualquier color |

Las tres primeras conservan el icono tal cual (tile `#181818`, "B" ladrillo). La `mono-white` es
la única que renuncia al color, y por eso es la que funciona sobre fondos de cualquier tono.

Los SVG **no dependen de la fuente**: los glifos van como paths, así que se ven igual en
cualquier máquina, navegador o programa de diseño.

## Usarlo bien

- **Aire alrededor**: deja como mínimo ¼ de la altura del tile por los cuatro lados (64 px a
  tamaño nativo). El `viewBox` va justo al borde del dibujo a propósito.
- **Tamaño mínimo**: 160 px de ancho. Por debajo, usa solo el tile del icono.
- **Escala proporcional siempre.** No separes el icono del texto, no recolores el texto ni el
  tile, y no cambies el hueco entre ambos.
- **Sobre fondo oscuro** (`#181818`, `#121212`) el tile se funde con el fondo y solo lo perfila
  el aro `#2a2a2a`: es el mismo efecto que tiene el icono en un dock oscuro, y es intencionado.
  Si necesitas que el cuadrado se lea ahí, tira de `mono-white`.
- **Sobre foto o color** no uses las variantes con tile oscuro: `mono-white` es la única pensada
  para eso, porque no depende de que el fondo sea oscuro ni claro.

## Colores

| | Hex | Dónde |
|---|---|---|
| Ladrillo | `#b84f30` | La "B" · `--accent` |
| Tile | `#181818` | Fondo del icono |
| Aro | `#2a2a2a` | Filo interior del tile |
| Tinta clara | `#202020` | Texto sobre fondo claro · `--foreground` |
| Tinta oscura | `#f5f5f5` | Texto sobre fondo oscuro · `--background` |
| Blanco | `#ffffff` | Variantes `white` y `mono-white` |

## Regenerarlo

```bash
cd desktop && npm run logo     # PNG a partir de los SVG (solo Electron, sin Python)
```

El maestro vectorial se rehace únicamente si cambian las proporciones, el texto o la fuente:

```bash
python3 -m venv .venv && .venv/bin/pip install fonttools
.venv/bin/python desktop/scripts/make-logo-svg.py
```

La fuente, [Stack Sans](https://github.com/DylanYoungKoto/Stack-Sans), es **SIL OFL 1.1**
(`public/fonts/Stack_Sans_Notch/OFL.txt`): los contornos se pueden incrustar y redistribuir.
