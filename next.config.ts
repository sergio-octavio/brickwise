import type { NextConfig } from "next";

// Pin the workspace root to the current directory. Without it, running via `npx`
// (which nests the package under ~/.npm/_npx/<hash>/ with its own lockfile) makes
// Next pick the wrong root and Turbopack fails to build /page. The launcher and the
// npm scripts always run from the app directory, so process.cwd() is the app root.
const root = process.cwd();

const nextConfig: NextConfig = {
  turbopack: { root },
  outputFileTracingRoot: root,
  // Desktop packaging only: desktop/scripts/prepare-server.mjs sets BRICKWISE_DESKTOP=1
  // to get a self-contained .next/standalone server. Inert for dev, npx and `next start`.
  output: process.env.BRICKWISE_DESKTOP ? "standalone" : undefined,
};

export default nextConfig;
