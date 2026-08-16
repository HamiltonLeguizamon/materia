import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NETWORKING_TEACHING_PLAN } from "@/adapters/demo/demo-providers";
import { FileAudioJobRepository, FileOperationRepository } from "@/adapters/persistence/file-course-repository";
import { FileLessonRepository } from "@/adapters/persistence/file-lesson-repository";
import { LessonContentService } from "@/application/lesson-content-service";
import { SelectiveAudioService } from "@/application/selective-audio-service";
import type { AudioJob, SpeechProvider } from "@/application/ports";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))); });

function validMp3Bytes(): Uint8Array {
  const bytes = new Uint8Array(384);
  bytes.set([0xff, 0xf3, 0xc4, 0x00]);
  return bytes;
}

describe("selective audio service", () => {
  it("estimates without calling speech and only synthesizes confirmed chapters idempotently", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-audio-job-")); roots.push(root);
    const lessons = new FileLessonRepository(root);
    const lesson = await new LessonContentService(lessons).createImported({ courseId: "33333333-3333-4333-8333-333333333333", sourceIds: ["source-1", "source-2", "source-3", "source-4", "source-5"], durationMinutes: 8, level: "intermediate", objective: "Estudiar una lección importada con audio selectivo.", plan: NETWORKING_TEACHING_PLAN });
    const speech: SpeechProvider = { profileKey: "openai:test-profile", profile: { provider: "openai", nodeId: null, voice: "coral", speed: 1, language: "es", style: "serious", pronunciation: "literal" }, synthesize: vi.fn(async () => ({ kind: "browser-speech" as const, mimeType: "application/x-browser-speech" as const })) };
    const service = new SelectiveAudioService(lessons, new FileAudioJobRepository(root), new FileOperationRepository(root), () => speech);

    const estimate = await service.estimate({ lessonId: lesson.id, chapterIds: ["chapter-1"] });
    expect(estimate.estimatedMinutes).toBeGreaterThan(0);
    expect(estimate.estimatedCost).toBeNull();
    expect(speech.synthesize).not.toHaveBeenCalled();
    await expect(service.generate({ operationId: "audio-without-confirmation", lessonId: lesson.id, expectedLessonRevision: lesson.revision, chapterIds: ["chapter-1"], confirmed: false, provider: "openai" })).rejects.toThrow(/confirmation/);
    expect(speech.synthesize).not.toHaveBeenCalled();

    const request = { operationId: "audio-chapter-1", lessonId: lesson.id, expectedLessonRevision: lesson.revision, chapterIds: ["chapter-1"], confirmed: true, provider: "openai" as const };
    const first = await service.generate(request);
    const operationFile = `${createHash("sha256").update(request.operationId).digest("hex")}.json`;
    const operation = JSON.parse(await readFile(path.join(root, "operations", operationFile), "utf8")) as { status: string };
    const replay = await service.generate(request);
    expect(first.state).toBe("completed");
    expect(operation.status).toBe("completed");
    expect(replay.id).toBe(first.id);
    expect(speech.synthesize).toHaveBeenCalledTimes(1);
    const reopened = await lessons.get(lesson.id);
    expect(reopened?.audioByChapter["chapter-1"]).toMatchObject({ status: "ready", provider: "openai" });
    expect(reopened?.audioByChapter["chapter-2"].status).toBe("pending");
  });

  it("persists speech bytes for an imported chapter ID", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-audio-job-")); roots.push(root);
    const lessons = new FileLessonRepository(root);
    const plan = structuredClone(NETWORKING_TEACHING_PLAN);
    plan.chapters[0].id = "ch-architecture-1";
    plan.questions[0].chapterId = "ch-architecture-1";
    const lesson = await new LessonContentService(lessons).createImported({ courseId: "33333333-3333-4333-8333-333333333333", sourceIds: ["source-1", "source-2", "source-3", "source-4", "source-5"], durationMinutes: 8, level: "intermediate", objective: "Estudiar una lección importada con audio selectivo.", plan });
    const speech: SpeechProvider = { profileKey: "openai:test-profile", profile: { provider: "openai", nodeId: null, voice: "coral", speed: 1, language: "es", style: "serious", pronunciation: "literal" }, synthesize: vi.fn(async () => ({ kind: "bytes" as const, mimeType: "audio/mpeg" as const, bytes: validMp3Bytes(), durationSeconds: 1, chunkCount: 1 })) };
    const service = new SelectiveAudioService(lessons, new FileAudioJobRepository(root), new FileOperationRepository(root), () => speech);

    const completed = await service.generate({ operationId: "audio-imported-chapter", lessonId: lesson.id, expectedLessonRevision: lesson.revision, chapterIds: ["ch-architecture-1"], confirmed: true, provider: "openai" });
    const reopened = await lessons.get(lesson.id);
    expect(completed.state).toBe("completed");
    expect(reopened?.audioByChapter["ch-architecture-1"]).toMatchObject({ status: "ready", kind: "file", provider: "openai", durationSeconds: 1 });
    expect(reopened?.audioByChapter["chapter-2"].status).toBe("pending");
  });

  it("merges audio with progress saved while synthesis was running", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-audio-job-")); roots.push(root);
    const lessons = new FileLessonRepository(root);
    const lesson = await new LessonContentService(lessons).createImported({ courseId: "33333333-3333-4333-8333-333333333333", sourceIds: ["source-1", "source-2", "source-3", "source-4", "source-5"], durationMinutes: 8, level: "intermediate", objective: "Conservar el progreso mientras se sintetiza audio.", plan: NETWORKING_TEACHING_PLAN });
    let synthesisStarted!: () => void;
    let finishSynthesis!: () => void;
    const started = new Promise<void>((resolve) => { synthesisStarted = resolve; });
    const finish = new Promise<void>((resolve) => { finishSynthesis = resolve; });
    const speech: SpeechProvider = { profileKey: "qwen:test-profile", profile: { provider: "qwen", nodeId: "gpu-node", voice: "my-voice", speed: 1, language: "es", style: "serious", pronunciation: "literal" }, synthesize: vi.fn(async () => { synthesisStarted(); await finish; return { kind: "bytes" as const, mimeType: "audio/mpeg" as const, bytes: validMp3Bytes(), durationSeconds: 1, chunkCount: 1 }; }) };
    const service = new SelectiveAudioService(lessons, new FileAudioJobRepository(root), new FileOperationRepository(root), () => speech);

    const generation = service.generate({ operationId: "audio-with-concurrent-progress", lessonId: lesson.id, expectedLessonRevision: lesson.revision, chapterIds: ["chapter-1"], confirmed: true, provider: "qwen", profile: speech.profile });
    await started;
    const duringSynthesis = await lessons.get(lesson.id);
    expect(duringSynthesis).not.toBeNull();
    await lessons.save({ ...duringSynthesis!, revision: duringSynthesis!.revision + 1, progress: { ...duringSynthesis!.progress, activeChapterId: "chapter-2", updatedAt: new Date().toISOString() }, updatedAt: new Date().toISOString() }, duringSynthesis!.revision);
    finishSynthesis();

    const completed = await generation;
    const reopened = await lessons.get(lesson.id);
    expect(completed.state).toBe("completed");
    expect(reopened?.progress.activeChapterId).toBe("chapter-2");
    expect(reopened?.audioByChapter["chapter-1"]).toMatchObject({ status: "ready", provider: "qwen" });
  });

  it("deletes a chapter MP3 while preserving content and progress for regeneration", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-audio-delete-")); roots.push(root);
    const lessons = new FileLessonRepository(root);
    const lesson = await new LessonContentService(lessons).createImported({ courseId: "33333333-3333-4333-8333-333333333333", sourceIds: ["source-1"], durationMinutes: 8, level: "intermediate", objective: "Comparar voces sin perder el progreso de estudio.", plan: NETWORKING_TEACHING_PLAN });
    const speech: SpeechProvider = { profileKey: "openai:test-profile", profile: { provider: "openai", nodeId: null, voice: "coral", speed: 1, language: "es", style: "serious", pronunciation: "literal" }, synthesize: vi.fn(async () => ({ kind: "bytes" as const, mimeType: "audio/mpeg" as const, bytes: validMp3Bytes(), durationSeconds: 1, chunkCount: 1 })) };
    const service = new SelectiveAudioService(lessons, new FileAudioJobRepository(root), new FileOperationRepository(root), () => speech);
    const completed = await service.generate({ operationId: "audio-to-delete", lessonId: lesson.id, expectedLessonRevision: lesson.revision, chapterIds: ["chapter-1"], confirmed: true, provider: "openai" });
    const generated = await lessons.get(lesson.id);
    expect(generated?.revision).toBe(completed.lessonRevision);
    if (!generated) throw new Error("La lección generada no existe.");
    generated.progress.completedChapterIds = ["chapter-1"];
    generated.progress.answers["question-1"] = 0;
    generated.revision += 1;
    await lessons.save(generated, generated.revision - 1);

    await expect(service.deleteChapterAudio({ lessonId: lesson.id, chapterId: "chapter-1", expectedLessonRevision: generated.revision, confirmed: false })).rejects.toThrow(/confirmation/);
    const deleted = await service.deleteChapterAudio({ lessonId: lesson.id, chapterId: "chapter-1", expectedLessonRevision: generated.revision, confirmed: true });

    expect(deleted.audioByChapter["chapter-1"]).toMatchObject({ status: "pending", kind: null, provider: null, profileKey: null });
    expect(deleted.progress.completedChapterIds).toEqual(["chapter-1"]);
    expect(deleted.progress.answers["question-1"]).toBe(0);
    await expect(access(path.join(root, "audio", lesson.id, "chapter-1.mp3"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not repeat remote synthesis when reopening an operation whose POST may have been accepted", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-remote-restart-")); roots.push(root);
    const lessons = new FileLessonRepository(root);
    const jobs = new FileAudioJobRepository(root);
    const operations = new FileOperationRepository(root);
    const lesson = await new LessonContentService(lessons).createImported({
      courseId: "33333333-3333-4333-8333-333333333333",
      sourceIds: ["source-1"],
      durationMinutes: 8,
      level: "intermediate",
      objective: "Evitar una segunda síntesis cuando el resultado remoto es ambiguo.",
      plan: NETWORKING_TEACHING_PLAN,
    });
    const speech: SpeechProvider = {
      profileKey: "qwen:restart-profile",
      profile: { provider: "qwen", nodeId: "test-node", voice: "profile-c", speed: 1, language: "es", style: "serious", pronunciation: "literal" },
      synthesize: vi.fn(async () => { throw new Error("no debe crear otro trabajo remoto"); }),
    };
    const request = {
      operationId: "remote-accepted-before-restart",
      lessonId: lesson.id,
      expectedLessonRevision: lesson.revision,
      chapterIds: ["chapter-1"],
      confirmed: true,
      provider: "qwen" as const,
      profile: speech.profile,
    };
    const now = "2026-08-15T00:00:00.000Z";
    const persisted: AudioJob = {
      schemaVersion: 1,
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      operationId: request.operationId,
      lessonId: lesson.id,
      expectedLessonRevision: lesson.revision,
      chapterIds: request.chapterIds,
      provider: request.provider,
      profileKey: speech.profileKey,
      profile: speech.profile,
      state: "running",
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      error: "El trabajo remoto puede seguir activo; no se debe reenviar.",
      lessonRevision: null,
    };
    await jobs.save(persisted);
    const fingerprint = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    await operations.claim({ operationId: request.operationId, kind: "generate-audio", fingerprint });
    const restarted = new SelectiveAudioService(lessons, new FileAudioJobRepository(root), new FileOperationRepository(root), () => speech);

    const reopened = await restarted.start(request);

    expect(reopened.id).toBe(persisted.id);
    expect(speech.synthesize).not.toHaveBeenCalled();
  });

  it("marks a job unknown without remoteJobId and resumes remote synthesis only with a safe ID", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-remote-recovery-")); roots.push(root);
    const lessons = new FileLessonRepository(root);
    const jobs = new FileAudioJobRepository(root);
    const operations = new FileOperationRepository(root);
    const lesson = await new LessonContentService(lessons).createImported({
      courseId: "33333333-3333-4333-8333-333333333333", sourceIds: ["source-1"], durationMinutes: 8, level: "intermediate",
      objective: "Recuperar una síntesis remota sin duplicarla.", plan: NETWORKING_TEACHING_PLAN,
    });
    const speech: SpeechProvider = {
      profileKey: "qwen:recovery-profile",
      profile: { provider: "qwen", nodeId: "test-node", voice: "profile-c", speed: 1, language: "es", style: "serious", pronunciation: "literal" },
      synthesize: vi.fn(async (_input, recovery) => {
        expect(recovery?.remoteJobId).toBe("voice-job-safe");
        return { kind: "bytes" as const, mimeType: "audio/mpeg" as const, bytes: new Uint8Array([1, 2, 3]), durationSeconds: 1, chunkCount: 1 };
      }),
    };
    const request = { operationId: "remote-safe-resume", lessonId: lesson.id, expectedLessonRevision: lesson.revision, chapterIds: ["chapter-1"], confirmed: true, provider: "qwen" as const, profile: speech.profile };
    const now = "2026-08-15T00:00:00.000Z";
    await jobs.save({
      schemaVersion: 1, id: "12121212-1212-4121-8121-121212121212", operationId: request.operationId, lessonId: lesson.id,
      expectedLessonRevision: lesson.revision, chapterIds: request.chapterIds, provider: "qwen", profileKey: speech.profileKey, profile: speech.profile,
      state: "running", createdAt: now, updatedAt: now, completedAt: null, error: null, lessonRevision: null,
      remoteSubmissionState: "accepted", remoteJobId: "voice-job-safe", remoteChapterId: "chapter-1",
    });
    await markOwnerDead(path.join(root, "jobs", "audio", "12121212-1212-4121-8121-121212121212.json"));
    const fingerprint = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    await operations.claim({ operationId: request.operationId, kind: "generate-audio", fingerprint });

    const restarted = new SelectiveAudioService(lessons, new FileAudioJobRepository(root), new FileOperationRepository(root), () => speech);
    const completed = await restarted.generate(request);

    expect(completed.state).toBe("completed");
    expect(speech.synthesize).toHaveBeenCalledTimes(1);

    const unknownJobs = new FileAudioJobRepository(root);
    const unknownRequest = { ...request, operationId: "remote-ambiguous-restart", expectedLessonRevision: completed.lessonRevision! };
    await unknownJobs.save({
      schemaVersion: 1, id: "34343434-3434-4343-8343-343434343434", operationId: unknownRequest.operationId, lessonId: lesson.id,
      expectedLessonRevision: unknownRequest.expectedLessonRevision, chapterIds: ["chapter-2"], provider: "qwen", profileKey: speech.profileKey, profile: speech.profile,
      state: "running", createdAt: now, updatedAt: now, completedAt: null, error: null, lessonRevision: null,
      remoteSubmissionState: "submitting", remoteJobId: null, remoteChapterId: "chapter-2",
    });
    await markOwnerDead(path.join(root, "jobs", "audio", "34343434-3434-4343-8343-343434343434.json"));
    const unknownFingerprint = createHash("sha256").update(JSON.stringify({ ...unknownRequest, chapterIds: ["chapter-2"] })).digest("hex");
    await operations.claim({ operationId: unknownRequest.operationId, kind: "generate-audio", fingerprint: unknownFingerprint });
    const unknownService = new SelectiveAudioService(lessons, new FileAudioJobRepository(root), new FileOperationRepository(root), () => speech);

    const unknown = await unknownService.start({ ...unknownRequest, chapterIds: ["chapter-2"] });
    expect(unknown.state).toBe("unknown");
    expect(speech.synthesize).toHaveBeenCalledTimes(1);
  });
});

async function markOwnerDead(filePath: string): Promise<void> {
  const record = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
  await writeFile(filePath, `${JSON.stringify({ ...record, ownerPid: 2_147_483_647 }, null, 2)}\n`);
}
