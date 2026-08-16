import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  FileAudioBatchJobRepository,
  FileAudioJobRepository,
  FileOperationRepository,
  supportsLegacyOperationFilename,
} from "@/adapters/persistence/file-course-repository";
import type { AudioBatchJob, AudioJob, SpeechProfile } from "@/application/ports";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))); });

const profile: SpeechProfile = {
  provider: "qwen",
  nodeId: "test-node",
  voice: "profile-c",
  speed: 1,
  language: "es",
  style: "serious",
  pronunciation: "literal",
};

describe("file recovery contract", () => {
  it("keeps a recent equivalent claim active", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-operation-active-")); roots.push(root);
    const operations = new FileOperationRepository(root);
    await expect(operations.claim({ operationId: "recent-operation", kind: "test", fingerprint: "same" })).resolves.toEqual({ state: "claimed" });
    await expect(new FileOperationRepository(root).claim({ operationId: "recent-operation", kind: "test", fingerprint: "same" })).resolves.toEqual({ state: "running" });
  });

  it("recovers an abandoned claim using an expired lease", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-operation-stale-")); roots.push(root);
    const operations = new FileOperationRepository(root);
    await operations.claim({ operationId: "stale-operation", kind: "test", fingerprint: "same" });
    const [recordName] = await readdir(path.join(root, "operations"));
    const recordPath = path.join(root, "operations", recordName);
    const record = JSON.parse(await readFile(recordPath, "utf8")) as Record<string, unknown>;
    await writeFile(recordPath, `${JSON.stringify({ ...record, startedAt: "2026-08-14T00:00:00.000Z", leaseExpiresAt: "2026-08-14T00:00:30.000Z", ownerPid: 2_147_483_647 }, null, 2)}\n`);

    await expect(new FileOperationRepository(root).claim({ operationId: "stale-operation", kind: "test", fingerprint: "same" })).resolves.toEqual({ state: "claimed" });
  });

  it("persists colon-containing IDs under portable names and preserves idempotency", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-operation-portable-")); roots.push(root);
    const operationId = "batch:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:lesson:0";
    const operations = new FileOperationRepository(root);

    await expect(operations.claim({ operationId, kind: "generate-audio", fingerprint: "same" })).resolves.toEqual({ state: "claimed" });
    await operations.complete(operationId, { state: "completed" });

    const names = await readdir(path.join(root, "operations"));
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^[a-f0-9]{64}\.json$/);
    expect(names[0]).not.toContain(":");
    await expect(new FileOperationRepository(root).claim({ operationId, kind: "generate-audio", fingerprint: "same" })).resolves.toEqual({ state: "completed", result: { state: "completed" } });
  });

  it("reuses and updates legacy records named with operationId", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-operation-legacy-")); roots.push(root);
    const directory = path.join(root, "operations");
    const operationId = "legacy-operation";
    const legacyPath = path.join(directory, `${operationId}.json`);
    await mkdir(directory, { recursive: true });
    await writeFile(legacyPath, `${JSON.stringify({ schemaVersion: 1, operationId, kind: "test", fingerprint: "same", status: "running", startedAt: new Date().toISOString(), completedAt: null, result: null, ownerPid: process.pid, runtimeId: "11111111-1111-4111-8111-111111111111", leaseExpiresAt: new Date(Date.now() + 30_000).toISOString() }, null, 2)}\n`);

    const operations = new FileOperationRepository(root, "win32");
    await expect(operations.claim({ operationId, kind: "test", fingerprint: "same" })).resolves.toEqual({ state: "running" });
    await expect(operations.complete(operationId, { retained: true })).resolves.toBeUndefined();

    const persisted = JSON.parse(await readFile(legacyPath, "utf8")) as { status: string; result: unknown };
    expect(persisted).toMatchObject({ status: "completed", result: { retained: true } });
    expect(await readdir(directory)).toEqual([`${operationId}.json`]);
  });

  it("limits legacy Windows reads to safe filenames", () => {
    expect(supportsLegacyOperationFilename("legacy-operation", "win32")).toBe(true);
    expect(supportsLegacyOperationFilename("batch:legacy:0", "win32")).toBe(false);
    expect(supportsLegacyOperationFilename("CON", "win32")).toBe(false);
    expect(supportsLegacyOperationFilename("com1.previous", "win32")).toBe(false);
    expect(supportsLegacyOperationFilename("batch:legacy:0", "linux")).toBe(true);
  });

  it("reclassifies a queued local job as interrupted when reopening the store", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-audio-restart-")); roots.push(root);
    const jobs = new FileAudioJobRepository(root);
    const now = "2026-08-15T00:00:00.000Z";
    const job: AudioJob = {
      schemaVersion: 1,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      operationId: "queued-local-job",
      lessonId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      expectedLessonRevision: 1,
      chapterIds: ["chapter-1"],
      provider: "openai",
      profileKey: "openai:test",
      profile: { ...profile, provider: "openai", nodeId: null, voice: "coral" },
      state: "queued",
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      error: null,
      lessonRevision: null,
    };
    await jobs.save(job);
    await markOwnerDead(path.join(root, "jobs", "audio", `${job.id}.json`));

    const reopened = await new FileAudioJobRepository(root).get(job.id);

    expect(reopened).toMatchObject({ state: "interrupted", completedAt: expect.any(String) });
  });

  it("reclassifies a running batch as interrupted when reopening the store", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-batch-restart-")); roots.push(root);
    const jobs = new FileAudioBatchJobRepository(root);
    const now = "2026-08-15T00:00:00.000Z";
    const job: AudioBatchJob = {
      schemaVersion: 1,
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      scope: "lesson",
      courseId: null,
      lessonIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
      provider: "qwen",
      profile,
      profileKey: "qwen:test",
      state: "running",
      totalChapters: 2,
      completedChapters: 1,
      currentLessonId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      currentChapterId: "chapter-2",
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      error: null,
    };
    await jobs.save(job);
    await markOwnerDead(path.join(root, "jobs", "audio-batch", `${job.id}.json`));

    const reopened = await new FileAudioBatchJobRepository(root).get(job.id);

    expect(reopened).toMatchObject({ state: "interrupted", completedAt: expect.any(String) });
  });

  it("rejects job JSON that does not match its schema instead of casting it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-invalid-job-")); roots.push(root);
    const id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const directory = path.join(root, "jobs", "audio");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${id}.json`), '{"schemaVersion":1,"id":"contenido-arbitrario"}\n');

    await expect(new FileAudioJobRepository(root).get(id)).rejects.toThrow(/invalid audio job/i);
  });

  it("keeps a remote job resumable when a validated remoteJobId exists", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-remote-resume-")); roots.push(root);
    const jobs = new FileAudioJobRepository(root);
    const now = "2026-08-15T00:00:00.000Z";
    const job: AudioJob = {
      schemaVersion: 1, id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", operationId: "remote-resume", lessonId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      expectedLessonRevision: 1, chapterIds: ["chapter-1"], provider: "qwen", profileKey: "qwen:test", profile, state: "running",
      createdAt: now, updatedAt: now, completedAt: null, error: null, lessonRevision: null,
      remoteSubmissionState: "accepted", remoteJobId: "voice-job-123", remoteChapterId: "chapter-1",
    };
    await jobs.save(job);
    await markOwnerDead(path.join(root, "jobs", "audio", `${job.id}.json`));

    await expect(new FileAudioJobRepository(root).get(job.id)).resolves.toMatchObject({ state: "running", remoteJobId: "voice-job-123" });
  });

  it("marks an accepted remote job unknown when its ID was not persisted", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-remote-unknown-")); roots.push(root);
    const jobs = new FileAudioJobRepository(root);
    const now = "2026-08-15T00:00:00.000Z";
    const job: AudioJob = {
      schemaVersion: 1, id: "ffffffff-ffff-4fff-8fff-ffffffffffff", operationId: "remote-unknown", lessonId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      expectedLessonRevision: 1, chapterIds: ["chapter-1"], provider: "qwen", profileKey: "qwen:test", profile, state: "running",
      createdAt: now, updatedAt: now, completedAt: null, error: null, lessonRevision: null,
      remoteSubmissionState: "submitting", remoteJobId: null, remoteChapterId: "chapter-1",
    };
    await jobs.save(job);
    await markOwnerDead(path.join(root, "jobs", "audio", `${job.id}.json`));

    await expect(new FileAudioJobRepository(root).get(job.id)).resolves.toMatchObject({ state: "unknown", completedAt: expect.any(String) });
  });
});

async function markOwnerDead(filePath: string): Promise<void> {
  const record = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
  await writeFile(filePath, `${JSON.stringify({ ...record, ownerPid: 2_147_483_647 }, null, 2)}\n`);
}
