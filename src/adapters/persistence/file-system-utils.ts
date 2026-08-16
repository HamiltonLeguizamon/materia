import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const LOCK_LEASE_MS = 30_000;

export async function writeDurableJson(destination: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, destination);
  await syncDirectory(path.dirname(destination));
}

export async function removeDurable(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
  await syncDirectory(path.dirname(filePath));
}

export async function syncDirectory(
  directoryPath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  // Windows does not support fsync on directory handles. The file itself is
  // flushed before the atomic rename; POSIX systems additionally flush the
  // parent directory so the rename is durable across a crash.
  if (platform === "win32") return;
  const directory = await open(directoryPath, "r");
  try { await directory.sync(); } finally { await directory.close(); }
}

export async function withFileLease<T>(root: string, name: string, action: () => Promise<T>): Promise<T> {
  const release = await acquireFileLease(root, name);
  try { return await action(); }
  finally { await release(); }
}

export async function acquireFileLease(root: string, name: string, attempts = 120): Promise<() => Promise<void>> {
  const lockDirectory = path.join(root, ".locks");
  const lockPath = path.join(lockDirectory, name);
  const ownerPath = path.join(lockPath, "owner.json");
  await mkdir(lockDirectory, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await isAbandoned(lockPath, ownerPath)) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
      continue;
    }
    try { await writeDurableJson(ownerPath, { pid: process.pid, acquiredAt: new Date().toISOString() }); }
    catch (error) { await rm(lockPath, { recursive: true, force: true }); throw error; }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await rm(lockPath, { recursive: true, force: true });
    };
  }
  throw new Error("The resource is busy with another operation. Try again.");
}

async function isAbandoned(lockPath: string, ownerPath: string): Promise<boolean> {
  let age: number;
  try { age = Date.now() - (await stat(lockPath)).mtimeMs; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT"; }
  if (age <= LOCK_LEASE_MS) return false;
  try {
    const handle = await open(ownerPath, "r");
    let owner: { pid?: unknown };
    try { owner = JSON.parse(await handle.readFile("utf8")) as { pid?: unknown }; }
    finally { await handle.close(); }
    return typeof owner.pid !== "number" || !isProcessAlive(owner.pid);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    return true;
  }
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
