import { existsSync } from "node:fs";
import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadEnvFile } from "node:process";

const projectRoot = process.cwd();
for (const filename of [".env.local", ".env"]) {
  const envPath = path.join(projectRoot, filename);
  if (existsSync(envPath)) loadEnvFile(envPath);
}
const standaloneRoot = path.join(projectRoot, ".next", "standalone");
const serverPath = path.join(standaloneRoot, "server.js");
const staticSource = path.join(projectRoot, ".next", "static");
const staticDestination = path.join(standaloneRoot, ".next", "static");
const publicSource = path.join(projectRoot, "public");
const publicDestination = path.join(standaloneRoot, "public");
const configuredDataRoot = process.env.MATERIA_DATA_DIR?.trim() || ".data";
const dataRoot = path.isAbsolute(configuredDataRoot) ? configuredDataRoot : path.resolve(projectRoot, configuredDataRoot);

await assertBuildExists();
await copyRuntimeAssets();
await runServer();

async function assertBuildExists() {
  try {
    await access(serverPath);
    await access(staticSource);
  } catch {
    throw new Error("No complete standalone build exists. Run `pnpm run build` before `pnpm run start`.");
  }
}

async function copyRuntimeAssets() {
  await mkdir(path.dirname(staticDestination), { recursive: true });
  await cp(staticSource, staticDestination, { recursive: true, force: true });
  try {
    await access(publicSource);
    await cp(publicSource, publicDestination, { recursive: true, force: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function runServer() {
  const child = spawn(process.execPath, [serverPath], {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: process.env.MATERIA_BIND_ADDRESS?.trim() || "127.0.0.1",
      PORT: process.env.PORT || "3210",
      MATERIA_DATA_DIR: dataRoot,
    },
  });
  const forward = (signal) => { if (!child.killed) child.kill(signal); };
  process.once("SIGINT", forward);
  process.once("SIGTERM", forward);
  const exit = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  process.removeListener("SIGINT", forward);
  process.removeListener("SIGTERM", forward);
  process.exitCode = exit.code ?? (exit.signal ? 0 : 1);
}
