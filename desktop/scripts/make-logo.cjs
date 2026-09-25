"use strict";
/**
 * Rasteriza el logotipo horizontal (icono + "BRICKWISE") a PNG con fondo transparente.
 *
 * El maestro es vectorial: public/brand/brickwise-logo.svg y -dark.svg, con los contornos
 * de Stack Sans Notch Bold ya convertidos a paths, así que no dependen de la fuente.
 * Sus proporciones salen de make-icon.cjs (mismo tile, mismo radio, misma "B").
 *
 * Run with:  npm run logo   (usa Electron solo para rasterizar)
 *
 * Una sola ventana offscreen para todo: crear varias en serie con transparent+offscreen
 * hace que la segunda falle con ERR_FAILED. Se captura a 2x y el 1x sale reescalando.
 */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const BRAND = path.join(ROOT, "public", "brand");
const SCALE = 2;

const VARIANTS = [
  { svg: "brickwise-logo.svg", png: "brickwise-logo" },
  { svg: "brickwise-logo-dark.svg", png: "brickwise-logo-dark" },
  { svg: "brickwise-logo-white.svg", png: "brickwise-logo-white" },
  { svg: "brickwise-logo-mono-white.svg", png: "brickwise-logo-mono-white" },
];

const page = (svg, width, height) =>
  "data:text/html;charset=utf-8," +
  encodeURIComponent(
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}` +
      `svg{display:block;width:${width}px;height:${height}px}</style>${svg}`
  );

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    const sources = VARIANTS.map((v) => {
      const file = path.join(BRAND, v.svg);
      if (!fs.existsSync(file)) throw new Error(`No encuentro ${path.relative(ROOT, file)}`);
      const svg = fs.readFileSync(file, "utf8");
      const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
      if (!m) throw new Error(`${v.svg} no tiene viewBox`);
      return { ...v, svg, w: Number(m[1]), h: Number(m[2]) };
    });

    const width = Math.round(Math.max(...sources.map((s) => s.w)) * SCALE);
    const height = Math.round(Math.max(...sources.map((s) => s.h)) * SCALE);
    const win = new BrowserWindow({
      width,
      height,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      useContentSize: true,
      webPreferences: { offscreen: true, sandbox: false },
    });

    for (const s of sources) {
      const w2 = Math.round(s.w * SCALE);
      const h2 = Math.round(s.h * SCALE);
      await win.loadURL(page(s.svg, w2, h2));
      await new Promise((r) => setTimeout(r, 300)); // que asiente el frame offscreen

      let shot = await win.webContents.capturePage({ x: 0, y: 0, width: w2, height: h2 });
      if (shot.isEmpty()) throw new Error(`Captura vacía de ${s.svg}`);
      if (shot.getSize().width !== w2) shot = shot.resize({ width: w2, height: h2, quality: "best" });

      const big = path.join(BRAND, `${s.png}@2x.png`);
      fs.writeFileSync(big, shot.toPNG());
      console.log(`✓ ${path.relative(ROOT, big)} (${w2}×${h2})`);

      const one = shot.resize({ width: Math.round(s.w), height: Math.round(s.h), quality: "best" });
      const small = path.join(BRAND, `${s.png}.png`);
      fs.writeFileSync(small, one.toPNG());
      console.log(`✓ ${path.relative(ROOT, small)} (${Math.round(s.w)}×${Math.round(s.h)})`);
    }

    win.destroy();
    app.exit(0);
  } catch (err) {
    console.error(`\n✖ ${err.message}`);
    app.exit(1);
  }
});
