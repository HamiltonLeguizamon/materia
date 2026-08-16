import { mkdir, open, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import { isProcessAlive, withFileLease, writeDurableJson } from "@/adapters/persistence/file-system-utils";
import type { AudioBatchJob, AudioBatchJobRepository, AudioJob, AudioJobRepository, CourseCleanupRepository, CourseProgressRepository, CourseRepository, OperationClaim, OperationRepository } from "@/application/ports";
import { materiaDataRoot } from "@/config/environment";
import { courseSchema, courseStudyProgressSchema, type Course, type CourseStudyProgress } from "@/domain/course";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const operationPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const windowsReservedNamePattern = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function assertUuid(value: string, label: string): void {
  if (!uuidPattern.test(value)) throw new Error(`Invalid ${label}.`);
}

function assertOperationId(value: string): void {
  if (!operationPattern.test(value)) throw new Error("Invalid operationId.");
}

export function supportsLegacyOperationFilename(value: string, platform: NodeJS.Platform = process.platform): boolean {
  assertOperationId(value);
  if (platform !== "win32") return true;
  return !value.includes(":") && !windowsReservedNamePattern.test(value);
}

async function readJsonOrNull(filePath: string): Promise<unknown | null> {
  try { return JSON.parse(await readFile(filePath, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export class FileCourseRepository implements CourseRepository {
  constructor(private readonly root = materiaDataRoot()) {}
  private directory() { return path.join(this.root, "courses"); }
  private coursePath(id: string) { assertUuid(id, "course ID"); return path.join(this.directory(), `${id}.json`); }
  private async ensure() { await mkdir(this.directory(), { recursive: true, mode: 0o700 }); }

  async list(): Promise<Course[]> {
    await this.ensure();
    const names = (await readdir(this.directory())).filter((name) => name.endsWith(".json"));
    const courses = await Promise.all(names.map(async (name) => courseSchema.parse(JSON.parse(await readFile(path.join(this.directory(), name), "utf8")))));
    return courses.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<Course | null> {
    await this.ensure();
    const raw = await readJsonOrNull(this.coursePath(id));
    return raw === null ? null : courseSchema.parse(raw);
  }

  async create(course: Course): Promise<void> {
    const validated = courseSchema.parse(course);
    await this.ensure();
    const destination = this.coursePath(validated.id);
    const handle = await open(destination, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") throw new Error("The course already exists.");
      throw error;
    });
    try { await handle.writeFile(`${JSON.stringify(validated, null, 2)}\n`, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
  }

  async save(course: Course, expectedRevision: number): Promise<void> {
    const validated = courseSchema.parse(course);
    await this.withLock(validated.id, async () => {
      const current = await this.get(validated.id);
      if (!current) throw new Error("The course does not exist.");
      if (current.revision !== expectedRevision) throw new Error(`Revision conflict: expected ${expectedRevision}, but the course is at ${current.revision}.`);
      if (validated.revision !== expectedRevision + 1) throw new Error("The new revision must advance by exactly one.");
      await writeDurableJson(this.coursePath(validated.id), validated);
    });
  }

  async delete(id: string): Promise<boolean> {
    await this.ensure();
    try { await rm(this.coursePath(id)); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  }

  async restore(course: Course): Promise<void> {
    const validated = courseSchema.parse(course);
    await this.ensure();
    await withFileLease(this.root, `course-${validated.id}`, () => writeDurableJson(this.coursePath(validated.id), validated));
  }

  private async withLock<T>(id: string, action: () => Promise<T>): Promise<T> {
    return withFileLease(this.root, `course-${id}`, action);
  }
}

type OperationRecord = {
  schemaVersion?: 1;
  operationId: string;
  kind: string;
  fingerprint: string;
  status: "running" | "completed";
  startedAt: string;
  completedAt: string | null;
  result: unknown;
  ownerPid?: number;
  runtimeId?: string;
  leaseExpiresAt?: string;
};

type LocatedOperationRecord = {
  record: OperationRecord;
  filePath: string;
};

const operationRecordSchema = z.object({
  schemaVersion: z.literal(1).optional(),
  operationId: z.string().regex(operationPattern), kind: z.string().min(1).max(128), fingerprint: z.string().min(1).max(256),
  status: z.enum(["running", "completed"]), startedAt: z.string().datetime(), completedAt: z.string().datetime().nullable(), result: z.unknown(),
  ownerPid: z.number().int().positive().optional(), runtimeId: z.string().uuid().optional(), leaseExpiresAt: z.string().datetime().optional(),
});

const OPERATION_LEASE_MS = 30_000;

export class FileOperationRepository implements OperationRepository {
  private readonly runtimeId = randomUUID();
  constructor(
    private readonly root = materiaDataRoot(),
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}
  private directory() { return path.join(this.root, "operations"); }
  private storageKey(id: string) { assertOperationId(id); return createHash("sha256").update(id).digest("hex"); }
  private recordPath(id: string) { return path.join(this.directory(), `${this.storageKey(id)}.json`); }
  private legacyRecordPath(id: string) { return supportsLegacyOperationFilename(id, this.platform) ? path.join(this.directory(), `${id}.json`) : null; }
  private lockName(id: string) { return `operation-${this.storageKey(id)}`; }
  private async ensure() { await mkdir(this.directory(), { recursive: true, mode: 0o700 }); }

  async claim(input: { operationId: string; kind: string; fingerprint: string }): Promise<OperationClaim> {
    await this.ensure();
    const legacyPath = this.legacyRecordPath(input.operationId);
    const legacy = legacyPath ? await this.readAt(legacyPath, input.operationId) : null;
    if (legacy) return this.resolveExistingClaim(input);
    const destination = this.recordPath(input.operationId);
    const now = Date.now();
    const record: OperationRecord = { schemaVersion: 1, ...input, status: "running", startedAt: new Date(now).toISOString(), completedAt: null, result: null, ownerPid: process.pid, runtimeId: this.runtimeId, leaseExpiresAt: new Date(now + OPERATION_LEASE_MS).toISOString() };
    try {
      const handle = await open(destination, "wx", 0o600);
      try { await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
      return { state: "claimed" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return this.resolveExistingClaim(input, record);
    }
  }

  async complete(operationId: string, result: unknown): Promise<void> {
    const located = await this.read(operationId);
    if (!located) throw new Error("The operation does not exist.");
    await writeDurableJson(located.filePath, { ...located.record, status: "completed", completedAt: new Date().toISOString(), result });
  }

  async release(operationId: string): Promise<void> {
    const located = await this.read(operationId);
    if (located?.record.status === "running" && located.record.runtimeId === this.runtimeId) await rm(located.filePath, { force: true });
  }

  private async resolveExistingClaim(
    input: { operationId: string; kind: string; fingerprint: string },
    replacement?: OperationRecord,
  ): Promise<OperationClaim> {
    const resolved = await withFileLease<OperationClaim | null>(this.root, this.lockName(input.operationId), async () => {
      const located = await this.read(input.operationId);
      if (!located) return null;
      const existing = located.record;
      if (existing.kind !== input.kind || existing.fingerprint !== input.fingerprint) throw new Error("operationId was already used with a different operation or input.");
      if (existing.status === "completed") return { state: "completed", result: existing.result };
      const leaseExpiresAt = existing.leaseExpiresAt || new Date(Date.parse(existing.startedAt) + OPERATION_LEASE_MS).toISOString();
      const expired = Date.parse(leaseExpiresAt) <= Date.now();
      const ownerAlive = existing.ownerPid !== undefined && isProcessAlive(existing.ownerPid);
      if (expired && !ownerAlive) {
        const now = Date.now();
        const recovered = replacement || { schemaVersion: 1, ...input, status: "running" as const, startedAt: new Date(now).toISOString(), completedAt: null, result: null, ownerPid: process.pid, runtimeId: this.runtimeId, leaseExpiresAt: new Date(now + OPERATION_LEASE_MS).toISOString() };
        await writeDurableJson(located.filePath, recovered);
        return { state: "claimed" };
      }
      return { state: "running" };
    });
    return resolved || this.claim(input);
  }

  private async read(operationId: string): Promise<LocatedOperationRecord | null> {
    assertOperationId(operationId);
    const current = await this.readAt(this.recordPath(operationId), operationId);
    if (current) return current;
    const legacyPath = this.legacyRecordPath(operationId);
    return legacyPath ? this.readAt(legacyPath, operationId) : null;
  }

  private async readAt(filePath: string, operationId: string): Promise<LocatedOperationRecord | null> {
    const raw = await readJsonOrNull(filePath);
    if (raw === null) return null;
    const parsed = operationRecordSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`Invalid operation claim: ${parsed.error.issues[0]?.message || "unknown schema"}.`);
    if (parsed.data.operationId !== operationId) throw new Error("The persisted claim does not match the requested operationId.");
    return { record: parsed.data, filePath };
  }
}

const speechProfileSchema = z.object({
  provider: z.enum(["demo", "openai", "kokoro", "qwen", "chatterbox"]), nodeId: z.string().nullable(), voice: z.string().min(1),
  speed: z.number().finite().positive(), language: z.enum(["es", "en-us", "en-gb"]), style: z.enum(["neutral", "serious", "warm"]),
  pronunciation: z.enum(["literal", "technical-es"]),
});
const audioJobSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().regex(uuidPattern), operationId: z.string().regex(operationPattern), lessonId: z.string().regex(uuidPattern),
  expectedLessonRevision: z.number().int().positive(), chapterIds: z.array(z.string().min(1)).min(1), provider: z.enum(["demo", "openai", "kokoro", "qwen", "chatterbox"]),
  profileKey: z.string().min(1), profile: speechProfileSchema, state: z.enum(["queued", "running", "completed", "failed", "interrupted", "unknown"]),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), completedAt: z.string().datetime().nullable(), error: z.string().nullable(), lessonRevision: z.number().int().positive().nullable(),
  runtimeId: z.string().uuid().optional(), ownerPid: z.number().int().positive().optional(), remoteSubmissionState: z.enum(["not-started", "submitting", "accepted"]).optional(), remoteJobId: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/).nullable().optional(), remoteChapterId: z.string().min(1).nullable().optional(),
});

const audioBatchJobSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().regex(uuidPattern), scope: z.enum(["lesson", "course"]), courseId: z.string().regex(uuidPattern).nullable(),
  lessonIds: z.array(z.string().regex(uuidPattern)).min(1), provider: z.enum(["demo", "openai", "kokoro", "qwen", "chatterbox"]), profile: speechProfileSchema,
  profileKey: z.string().min(1), state: z.enum(["queued", "running", "completed", "failed", "interrupted"]), totalChapters: z.number().int().nonnegative(),
  completedChapters: z.number().int().nonnegative(), currentLessonId: z.string().regex(uuidPattern).nullable(), currentChapterId: z.string().nullable(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), completedAt: z.string().datetime().nullable(), error: z.string().nullable(), runtimeId: z.string().uuid().optional(), ownerPid: z.number().int().positive().optional(),
});

export class FileAudioJobRepository implements AudioJobRepository {
  private readonly runtimeId = randomUUID();
  private readonly ready: Promise<void>;
  constructor(private readonly root = materiaDataRoot()) { this.ready = this.reconcileStoredJobs(); }
  private directory() { return path.join(this.root, "jobs", "audio"); }
  private jobPath(id: string) { assertUuid(id, "job ID"); return path.join(this.directory(), `${id}.json`); }
  private async ensure() { await mkdir(this.directory(), { recursive: true, mode: 0o700 }); }

  async get(id: string): Promise<AudioJob | null> {
    await this.ready;
    await this.ensure();
    const raw = await readJsonOrNull(this.jobPath(id));
    return raw === null ? null : this.parseAndReconcile(raw);
  }

  async findByOperationId(operationId: string): Promise<AudioJob | null> {
    await this.ready;
    assertOperationId(operationId);
    await this.ensure();
    const names = (await readdir(this.directory())).filter((name) => name.endsWith(".json"));
    for (const name of names) {
      const job = await this.parseAndReconcile(JSON.parse(await readFile(path.join(this.directory(), name), "utf8")));
      if (job.operationId === operationId) return job;
    }
    return null;
  }

  async save(job: AudioJob): Promise<void> {
    await this.ready;
    await this.ensure();
    const validated = audioJobSchema.parse({ ...job, runtimeId: this.runtimeId, ownerPid: process.pid });
    await writeDurableJson(this.jobPath(job.id), validated);
  }

  private async parseAndReconcile(raw: unknown): Promise<AudioJob> {
    const parsed = audioJobSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`Invalid audio job: ${parsed.error.issues[0]?.message || "unknown schema"}.`);
    const job = parsed.data as AudioJob;
    const recentLegacy = job.ownerPid === undefined && Date.now() - Date.parse(job.updatedAt) <= OPERATION_LEASE_MS;
    if ((job.state !== "queued" && job.state !== "running") || job.runtimeId === this.runtimeId || recentLegacy || (job.ownerPid !== undefined && isProcessAlive(job.ownerPid))) return job;
    if (job.remoteJobId) return job;
    const now = new Date().toISOString();
    const state = job.remoteSubmissionState === "submitting" ? "unknown" as const : "interrupted" as const;
    const reconciled: AudioJob = {
      ...job, state, runtimeId: this.runtimeId, ownerPid: process.pid, updatedAt: now, completedAt: now,
      error: state === "unknown"
        ? "Remote synthesis may have been accepted, but no safe identifier was persisted. It will not be resubmitted automatically."
        : "The local process ended before completing the job.",
    };
    await writeDurableJson(this.jobPath(job.id), reconciled);
    return reconciled;
  }

  private async reconcileStoredJobs(): Promise<void> {
    await this.ensure();
    const names = (await readdir(this.directory())).filter((name) => name.endsWith(".json"));
    for (const name of names) await this.parseAndReconcile(JSON.parse(await readFile(path.join(this.directory(), name), "utf8")));
  }
}

export class FileAudioBatchJobRepository implements AudioBatchJobRepository {
  private readonly runtimeId = randomUUID();
  private readonly ready: Promise<void>;
  constructor(private readonly root = materiaDataRoot()) { this.ready = this.reconcileStoredJobs(); }
  private directory() { return path.join(this.root, "jobs", "audio-batch"); }
  private jobPath(id: string) { assertUuid(id, "batch job ID"); return path.join(this.directory(), `${id}.json`); }
  async get(id: string): Promise<AudioBatchJob | null> {
    await this.ready;
    await mkdir(this.directory(), { recursive: true, mode: 0o700 });
    const raw = await readJsonOrNull(this.jobPath(id));
    if (raw === null) return null;
    const parsed = audioBatchJobSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`Invalid audio batch job: ${parsed.error.issues[0]?.message || "unknown schema"}.`);
    const job = parsed.data as AudioBatchJob;
    const recentLegacy = job.ownerPid === undefined && Date.now() - Date.parse(job.updatedAt) <= OPERATION_LEASE_MS;
    if ((job.state !== "queued" && job.state !== "running") || job.runtimeId === this.runtimeId || recentLegacy || (job.ownerPid !== undefined && isProcessAlive(job.ownerPid))) return job;
    const now = new Date().toISOString();
    const reconciled: AudioBatchJob = { ...job, state: "interrupted", runtimeId: this.runtimeId, ownerPid: process.pid, updatedAt: now, completedAt: now, error: "The local process ended before completing the batch." };
    await writeDurableJson(this.jobPath(job.id), reconciled);
    return reconciled;
  }
  async save(job: AudioBatchJob): Promise<void> {
    await this.ready;
    await mkdir(this.directory(), { recursive: true, mode: 0o700 });
    const validated = audioBatchJobSchema.parse({ ...job, runtimeId: this.runtimeId, ownerPid: process.pid });
    await writeDurableJson(this.jobPath(job.id), validated);
  }

  private async reconcileStoredJobs(): Promise<void> {
    await mkdir(this.directory(), { recursive: true, mode: 0o700 });
    const names = (await readdir(this.directory())).filter((name) => name.endsWith(".json"));
    for (const name of names) {
      const parsed = audioBatchJobSchema.safeParse(JSON.parse(await readFile(path.join(this.directory(), name), "utf8")));
      if (!parsed.success) throw new Error(`Invalid audio batch job: ${parsed.error.issues[0]?.message || "unknown schema"}.`);
      const job = parsed.data as AudioBatchJob;
      const recentLegacy = job.ownerPid === undefined && Date.now() - Date.parse(job.updatedAt) <= OPERATION_LEASE_MS;
      if ((job.state !== "queued" && job.state !== "running") || job.runtimeId === this.runtimeId || recentLegacy || (job.ownerPid !== undefined && isProcessAlive(job.ownerPid))) continue;
      const now = new Date().toISOString();
      await writeDurableJson(this.jobPath(job.id), { ...job, state: "interrupted", runtimeId: this.runtimeId, ownerPid: process.pid, updatedAt: now, completedAt: now, error: "The local process ended before completing the batch." });
    }
  }
}

export class FileCourseCleanupRepository implements CourseCleanupRepository {
  constructor(private readonly root = materiaDataRoot()) {}
  async deleteRelated(courseId: string, lessonIds: string[]): Promise<void> {
    await rm(path.join(this.root, "course-progress", `${courseId}.json`), { force: true });
    const lessonSet = new Set(lessonIds);
    for (const relative of [["jobs", "audio"], ["jobs", "audio-batch"], ["operations"]]) {
      const directory = path.join(this.root, ...relative);
      let names: string[] = [];
      try { names = (await readdir(directory)).filter((name) => name.endsWith(".json")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      for (const name of names) {
        const file = path.join(directory, name);
        const raw = await readJsonOrNull(file);
        const serialized = JSON.stringify(raw);
        if (serialized.includes(courseId) || [...lessonSet].some((lessonId) => serialized.includes(lessonId))) await rm(file, { force: true });
      }
    }
  }
}

export class FileCourseProgressRepository implements CourseProgressRepository {
  constructor(private readonly root = materiaDataRoot()) {}
  private directory() { return path.join(this.root, "course-progress"); }
  private progressPath(id: string) { assertUuid(id, "course ID"); return path.join(this.directory(), `${id}.json`); }

  async get(courseId: string): Promise<CourseStudyProgress | null> {
    await mkdir(this.directory(), { recursive: true, mode: 0o700 });
    const raw = await readJsonOrNull(this.progressPath(courseId));
    return raw === null ? null : courseStudyProgressSchema.parse(raw);
  }

  async save(progress: CourseStudyProgress, expectedRevision: number): Promise<void> {
    const validated = courseStudyProgressSchema.parse(progress);
    await mkdir(this.directory(), { recursive: true, mode: 0o700 });
    await withFileLease(this.root, `course-progress-${validated.courseId}`, async () => {
      const raw = await readJsonOrNull(this.progressPath(validated.courseId));
      const current = raw === null ? null : courseStudyProgressSchema.parse(raw);
      const currentRevision = current?.revision ?? 1;
      if (currentRevision !== expectedRevision) throw new Error(`Revision conflict: expected ${expectedRevision}, but course progress is at ${currentRevision}.`);
      if (validated.revision !== expectedRevision + 1) throw new Error("The new progress revision must advance by exactly one.");
      await writeDurableJson(this.progressPath(validated.courseId), validated);
    });
  }
}
