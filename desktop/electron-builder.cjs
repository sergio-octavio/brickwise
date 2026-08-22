"use strict";
/**
 * electron-builder config. Run through `npm run dist:mac` / `dist:win`, which first
 * stage the server, the bundled Node and the per-platform better-sqlite3 binary
 * (see scripts/prepare-server.mjs).
 *
 * Signing is automatic: with a "Developer ID Application" certificate in the keychain
 * (plus APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID for notarization) it signs
 * for distribution; without one it falls back to ad-hoc signing, which is what makes an
 * arm64 app launch at all. See README.md.
 */
const { execSync } = require("node:child_process");
const { version } = require("../package.json");

const hasDevId =
  !!process.env.CSC_LINK ||
  (() => {
    if (process.platform !== "darwin") return false;
    try {
      return /Developer ID Application/.test(
        execSync("security find-identity -v -p codesigning", { stdio: ["ignore", "pipe", "ignore"] }).toString()
      );
    } catch {
      return false;
    }
  })();

const notarizeEnv = ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"];
const canNotarize = hasDevId && notarizeEnv.every((k) => process.env[k]);

console.log(
  `[brickwise] versión ${version} · firma macOS: ${
    hasDevId ? (canNotarize ? "Developer ID + notarización" : "Developer ID (sin notarizar)") : "ad-hoc"
  }`
);

const macSigning = hasDevId
  ? {
      hardenedRuntime: true,
      entitlements: "build/entitlements.mac.plist",
      entitlementsInherit: "build/entitlements.mac.plist",
      notarize: canNotarize,
    }
  : { identity: "-", hardenedRuntime: false };

module.exports = {
  appId: "com.eljommys.brickwise",
  productName: "Brickwise",
  extraMetadata: { version },
  directories: { output: "dist", buildResources: "build" },
  files: ["main.js"],
  asar: true,
  npmRebuild: false,
  nodeGypRebuild: false,
  buildDependenciesFromSource: false,
  electronLanguages: ["en", "es"],
  artifactName: "${productName}-${version}-${os}-${arch}.${ext}",
  // Only the wrapper goes through extraResources; the server tree and the Node runtime are
  // copied by afterPack, because electron-builder strips node_modules from extra-file copies.
  extraResources: [{ from: "server-host.cjs", to: "server-host.cjs" }],
  afterPack: "./scripts/after-pack.cjs",
  mac: {
    target: [
      { target: "dmg", arch: ["arm64"] },
      { target: "zip", arch: ["arm64"] },
    ],
    category: "public.app-category.finance",
    darkModeSupport: true,
    gatekeeperAssess: false,
    ...macSigning,
  },
  dmg: { sign: false },
  win: { target: [{ target: "nsis", arch: ["x64"] }] },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    createDesktopShortcut: true,
    shortcutName: "Brickwise",
    artifactName: "${productName}-${version}-${os}-${arch}-setup.${ext}",
  },
  publish: null,
};
