#!/usr/bin/env node
/**
 * Stages everything the desktop app ships:
 *
 *   stage/server/                 Next.js standalone server (+ .next/static + public)
 *   stage/node/<os>-<arch>/       official Node.js runtime that runs it
 *   stage/native/<os>-<arch>/     better-sqlite3 prebuild matching that Node's ABI
 *
 * Why a bundled Node instead of Electron itself: better-sqlite3 publishes no prebuild for
 * Electron's ABI, and this machine cannot compile one for Windows. Node 24 (ABI 137) has
 * prebuilds for both targets, so nothing is ever compiled here.
 *
 * Flags: --skip-build (reuse .next), --skip-sanity, --targets mac-arm64,win-x64
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(DESKTOP, "..");
const STAGE = path.join(DESKTOP, "stage");
const CACHE = path.join(STAGE, "cache");

const NODE_VERSION = "24.19.0"; // LTS line; keep in sync with NODE_ABI
const NODE_ABI = "137";
const BSQ_RELEASE = "better-sqlite3";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const argValue = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

const ALL_TARGETS = [
  {
    key: "mac-arm64", // electron-builder macro naming: ${os}-${arch}
    nodeArchive: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
    nodeDir: `node-v${NODE_VERSION}-darwin-arm64`,
    nodeBin: "node",
    prebuild: "darwin-arm64",
    expectNode: "Mach-O 64-bit executable arm64",
    expectNative: "Mach-O 64-bit bundle arm64",
  },
  {
    key: "win-x64",
    nodeArchive: `node-v${NODE_VERSION}-win-x64.zip`,
    nodeDir: `node-v${NODE_VERSION}-win-x64`,
    nodeBin: "node.exe",
    prebuild: "win32-x64",
    expectNode: "PE32+ executable",
    expectNative: "PE32+ executable",
  },
];

const wanted = argValue("--targets")?.split(",").map((s) => s.trim());
const TARGETS = wanted ? ALL_TARGETS.filter((t) => wanted.includes(t.key)) : ALL_TARGETS;
if (!TARGETS.length) fail(`--targets sin coincidencias. Válidos: ${ALL_TARGETS.map((t) => t.key).join(", ")}`);

function step(msg) {
  process.stdout.write(`\n\x1b[1m\x1b[34m▸ ${msg}\x1b[0m\n`);
}
function info(msg) {
  process.stdout.write(`  ${msg}\n`);
}
function fail(msg) {
  process.stderr.write(`\n\x1b[31m✖ ${msg}\x1b[0m\n`);
  process.exit(1);
}
const exists = (p) => fs.access(p).then(() => true, () => false);
async function du(p) {
  try {
    return execFileSync("du", ["-sh", p]).toString().split("\t")[0].trim();
  } catch {
    return "?";
  }
}
const fileType = (p) => {
  try {
    return execFileSync("file", ["-b", p]).toString().trim();
  } catch {
    return "";
  }
};

// ---- 1. build -------------------------------------------------------------
async function buildNext() {
  if (has("--skip-build")) {
    info("--skip-build: reutilizando .next existente");
  } else {
    step("Construyendo la app (next build, output standalone)…");
    const r = spawnSync("npm", ["run", "build"], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, BRICKWISE_DESKTOP: "1", NEXT_TELEMETRY_DISABLED: "1" },
    });
    if (r.status !== 0) fail("next build falló.");
  }
  if (!(await exists(path.join(ROOT, ".next", "standalone", "server.js")))) {
    fail(
      "No hay .next/standalone/server.js.\n" +
        "  Comprueba que next.config.ts tiene: output: process.env.BRICKWISE_DESKTOP ? \"standalone\" : undefined"
    );
  }
}

// ---- 2. assemble the server ----------------------------------------------
const HOST_NATIVE = path.join("node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node");

async function assembleServer() {
  step("Ensamblando stage/server…");
  const dst = path.join(STAGE, "server");
  await fs.rm(dst, { recursive: true, force: true });
  await fs.mkdir(dst, { recursive: true });

  // standalone/ + the two folders next build deliberately leaves out (never .next/cache).
  await fs.cp(path.join(ROOT, ".next", "standalone"), dst, { recursive: true });
  await fs.cp(path.join(ROOT, ".next", "static"), path.join(dst, ".next", "static"), { recursive: true });
  await fs.cp(path.join(ROOT, "public"), path.join(dst, "public"), { recursive: true });

  // The traced binary belongs to this machine's Node (ABI 141) — useless for Node 24.
  // stage/server stays platform-neutral; stage/pkg/<target>/server gets the right one.
  await fs.rm(path.join(dst, HOST_NATIVE), { force: true });

  // Build-time only, dragged in by tracing.
  for (const dead of ["node_modules/sharp", "node_modules/@img", "node_modules/@next/swc-darwin-arm64"]) {
    await fs.rm(path.join(dst, dead), { recursive: true, force: true });
  }

  // Next's tracer picks up the legacy ./brickwise.db sitting next to the sources. Shipping it
  // would leak this machine's data and, worse, a fresh install would copy it into the new
  // user's ~/.brickwise (src/lib/db.ts migrates a cwd-local DB when the home one is missing).
  const stray = [];
  for (const e of await fs.readdir(dst, { withFileTypes: true })) {
    if (e.isDirectory()) continue;
    if (/\.(db|db-wal|db-shm|sqlite|sqlite3|env|pem|log)$/i.test(e.name) || e.name.startsWith(".env")) {
      await fs.rm(path.join(dst, e.name), { force: true });
      stray.push(e.name);
    }
  }
  if (stray.length) info(`descartado del paquete (datos locales): ${stray.join(", ")}`);
  const allowed = new Set(["server.js", "package.json"]);
  const unexpected = (await fs.readdir(dst, { withFileTypes: true }))
    .filter((e) => !e.isDirectory() && !allowed.has(e.name))
    .map((e) => e.name);
  if (unexpected.length) info(`\x1b[33m! revisa estos archivos sueltos en stage/server: ${unexpected.join(", ")}\x1b[0m`);

  for (const must of ["server.js", ".next/static", "public/fonts", "node_modules/next/package.json", "node_modules/better-sqlite3/lib/database.js"]) {
    if (!(await exists(path.join(dst, must)))) fail(`stage/server incompleto: falta ${must}`);
  }

  // Windows has a 260-char path limit for some tooling; surface the worst case now.
  let longest = "";
  const walk = async (dir) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const rel = path.relative(dst, p);
      if (rel.length > longest.length) longest = rel;
      if (e.isDirectory()) await walk(p);
    }
  };
  await walk(dst);
  info(`tamaño ${await du(dst)} · ruta más larga ${longest.length} caracteres`);
}

// ---- 3. downloads ---------------------------------------------------------
async function download(url, dest) {
  if (await exists(dest)) return dest;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  info(`descargando ${path.basename(dest)}…`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) fail(`HTTP ${res.status} en ${url}`);
  const part = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
  await fs.rename(part, dest);
  return dest;
}

async function sha256(file) {
  const h = createHash("sha256");
  await pipeline((await fs.open(file)).createReadStream(), h);
  return h.digest("hex");
}

async function nodeChecksums() {
  const file = path.join(CACHE, `SHASUMS256-${NODE_VERSION}.txt`);
  await download(`https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`, file);
  const map = new Map();
  for (const line of (await fs.readFile(file, "utf8")).split("\n")) {
    const [hash, name] = line.trim().split(/\s+/);
    if (hash && name) map.set(name, hash);
  }
  return map;
}

async function fetchNode(target, sums) {
  const archive = path.join(CACHE, target.nodeArchive);
  await download(`https://nodejs.org/dist/v${NODE_VERSION}/${target.nodeArchive}`, archive);
  const expected = sums.get(target.nodeArchive);
  if (!expected) fail(`SHASUMS256.txt no incluye ${target.nodeArchive}`);
  const actual = await sha256(archive);
  if (actual !== expected) {
    await fs.rm(archive, { force: true });
    fail(`sha256 no coincide para ${target.nodeArchive} (borrado; reintenta)`);
  }
  info(`sha256 OK · ${target.nodeArchive}`);

  const out = path.join(STAGE, "node", target.key);
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });
  if (target.nodeArchive.endsWith(".zip")) {
    execFileSync("unzip", ["-o", "-q", "-j", archive, `${target.nodeDir}/${target.nodeBin}`, `${target.nodeDir}/LICENSE`, "-d", out]);
  } else {
    execFileSync("tar", ["-xzf", archive, "-C", out, "--strip-components=2", `${target.nodeDir}/bin/node`]);
    execFileSync("tar", ["-xzf", archive, "-C", out, "--strip-components=1", `${target.nodeDir}/LICENSE`]);
  }
  const bin = path.join(out, target.nodeBin);
  await fs.chmod(bin, 0o755);
  const type = fileType(bin);
  if (!type.includes(target.expectNode)) fail(`${bin} no parece ${target.expectNode}: ${type}`);
  info(`node ${NODE_VERSION} → stage/node/${target.key}/${target.nodeBin} (${type.split(",")[0]})`);
}

async function fetchNative(target, version) {
  const name = `${BSQ_RELEASE}-v${version}-node-v${NODE_ABI}-${target.prebuild}.tar.gz`;
  const archive = path.join(CACHE, name);
  await download(`https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/${name}`, archive);
  const out = path.join(STAGE, "native", target.key);
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });
  execFileSync("tar", ["-xzf", archive, "-C", out, "--strip-components=2", "build/Release/better_sqlite3.node"]);
  const bin = path.join(out, "better_sqlite3.node");
  const type = fileType(bin);
  if (!type.includes(target.expectNative)) fail(`${bin} no parece ${target.expectNative}: ${type}`);
  info(`better-sqlite3 ${version} (ABI ${NODE_ABI}) → stage/native/${target.key} · sha256 ${(await sha256(archive)).slice(0, 16)}…`);
}

// ---- 4. sanity check ------------------------------------------------------
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

const ping = (url) =>
  new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("timeout", () => (req.destroy(), resolve(0)));
    req.on("error", () => resolve(0));
  });

async function sanity(target) {
  step("Comprobando que el servidor arranca con el Node embebido…");
  const nodeBin = path.join(STAGE, "node", target.key, target.nodeBin);
  const abi = execFileSync(nodeBin, ["-p", "process.versions.modules"]).toString().trim();
  if (abi !== NODE_ABI) fail(`El Node embebido reporta ABI ${abi}, pero los prebuilds son ABI ${NODE_ABI}.`);
  info(`ABI ${abi} ✓`);

  const resolved = execFileSync(nodeBin, ["-p", "require.resolve('better-sqlite3')"], {
    cwd: path.join(STAGE, "pkg", target.key, "server"),
  }).toString().trim();
  if (!resolved.startsWith(path.join(STAGE, "pkg", target.key))) {
    fail(`better-sqlite3 se resuelve fuera del paquete (${resolved}). El árbol de node_modules está incompleto.`);
  }
  info(`better-sqlite3 resuelto dentro del paquete ✓`);

  const port = await findFreePort(41890);
  const tmpDb = path.join(CACHE, "sanity.db"); // never touch the user's ~/.brickwise
  await Promise.all([".", "-wal", "-shm"].map((s) => fs.rm(s === "." ? tmpDb : tmpDb + s, { force: true })));

  const serverDir = path.join(STAGE, "pkg", target.key, "server");
  const child = spawn(nodeBin, [path.join(DESKTOP, "server-host.cjs"), path.join(serverDir, "server.js")], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      BRICKWISE_DB: tmpDb,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));

  const deadline = Date.now() + 30_000;
  let ok = false;
  while (Date.now() < deadline) {
    const [settings, home] = [await ping(`http://127.0.0.1:${port}/api/settings`), await ping(`http://127.0.0.1:${port}/`)];
    if (settings === 200 && home === 200) {
      ok = true;
      info(`GET /api/settings 200 · GET / 200 (puerto ${port})`);
      break;
    }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  child.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 400));
  await Promise.all([tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`].map((p) => fs.rm(p, { force: true })));
  if (!ok) fail(`El servidor no respondió:\n${out.slice(-3000)}`);
}

// ---- main -----------------------------------------------------------------
const bsqVersion = JSON.parse(await fs.readFile(path.join(ROOT, "node_modules", "better-sqlite3", "package.json"), "utf8")).version;

await buildNext();
await assembleServer();

step(`Descargando runtimes (node ${NODE_VERSION} · better-sqlite3 ${bsqVersion} ABI ${NODE_ABI})…`);
const sums = await nodeChecksums();
for (const target of TARGETS) {
  info(`— ${target.key}`);
  await fetchNode(target, sums);
  await fetchNative(target, bsqVersion);
}

// One ready-to-ship server tree per target: the same base plus its own native binary.
// electron-builder then copies a single directory (stage/pkg/${os}-${arch}/server), with no
// per-file filters and no two copy jobs racing over the same path.
step("Montando el servidor por plataforma…");
for (const target of TARGETS) {
  const out = path.join(STAGE, "pkg", target.key, "server");
  await fs.rm(path.join(STAGE, "pkg", target.key), { recursive: true, force: true });
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.cp(path.join(STAGE, "server"), out, { recursive: true });
  await fs.mkdir(path.dirname(path.join(out, HOST_NATIVE)), { recursive: true });
  await fs.copyFile(path.join(STAGE, "native", target.key, "better_sqlite3.node"), path.join(out, HOST_NATIVE));

  // Node must be able to resolve better-sqlite3 from inside this tree; if its JS is missing it
  // silently climbs to an outer node_modules on the build machine and breaks everywhere else.
  for (const must of ["node_modules/better-sqlite3/lib/index.js", "node_modules/better-sqlite3/package.json", "node_modules/bindings/bindings.js", "node_modules/next/package.json"]) {
    if (!(await exists(path.join(out, must)))) fail(`stage/pkg/${target.key}/server incompleto: falta ${must}`);
  }
  const type = fileType(path.join(out, HOST_NATIVE));
  if (!type.includes(target.expectNative)) fail(`binario nativo equivocado en ${target.key}: ${type}`);
  info(`${target.key}: ${(await fs.readdir(out, { recursive: true })).length} archivos · ${await du(out)}`);
}

const macTarget = TARGETS.find((t) => t.key === "mac-arm64");
if (macTarget && !has("--skip-sanity") && process.platform === "darwin") await sanity(macTarget);

step("Listo");
for (const t of TARGETS) info(`${t.key}: node ${await du(path.join(STAGE, "node", t.key))} · servidor ${await du(path.join(STAGE, "pkg", t.key, "server"))}`);
