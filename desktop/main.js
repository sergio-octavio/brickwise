"use strict";
/**
 * Brickwise desktop shell.
 *
 * Electron only draws the window. The app itself is Next.js' standalone server, run by a
 * bundled Node.js 24 as a child process, because better-sqlite3 ships no prebuild for
 * Electron's ABI. Data still lives in ~/.brickwise/brickwise.db, shared with `npx brickwise`.
 */
const { app, BrowserWindow, Menu, clipboard, dialog, nativeTheme, session, shell } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const isWin = process.platform === "win32";
const PREFERRED_PORT = 41797; // stable so the app's localStorage prefs survive restarts
const READY_TIMEOUT_MS = 45_000;
const MAX_LOG_BYTES = 5 * 1024 * 1024;

// ---- paths ---------------------------------------------------------------
// Packaged: everything sits in Contents/Resources (mac) / resources (win).
// Dev (`npm start`): read straight from desktop/stage, built by scripts/prepare-server.mjs.
const stageKey = `${process.platform === "darwin" ? "mac" : "win"}-${process.arch}`;
const paths = app.isPackaged
  ? {
      node: path.join(process.resourcesPath, "node", isWin ? "node.exe" : "node"),
      serverDir: path.join(process.resourcesPath, "server"),
      host: path.join(process.resourcesPath, "server-host.cjs"),
      icon: undefined, // baked into the executable
    }
  : {
      node: path.join(__dirname, "stage", "node", stageKey, isWin ? "node.exe" : "node"),
      serverDir: path.join(__dirname, "stage", "pkg", stageKey, "server"),
      host: path.join(__dirname, "server-host.cjs"),
      icon: path.join(__dirname, "build", "icon.png"),
    };

let win = null;
let child = null;
let logStream = null;
let logFile = "";
let origin = "";
let quitting = false;

// ---- logging -------------------------------------------------------------
function openLog() {
  try {
    const dir = app.getPath("logs");
    fs.mkdirSync(dir, { recursive: true });
    logFile = path.join(dir, "server.log");
    try {
      if (fs.statSync(logFile).size > MAX_LOG_BYTES) fs.renameSync(logFile, `${logFile}.1`);
    } catch {
      /* no previous log */
    }
    logStream = fs.createWriteStream(logFile, { flags: "a" });
  } catch {
    /* logging is best-effort */
  }
}

function log(line) {
  const msg = `[brickwise ${new Date().toISOString()}] ${line}\n`;
  process.stdout.write(msg);
  try {
    logStream?.write(msg);
  } catch {
    /* ignore */
  }
}

// ---- server --------------------------------------------------------------
function findFreePort(start) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(findFreePort(start + 1)));
    srv.listen(start, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function startServer(port) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  env.PORT = String(port);
  env.HOSTNAME = "127.0.0.1"; // never 0.0.0.0: no LAN exposure, no Windows firewall prompt
  env.NODE_ENV = "production";
  env.NEXT_TELEMETRY_DISABLED = "1";

  log(`node=${paths.node} server=${paths.serverDir} port=${port}`);
  child = spawn(paths.node, [paths.host, path.join(paths.serverDir, "server.js")], {
    cwd: paths.serverDir,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  const pipe = (stream) =>
    stream.on("data", (d) => {
      try {
        logStream?.write(d);
      } catch {
        /* ignore */
      }
      process.stdout.write(d);
    });
  pipe(child.stdout);
  pipe(child.stderr);

  child.on("error", (err) => fatal(`No se pudo arrancar el servidor local: ${err.message}`));
  child.on("exit", (code, signal) => {
    const wasRunning = child;
    child = null;
    if (!quitting && wasRunning) fatal(`El servidor local se cerró inesperadamente (code=${code} signal=${signal}).`);
  });
}

function stopServer() {
  if (!child) return;
  const proc = child;
  child = null;
  try {
    if (isWin) {
      spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
    } else {
      proc.kill("SIGTERM");
      setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }, 3000).unref();
    }
  } catch (err) {
    log(`stopServer: ${err.message}`);
  }
}

