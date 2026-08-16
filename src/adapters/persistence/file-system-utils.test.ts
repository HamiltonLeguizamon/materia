import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeDurable, syncDirectory, writeDurableJson } from "@/adapters/persistence/file-system-utils";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 25 })));
});

describe("durable file-system operations", () => {
  it("writes and removes JSON through the durable path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "materia-fs-utils-"));
    roots.push(root);
    const destination = path.join(root, "nested", "record.json");

    await writeDurableJson(destination, { state: "ready" });
    expect(JSON.parse(await readFile(destination, "utf8"))).toEqual({ state: "ready" });

    await removeDurable(destination);
    await expect(readFile(destination, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not open or fsync a directory on Windows", async () => {
    await expect(syncDirectory(path.join(os.tmpdir(), "missing-materia-directory"), "win32")).resolves.toBeUndefined();
  });

  it("preserves directory fsync errors on POSIX platforms", async () => {
    await expect(syncDirectory(path.join(os.tmpdir(), "missing-materia-directory"), "linux")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
