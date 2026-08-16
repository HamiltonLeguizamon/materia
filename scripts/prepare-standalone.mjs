import { cp, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("next/package.json"));
const source = path.dirname(nextRequire.resolve("@swc/helpers/package.json"));
const tracedLink = path.join(
  process.cwd(),
  ".next",
  "standalone",
  "node_modules",
  ".pnpm",
  "node_modules",
  "@swc",
  "helpers",
);
const target = await realpath(tracedLink);

// Next.js 16.3 can trace only the CommonJS helpers used while building and omit
// ESM helpers required when the standalone server boots in a clean container.
// Copy the complete installed package into the already traced package location.
await cp(source, target, { recursive: true, force: true });

console.log("Standalone prepared with the complete @swc/helpers runtime package.");
