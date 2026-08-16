import { access, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.join(process.cwd(), ".next", "standalone");
const required = ["server.js", "package.json"];
const forbidden = [
  ".data",
  ".agents",
  ".codex",
  ".env",
  ".env.local",
  "AGENTS.md",
  "design-qa.md",
  "docs",
  "services",
  "tests",
];

for (const relative of required) {
  try { await access(path.join(root, relative)); }
  catch { throw new Error(`The standalone build does not contain ${relative}.`); }
}

for (const relative of forbidden) {
  try {
    await access(path.join(root, relative));
    throw new Error(`The standalone build contains a forbidden internal artifact: ${relative}.`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

const sourceRoot = path.join(root, "src");
try {
  const pending = [sourceRoot];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (/\.test\.[cm]?[jt]sx?$/.test(entry.name)) throw new Error(`The standalone build contains a development test: ${path.relative(root, target)}.`);
    }
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

console.log("Standalone verified: minimal runtime without data or internal configuration.");
