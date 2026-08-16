import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 25 }))); });

describe("standalone production launcher", () => {
  it("prepares assets and uses loopback and port 3210 by default", async () => {
    const root = await createFakeBuild();
    const output = await runLauncher(root);

    expect(JSON.parse(output)).toEqual({ hostname: "127.0.0.1", port: "3210", dataRoot: path.join(root, ".data"), staticAsset: "asset", publicAsset: "public" });
  });

  it("only opens remote binding when the operator configures it", async () => {
    const root = await createFakeBuild();
    const output = await runLauncher(root, { MATERIA_BIND_ADDRESS: "0.0.0.0", PORT: "33210" });

    expect(JSON.parse(output)).toMatchObject({ hostname: "0.0.0.0", port: "33210", dataRoot: path.join(root, ".data") });
  });

  it("preserves an absolute data path configured by the operator", async () => {
    const root = await createFakeBuild();
    const configured = path.join(root, "operator-data");
    const output = await runLauncher(root, { MATERIA_DATA_DIR: configured });

    expect(JSON.parse(output)).toMatchObject({ dataRoot: configured });
  });

  it("ignores unrelated variables and uses only Materia configuration", async () => {
    const root = await createFakeBuild();
    const legacy = path.join(root, "legacy-data");
    const canonical = path.join(root, "materia-data");
    const unrecognizedOutput = await runLauncher(root, { LEGACY_BIND_ADDRESS: "0.0.0.0", LEGACY_DATA_DIR: legacy });
    const canonicalOutput = await runLauncher(root, { MATERIA_BIND_ADDRESS: "127.0.0.2", MATERIA_DATA_DIR: canonical, LEGACY_BIND_ADDRESS: "0.0.0.0", LEGACY_DATA_DIR: legacy });

    expect(JSON.parse(unrecognizedOutput)).toMatchObject({ hostname: "127.0.0.1", dataRoot: path.join(root, ".data") });
    expect(JSON.parse(canonicalOutput)).toMatchObject({ hostname: "127.0.0.2", dataRoot: canonical });
  });

  it("loads local configuration from the repository root", async () => {
    const root = await createFakeBuild();
    await writeFile(path.join(root, ".env.local"), "MATERIA_TEST_SETTING=from-project-env\n", "utf8");
    const output = await runLauncher(root);

    expect(JSON.parse(output)).toMatchObject({ projectSetting: "from-project-env" });
  });
});

async function createFakeBuild(): Promise<string> {
  // macOS exposes its temporary directory through /var while child-process
  // cwd resolution returns the canonical /private/var path. Keep one physical
  // identity throughout the fixture so path assertions remain strict.
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "materia-standalone-")));
  roots.push(root);
  await mkdir(path.join(root, ".next", "standalone"), { recursive: true });
  await mkdir(path.join(root, ".next", "static"), { recursive: true });
  await mkdir(path.join(root, "public"), { recursive: true });
  await writeFile(path.join(root, ".next", "static", "asset.txt"), "asset", "utf8");
  await writeFile(path.join(root, "public", "asset.txt"), "public", "utf8");
  await writeFile(path.join(root, ".next", "standalone", "server.js"), `
    const { readFileSync } = require("node:fs");
    const { join } = require("node:path");
    process.stdout.write(JSON.stringify({
      hostname: process.env.HOSTNAME,
      port: process.env.PORT,
      dataRoot: process.env.MATERIA_DATA_DIR,
      projectSetting: process.env.MATERIA_TEST_SETTING,
      staticAsset: readFileSync(join(__dirname, ".next", "static", "asset.txt"), "utf8"),
      publicAsset: readFileSync(join(__dirname, "public", "asset.txt"), "utf8"),
    }));
  `, "utf8");
  return root;
}

async function runLauncher(root: string, env: Record<string, string> = {}): Promise<string> {
  const launcher = path.join(process.cwd(), "scripts", "start-standalone.mjs");
  const childEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "test", PATH: process.env.PATH || "", ...env };
  const output = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(process.execPath, [launcher], { cwd: root, env: childEnv }, (error, stdout, stderr) => {
      if (error) { reject(error); return; }
      resolve({ stdout, stderr });
    });
  });
  expect(output.stderr).toBe("");
  return output.stdout;
}