function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

async function waitForServer() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!child) return false; // died; the exit handler already reported it
    if (await ping(`${origin}/api/settings`)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// ---- window --------------------------------------------------------------
const ALLOWED_PERMISSIONS = new Set(["clipboard-read", "clipboard-sanitized-write"]);

function isAppUrl(url) {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function openExternal(url) {
  if (/^https?:/i.test(url)) shell.openExternal(url).catch((err) => log(`openExternal: ${err.message}`));
}

function applyPermissions() {
  const ses = session.defaultSession;
  // Both handlers are required for Electron to consider a permission fully handled.
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const from = details?.requestingUrl || wc?.getURL() || "";
    callback(ALLOWED_PERMISSIONS.has(permission) && isAppUrl(from));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) =>
    ALLOWED_PERMISSIONS.has(permission) && isAppUrl(requestingOrigin || "")
  );
}

function wireContextMenu(wc) {
  // Electron has no default context menu. Without this there is no way to copy the
  // `javascript:` bookmarklet, and no paste inside inputs on Windows.
  wc.on("context-menu", (_e, params) => {
    const items = [];
    if (params.linkURL) {
      items.push({
        label: "Copiar enlace",
        click: () => clipboard.writeText(params.linkURL),
      });
      if (/^https?:/i.test(params.linkURL)) {
        items.push({ label: "Abrir en el navegador", click: () => openExternal(params.linkURL) });
      }
    }
    if (params.isEditable) {
      if (items.length) items.push({ type: "separator" });
      items.push(
        { role: "cut", label: "Cortar" },
        { role: "copy", label: "Copiar" },
        { role: "paste", label: "Pegar" },
        { type: "separator" },
        { role: "selectAll", label: "Seleccionar todo" }
      );
    } else if (params.selectionText) {
      if (items.length) items.push({ type: "separator" });
      items.push({ role: "copy", label: "Copiar" });
    }
    if (!items.length) return;
    Menu.buildFromTemplate(items).popup({ window: win });
  });
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "Brickwise",
    icon: paths.icon,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#181818" : "#fafafa",
    autoHideMenuBar: isWin,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    win = null;
  });

  // Everything outside the local server (Property Finder, WhatsApp, Google Maps, OSM)
  // belongs in the user's own browser, where their sessions live.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (details) => {
    if (!isAppUrl(details.url)) {
      details.preventDefault();
      openExternal(details.url);
    }
  });
  wireContextMenu(win.webContents);

  await win.loadURL(`${origin}/`);
}

function fatal(message) {
  log(`FATAL ${message}`);
  quitting = true;
  stopServer();
  dialog.showErrorBox("Brickwise", `${message}\n\nLog: ${logFile || "(sin log)"}`);
  app.exit(1);
}

// ---- lifecycle -----------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    openLog();
    log(`Brickwise ${app.getVersion()} · electron ${process.versions.electron} · ${process.platform}-${process.arch}`);

    if (!fs.existsSync(paths.node) || !fs.existsSync(path.join(paths.serverDir, "server.js"))) {
      fatal(
        app.isPackaged
          ? "Faltan archivos internos de la aplicación. Reinstala Brickwise."
          : "Falta desktop/stage. Ejecuta primero: npm run prepare-server"
      );
      return;
    }

    const port = await findFreePort(Number(process.env.PORT) || PREFERRED_PORT);
    origin = `http://127.0.0.1:${port}`;
    applyPermissions();
    startServer(port);

    if (!(await waitForServer())) {
      if (child) fatal("El servidor local no respondió a tiempo.");
      return;
    }
    log(`listo en ${origin} · datos en ${path.join(os.homedir(), ".brickwise")}`);
    await createWindow();
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    quitting = true;
    stopServer();
  });
  process.on("exit", () => {
    try {
      child?.kill();
    } catch {
      /* ignore */
    }
  });
}
