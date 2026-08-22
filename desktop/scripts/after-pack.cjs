"use strict";
/**
 * Copies the platform's server tree and its Node runtime into the packaged app.
 *
 * electron-builder cannot do this through `extraResources`: it strips `node_modules` from
 * every extra-file copy, which silently produced an app whose better-sqlite3 had no JS and
 * fell back to the build machine's node_modules. Doing it here is explicit and verified,
 * and it runs before signing, so both Mach-O binaries get signed with the app.
 */
const fs = require("node:fs");
const path = require("node:path");

const ARCH = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64" };

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    else n += 1;
  }
  return n;
}

exports.default = async function afterPack(context) {
  const desktop = path.resolve(__dirname, "..");
  const os = context.electronPlatformName === "darwin" ? "mac" : "win";
  const arch = ARCH[context.arch] ?? String(context.arch);
  const key = `${os}-${arch}`;

  const resources =
    context.electronPlatformName === "darwin"
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(context.appOutDir, "resources");

  const jobs = [
    { from: path.join(desktop, "stage", "pkg", key, "server"), to: path.join(resources, "server") },
    { from: path.join(desktop, "stage", "node", key), to: path.join(resources, "node") },
  ];

  for (const { from, to } of jobs) {
    if (!fs.existsSync(from)) {
      throw new Error(`Falta ${path.relative(desktop, from)}. Ejecuta: npm run prepare-server`);
    }
    fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(from, to, { recursive: true, verbatimSymlinks: false });
    const expected = countFiles(from);
    const got = countFiles(to);
    if (expected !== got) throw new Error(`Copia incompleta de ${path.basename(to)}: ${got}/${expected} archivos`);
    console.log(`  • copiado ${path.basename(to)} (${got} archivos) → ${path.relative(context.appOutDir, to)}`);
  }

  const nodeBin = path.join(resources, "node", os === "win" ? "node.exe" : "node");
  fs.chmodSync(nodeBin, 0o755);

  // The server must be self-contained: if its node_modules is incomplete, Node climbs out of
  // the bundle on this machine and the app only works here.
  for (const must of [
    "server.js",
    "node_modules/next/package.json",
    "node_modules/better-sqlite3/lib/index.js",
    "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    "node_modules/bindings/bindings.js",
    ".next/static",
    "public",
  ]) {
    if (!fs.existsSync(path.join(resources, "server", must))) {
      throw new Error(`El servidor empaquetado está incompleto: falta ${must}`);
    }
  }
};
