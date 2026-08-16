import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";

for (const filename of [".env.local", ".env"]) {
  const envPath = path.join(process.cwd(), filename);
  if (existsSync(envPath)) loadEnvFile(envPath);
}
void import("@/mcp/stdio-runtime").catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
