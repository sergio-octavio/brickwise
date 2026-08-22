"use strict";
/**
 * Renders the app icon from the same "B" the navbar shows (Stack Sans Notch, uppercase,
 * brick accent #b84f30 on #181818) and writes:
 *   desktop/build/icon.png   1024x1024, source for the .icns/.ico electron-builder derives
 *   src/app/favicon.ico      multi-size ICO used by the web app
 *
 * Run with:  npm run icon   (it needs Electron only to rasterize the font)
 */
const { app, BrowserWindow, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const DESKTOP = path.resolve(__dirname, "..");
const ROOT = path.resolve(DESKTOP, "..");
const FONT = path.join(ROOT, "public", "fonts", "Stack_Sans_Notch", "static", "StackSansNotch-Bold.ttf");
const ICON_PNG = path.join(DESKTOP, "build", "icon.png");
const FAVICON = path.join(ROOT, "src", "app", "favicon.ico");
const RENDER = 1024;
const ICO_SIZES = [16, 32, 48, 64, 128, 256];

const buildHtml = (fontBase64) => `<!doctype html><meta charset="utf-8"><style>
  @font-face {
    font-family: "Stack Sans Notch";
    src: url("data:font/ttf;base64,${fontBase64}") format("truetype");
    font-weight: 700;
  }
  html, body { margin: 0; padding: 0; background: transparent; }
  body { width: 100vw; height: 100vh; display: grid; place-items: center; }
  .tile {
    width: 84vmin; height: 84vmin;
    border-radius: 18.5vmin;              /* macOS-style squircle-ish corner */
    background: #181818;
    display: grid; place-items: center;
    box-shadow: inset 0 0 0 0.8vmin #2a2a2a;
  }
  .b {
    font-family: "Stack Sans Notch", system-ui, sans-serif;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 64vmin;
    line-height: 1;
    color: #b84f30;
    /* optical centering: the glyph's side bearings are not symmetric */
    transform: translate(0.2vmin, 0.4vmin);
  }
</style><div class="tile"><span class="b">B</span></div>`;

function icoFrom(pngs) {
  // ICO container: 6-byte header + 16 bytes per entry + the PNG payloads.
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + pngs.length * 16;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  if (!fs.existsSync(FONT)) {
    console.error(`No encuentro la fuente: ${FONT}`);
    app.exit(1);
    return;
  }

  const win = new BrowserWindow({
    width: RENDER,
    height: RENDER,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: { offscreen: true, sandbox: false },
  });

  const page = path.join(DESKTOP, "build", ".icon-render.html");
  fs.writeFileSync(page, buildHtml(fs.readFileSync(FONT).toString("base64")));
  await win.loadFile(page);
  const fontOk = await win.webContents.executeJavaScript(
    'document.fonts.ready.then(() => document.fonts.check(\'700 100px "Stack Sans Notch"\'))'
  );
  if (!fontOk) {
    console.error("La fuente Stack Sans Notch no se cargó; abortando para no generar un icono con otra tipografía.");
    app.exit(1);
    return;
  }
  await new Promise((r) => setTimeout(r, 400)); // let the first offscreen frame settle

  let shot = await win.webContents.capturePage();
  if (shot.isEmpty()) {
    console.error("La captura salió vacía.");
    app.exit(1);
    return;
  }
  shot = shot.resize({ width: RENDER, height: RENDER, quality: "best" });

  fs.mkdirSync(path.dirname(ICON_PNG), { recursive: true });
  fs.writeFileSync(ICON_PNG, shot.toPNG());

  const pngs = ICO_SIZES.map((size) => ({
    size,
    data: shot.resize({ width: size, height: size, quality: "best" }).toPNG(),
  }));
  fs.writeFileSync(FAVICON, icoFrom(pngs));

  const { width, height } = shot.getSize();
  console.log(`✓ ${path.relative(ROOT, ICON_PNG)} (${width}x${height})`);
  console.log(`✓ ${path.relative(ROOT, FAVICON)} (${ICO_SIZES.join(", ")})`);
  fs.rmSync(page, { force: true });
  win.destroy();
  app.exit(0);
});
