# 🧱 Brickwise

App web local (Next.js) para analizar inmuebles en venta de [Property Finder UAE](https://www.propertyfinder.ae): montas tu cartera de anuncios guardados y la app calcula **rentabilidad bruta y neta, cash-on-cash y coste real de compra** cruzando el histórico real de transacciones DLD (compra y alquiler) del propio edificio con los service charges oficiales de Mollak/RERA.

## Arranque en un comando

App **100% local**: el servidor y la base de datos corren en tu máquina, sin nube. Solo necesitas
tener [Node.js](https://nodejs.org) 18.18+ instalado.

```bash
npx brickwise
```

Eso es todo: **instala las dependencias y arranca** (la primera vez tarda ~1 min instalando),
elige un puerto libre y abre la app en tu navegador. No hay nada más que configurar.

### ¿Prefieres un icono y olvidarte de Node?

Hay instalables de escritorio para **macOS (Apple Silicon)** y **Windows x64** que llevan dentro
su propio Node y el mismo servidor: `Brickwise-<versión>-mac-arm64.dmg` y
`Brickwise-<versión>-win-x64-setup.exe`. Usan la misma base de datos que `npx brickwise`.
Instalación paso a paso en **[desktop/INSTALACION.md](desktop/INSTALACION.md)**; cómo se
construyen, en [desktop/README.md](desktop/README.md).

<details>
<summary>¿Prefieres clonarlo?</summary>

```bash
git clone https://github.com/eljommys/brickwise.git
cd brickwise
npm install
npm run dev      # → http://localhost:3000
```
</details>

### Base de datos local

Todo (favoritos, pipeline, grupos, actividades, análisis, transacciones, ubicaciones, gimnasios,
ajustes, service charges y datos STR) se guarda en un único fichero **SQLite** en
**`~/.brickwise/brickwise.db`** (en tu carpeta de usuario). Se crea solo al primer uso
y **persiste entre reinicios y actualizaciones**. Para copia de seguridad o mover tus datos, basta con
**copiar ese fichero**. Puedes cambiar su ubicación con la variable de entorno `BRICKWISE_DB`.

## Qué hace

- **`/`** — *Favoritos + Mapa*: la portada. Añades anuncios, los ves sobre el mapa y filtras.
- **`/pipeline`** — tablero de seguimiento por estados, con el contacto del agente y el registro de llamadas, visitas y ofertas.
- **`/analizados`** — tabla ordenable con todo lo analizado.
- **`/listing/[id]`** — la ficha completa de un inmueble.
- **`/settings`** — todas las constantes del modelo financiero, los service charges y los datos STR.
- **`/guia`** — glosario y metodología, calculados con tus propios números.

(`/search`, `/map` y `/favorites` son rutas antiguas que redirigen a `/`.)

### `/` — Favoritos + Mapa

- **Añadir anuncios**: pegas enlaces de ficha de Property Finder (uno por línea) y se analizan de uno en uno. Un anuncio ya retirado no se da de alta: en su lugar la app busca su recambio.
- **Sincronizar con PF**: un *bookmarklet* que arrastras a la barra de marcadores; lo pulsas en tu página de Guardados de PF (con tu sesión iniciada), recorre todas las páginas, copia los enlaces al portapapeles y los pegas aquí de una tacada. Los que ya tengas no se duplican.
- **Mapa** (Leaflet) con un pin por anuncio. La métrica del pin se cambia y la lista se ordena con ella: `Neta`, `Bruta`, `CoC`, `vs mediana`, `Reforma`, `Tamaño`, `AED/sqft` y `Ficha`. Los pines de un mismo edificio se abren en abanico al pasar el ratón.
- **Capas**: gimnasios (los que guardas tú pegando un enlace de Google Maps), cafeterías (OpenStreetMap) y **mapa de calor de liquidez** — transacciones DLD al año por edificio, de alquiler o de venta.
- **Filtros**: habitaciones, `Ready`/`Off-plan`, `✓ Compra` (el criterio de compra de tus Ajustes) y `⚠ Retirados`. Lo que no cumple no desaparece: se atenúa al final de la lista.
- **Comprobar disponibilidad**: descarga de PF los anuncios de la lista para ver si siguen publicados (~1 s cada uno, se puede parar). Los retirados se marcan con ⚠ y se les busca recambio: mismo edificio, mismas habitaciones y ±15 % de precio; si en el edificio no queda nada, ensancha a la comunidad.
- Notas por anuncio y grupos (★) para organizar la cartera.

### `/pipeline`

Tablero con seis columnas — **Pendiente, Contactado, Visitado, Oferta, Adquirido, Descartado** — por las que arrastras cada anuncio según avanza. Cada tarjeta lleva:

- **Contacto del agente**: WhatsApp (replicando el enlace oficial de PF), teléfono y email. «Refrescar contactos» vuelve a scrapear los anuncios a los que les falta.
- **Registro de actividad**: llamadas, visitas, ofertas y notas con fecha. Las ofertas van con importe (oferta / contraoferta / precio final) y el descuento sobre el precio pedido se calcula solo.
- Grupos, métrica visible y orden (por la métrica mostrada, neta, bruta, CoC, precio, AED/sqft, actividad reciente o fecha de alta).

### `/listing/[id]`

- **Datos básicos**, galería y enlace al anuncio original.
- **Análisis**: bruta, neta, CoC, `vs mediana` y descuento frente a la curva de tendencia de AED/sqft del edificio.
- **Finanzas**: cash upfront desglosado, cuota, aviso de DBR y de dónde sale el service charge aplicado.
- **Plan «vivo primero, alquilo después»**, **alquiler vacacional (STR)** y **revalorización estimada**, cuando hay datos para calcularlos.
- **Escenario de reforma**, gráfico de AED/sqft con su curva de tendencia y las tablas de transacciones de venta y alquiler del edificio.
- Se pueden fijar a mano el **service charge real** y el **tipo de refrigeración** (ambos son del edificio: se aplican a toda la torre), el **waiver del DLD** y si lo compras como **2ª vivienda**. El análisis se recalcula al instante.

### `/settings` y `/guia`

Ajustes reúne las constantes del modelo (hipoteca, costes de compra, explotación, tu perfil, plan de residencia, umbrales de decisión y STR), tu presupuesto personal, la descarga del dataset Mollak, las estimaciones de service charge por zona y el refresco de los datos AirROI. **Cualquier cambio recalcula todos los análisis guardados**, sin volver a scrapear. La Guía explica cada métrica con tus propios números.

## Qué calcula

Los comparables son siempre transacciones DLD del **mismo edificio**, de tamaño **±20 %** (refinado por número de habitaciones cuando la muestra lo aguanta) y de los **últimos 24 meses**. Se busca una muestra de al menos 3; si no la hay se usa el mejor conjunto comparable disponible, y el tamaño muestral se muestra siempre. Cuando no basta para emitir veredicto, la app escribe `n=X` en gris: «no lo sé» no es «está en precio».

- **Rentabilidad bruta** = mediana de rentas anuales / precio del anuncio. La de *mercado* usa la mediana de ventas en lugar del precio pedido.
- **Neta** = (renta menos vacancia − service charges − mantenimiento − seguro) / precio.
- **Cash-on-cash** = flujo tras pagar la cuota, sobre el cash que pones de verdad: entrada + DLD + trustee + agente + fees de hipoteca.
- **vs mediana**: tu AED/sqft frente a la mediana AED/sqft de las ventas comparables. Las diferencias de más del 35 % se marcan como sospechosas, no como chollo.
- **Service charge**: override manual → dato oficial de Mollak del edificio → estimación por zona → default global. La ficha siempre dice cuál se ha usado.
- **Hipoteca y DBR**: cuota francesa, y aviso si supera el Debt Burden Ratio con tu sueldo y tus cuotas actuales.
- **Plan de residencia**: cuánto te cuesta vivir ahí frente a tu alquiler actual, el capital que amortizas, cuánto tardas en juntar la entrada del siguiente piso, y la neta y el CoC diferidos al alquilarlo ya reformado (la renta post-reforma se capa al P75 del edificio).
- **Reforma**: la subida de renta depende del **alcance** (mobiliario, suelo, paredes, techos), no del dinero que teclees — cada partida captura una fracción del margen mediana→P75, y el coste solo mueve el payback.
- **STR**: ingresos netos de gestión, permiso DTCM, tourism dirham y utilities a partir del submercado de AirROI, más el modo híbrido (vivir el año y alquilar solo las noches pico) y el ADR de equilibrio.
- **Revalorización**: a partir de los off-plan que tengas guardados en la misma comunidad o a <3 km (tamaño ±30 %, con entrega futura), con escenario alcista y bajista y una señal de demanda según la prima de las reventas sobre el precio de lista del developer.
- **Veredicto `✓ Compra`**: depende de tu estrategia. Si inviertes desde el día 1, exige neta y CoC por encima de tus umbrales; si vas a vivir en él primero, exige neta y que vivir ahí no te cueste más que tu alquiler actual. Pasa a `✓✓ Compra+` cuando además la zona tiene revalorización estimada positiva, suficientes off-plan comparables y demanda sana.

## De dónde salen los datos

| Fuente | Qué aporta | Caché |
| --- | --- | --- |
| Property Finder | ficha del anuncio y transacciones DLD del edificio | análisis 24 h, transacciones 7 días |
| Mollak / RERA vía [Dubai Pulse](https://www.dubaipulse.gov.ae) | service charge oficial en AED/sqft/año por edificio | manual, desde Ajustes |
| [AirROI](https://www.airroi.com) | ADR, ocupación e ingresos anuales de 5 submercados de Dubái | 30 días |
| OpenStreetMap (Overpass) | cafeterías y súper/mall cercanos | 30 días |
| Google Maps | los gimnasios que pegas tú | — |

Si Dubai Pulse no responde (geobloquea el tráfico de fuera de UAE con frecuencia) se usa el último snapshot de archive.org: el dataset se actualiza una vez al año, así que ir un año por detrás sale barato.

## Cómo scrapea

Property Finder es una app Next.js: cada página embebe sus datos en `<script id="__NEXT_DATA__">`. Basta un `fetch` con User-Agent de navegador (sin headless):

- Ficha: `share_url` del anuncio → `propertyResult.property` (incluye `similar_price_transactions` como fallback).
- Transacciones: `/en/transactions/{buy|rent}/dubai/{slug}?page=` (paginado, tope 10 págs por tipo).
- Búsqueda: `/en/search?l={locId}&c=1&pf=&pt=&bdr[]=&page=` — ya no hay buscador en la app; se usa para encontrar el recambio de un anuncio retirado.
- Ubicaciones: `/api/pwa/location/list` (~7,5k filas) + ancestros derivados de los paths → tabla `locations`, que resuelve la comunidad de una torre a partir de su `path`.

Scraping educado: cola global a **1 req/s**, retry con backoff y caché en SQLite.

## Estructura

```
src/lib/pf/                 cliente HTTP (1 req/s), parser __NEXT_DATA__, search, listing, transactions, locations
src/lib/yield.ts            comparables (±20 % de tamaño, 24 meses) y medianas de renta y venta
src/lib/trend.ts            curva de AED/sqft del edificio y descuento vs tendencia
src/lib/finance.ts          hipoteca, cash upfront, neta, CoC, DBR, plan de residencia, STR y revalorización
src/lib/config.ts           constantes del modelo y su persistencia en la tabla settings
src/lib/serviceCharges.ts   tasa aplicada: override → Mollak → zona → default
src/lib/mollak.ts           dataset Mollak/RERA de Dubai Pulse (con fallback a archive.org)
src/lib/cooling.ts          tipo de refrigeración del edificio y quién paga el frío
src/lib/airroi.ts           submercados STR de AirROI
src/lib/reform.ts           modelo de reforma por partidas y payback
src/lib/priceSignal.ts      veredicto de precio vs mediana (chollo / en precio / caro)
src/lib/metrics.ts          métrica de pines y tarjetas: valor, etiqueta y color
src/lib/availability.ts     ¿sigue publicado? y búsqueda de recambio en PF
src/lib/pipeline.ts         estados del pipeline y enlaces de contacto (WhatsApp/teléfono/email)
src/lib/agent.ts            contacto del anuncio, normalizado
src/lib/recompute.ts        recalcula los análisis desde caché, sin tocar la red
src/lib/pois.ts             cafeterías y súper/mall vía Overpass (OSM)
src/lib/gmaps.ts            resuelve enlaces de Google Maps a coordenadas
src/lib/store.ts            consultas de listings, favoritos, grupos, actividades y liquidez
src/lib/db.ts               SQLite (better-sqlite3) + esquema y migraciones
src/app/api/                favorites, listing/[id], pipeline, groups, activities, availability,
                            attractors/[id], settings, service-charges, str/refresh, mollak/refresh,
                            recompute, dashboard, liquidity, gyms, cafes, locations
src/app/                    páginas: / (favoritos + mapa), pipeline, analizados, listing/[id], settings, guia
```

## Notas

- Uso personal/local. Respeta los términos de Property Finder: no elevar el rate-limit ni desplegarlo público.
- Son estimaciones sobre datos públicos, no asesoramiento financiero. La neta ya descuenta service charges, vacancia, mantenimiento y seguro, pero el service charge real conviene verificarlo edificio por edificio; los tamaños muestrales (`N tx`, `n=X`) se muestran como indicador de confianza.
