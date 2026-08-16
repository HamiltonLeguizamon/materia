import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FileAudioAdmissionCoordinator } from "@/adapters/persistence/file-audio-admission-coordinator";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))); });

describe("file audio admission coordinator", () => {
  it("reserves a lesson across instances and releases it idempotently", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-audio-admission-")); roots.push(root);
    const lessonId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const first = await new FileAudioAdmissionCoordinator(root).acquire([lessonId]);

    await expect(new FileAudioAdmissionCoordinator(root).acquire([lessonId])).rejects.toThrow(/audio operation is already active/);
    await first.release();
    await first.release();

    const next = await new FileAudioAdmissionCoordinator(root).acquire([lessonId]);
    await next.release();
  });
});
