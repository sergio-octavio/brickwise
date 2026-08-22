"use strict";
// Runs inside the bundled Node.js:  node server-host.cjs <absolute path to server.js>
//
// 1) Parent-death watchdog. Electron holds our stdin pipe open; if Electron dies for any
//    reason (crash, SIGKILL, force-quit) the pipe closes and we exit, so no orphan server
//    keeps running. Works the same on macOS and Windows.
// 2) Hands over to Next's generated standalone server.js, which chdir()s into its own
//    folder and resolves `next` relative to itself, so requiring it here is equivalent to
//    running it directly.
const path = require("node:path");

for (const k of ["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"]) delete process.env[k];

const bye = () => process.exit(0);
process.stdin.on("end", bye);
process.stdin.on("close", bye);
process.stdin.on("error", bye);
process.stdin.resume();

const server = process.argv[2];
if (!server) {
  console.error("usage: node server-host.cjs <server.js>");
  process.exit(2);
}
require(path.resolve(server));
