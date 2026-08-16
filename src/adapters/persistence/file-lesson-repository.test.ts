import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DemoSpeechProvider, DemoTeachingPlanProvider } from "@/adapters/demo/demo-providers";
import { FileLessonRepository } from "@/adapters/persistence/file-lesson-repository";
import { LessonService } from "@/application/lesson-service";
import { LessonContentService } from "@/application/lesson-content-service";
import { createLessonInputSchema } from "@/domain/teaching";
import { LEGACY_LESSON_V1 } from "@/fixtures/legacy-lesson-v1";
import { NETWORKING_FIXTURE, NETWORKING_FIXTURE_NAME } from "@/fixtures/networking";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))); });

describe("file lesson repository", () => {
  it("persists, reopens, updates progress, and deletes a demo lesson", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-test-")); roots.push(root);
    const repository = new FileLessonRepository(root);
    const service = new LessonService(repository, new DemoTeachingPlanProvider(), new DemoSpeechProvider(), "demo");
    const lesson = await service.create({ sourceName: NETWORKING_FIXTURE_NAME, sourceText: NETWORKING_FIXTURE, durationMinutes: 15, level: "intermediate", objective: "Entender cómo viajan los paquetes y poder explicarlo.", provider: "demo" });
    expect(lesson.status).toBe("ready");
    expect(Object.values(lesson.audioByChapter).every((audio) => audio.kind === "browser-speech")).toBe(true);

    const restartedRepository = new FileLessonRepository(root);
    expect((await restartedRepository.list())[0].id).toBe(lesson.id);
    const restartedService = new LessonService(restartedRepository, new DemoTeachingPlanProvider(), new DemoSpeechProvider(), "demo");
    await expect(restartedService.updateProgress(lesson.id, { expectedRevision: lesson.revision, completedChapterIds: ["chapter-1"] })).rejects.toThrow(/Answer correctly/);
    await expect(restartedService.updateProgress(lesson.id, { expectedRevision: lesson.revision, completedChapterIds: ["chapter-1"], questionId: "question-0", answer: 1 })).rejects.toThrow(/Answer correctly/);
    const updated = await restartedService.updateProgress(lesson.id, { expectedRevision: lesson.revision, completedChapterIds: ["chapter-1"], questionId: "question-0", answer: 0 });
    expect(updated.progress.completedChapterIds).toEqual(["chapter-1"]);
    expect(updated.progress.answers["question-0"]).toBe(0);
    const unchanged = await restartedService.updateProgress(lesson.id, { expectedRevision: updated.revision, activeChapterId: updated.progress.activeChapterId || "chapter-1", completedChapterIds: ["chapter-1"], questionId: "question-0", answer: 0 });
    expect(unchanged.revision).toBe(updated.revision);
    const unmarked = await restartedService.updateProgress(lesson.id, { expectedRevision: unchanged.revision, completedChapterIds: [] });
    expect(unmarked.progress.completedChapterIds).toEqual([]);
    const reusableInput = createLessonInputSchema.parse({ sourceName: NETWORKING_FIXTURE_NAME, sourceText: NETWORKING_FIXTURE, durationMinutes: 15, level: "intermediate", objective: "Entender cómo viajan los paquetes y poder explicarlo.", provider: "demo" });
    expect((await restartedRepository.findReusable(reusableInput))?.id).toBe(lesson.id);
    expect(await restartedRepository.delete(lesson.id)).toBe(true);
    expect(await restartedRepository.get(lesson.id)).toBeNull();
  });

  it("calculates the duration of a legacy MP3 when reopening it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-test-")); roots.push(root);
    const repository = new FileLessonRepository(root);
    const service = new LessonService(repository, new DemoTeachingPlanProvider(), new DemoSpeechProvider(), "demo");
    const lesson = await service.create({ sourceName: NETWORKING_FIXTURE_NAME, sourceText: NETWORKING_FIXTURE, durationMinutes: 15, level: "intermediate", objective: "Entender cómo viajan los paquetes y poder explicarlo.", provider: "demo" });
    const frameLength = 384;
    const bytes = new Uint8Array(frameLength * 100);
    for (let index = 0; index < 100; index += 1) bytes.set([0xff, 0xf3, 0xc4, 0x00], index * frameLength);
    const directory = path.join(root, "audio", lesson.id);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "chapter-1.mp3"), bytes);
    lesson.audioByChapter["chapter-1"] = { status: "ready", kind: "file", url: `/api/lessons/${lesson.id}/audio/chapter-1`, mimeType: "audio/mpeg", provider: "demo", profileKey: "demo:browser-speech:es-ES:v1", error: null, generatedAt: new Date().toISOString(), durationSeconds: null, narrationVersion: 2 };
    await repository.save(lesson);
    expect((await repository.get(lesson.id))?.audioByChapter["chapter-1"].durationSeconds).toBeCloseTo(2.4, 3);
    const persisted = JSON.parse(await readFile(path.join(root, "lessons", `${lesson.id}.json`), "utf8")) as typeof lesson;
    expect(persisted.audioByChapter["chapter-1"].durationSeconds).toBeCloseTo(2.4, 3);
  });

  it("reopens a v1 file as v4 without rewriting it during the read", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-test-")); roots.push(root);
    const lessonsDir = path.join(root, "lessons");
    await mkdir(lessonsDir, { recursive: true });
    const lessonPath = path.join(lessonsDir, `${LEGACY_LESSON_V1.id}.json`);
    const original = `${JSON.stringify(LEGACY_LESSON_V1, null, 2)}\n`;
    await writeFile(lessonPath, original);

    const reopened = await new FileLessonRepository(root).get(LEGACY_LESSON_V1.id);
    expect(reopened?.schemaVersion).toBe(4);
    expect(reopened?.origin).toBe("demo");
    expect(await (await import("node:fs/promises")).readFile(lessonPath, "utf8")).toBe(original);
  });

  it("does not reuse a generation as complete while its audio remains pending", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-test-")); roots.push(root);
    const repository = new FileLessonRepository(root);
    const input = createLessonInputSchema.parse({ sourceName: NETWORKING_FIXTURE_NAME, sourceText: NETWORKING_FIXTURE, durationMinutes: 15, level: "intermediate", objective: "Entender cómo viajan los paquetes y poder explicarlo.", provider: "openai" });
    const plan = await new DemoTeachingPlanProvider().createPlan(input);
    await new LessonContentService(repository).createFromPlan(input, plan);
    expect(await repository.findReusable(input)).toBeNull();
  });

  it("marks a ready artifact as failed when its MP3 is missing or invalid", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-audio-reconcile-")); roots.push(root);
    const repository = new FileLessonRepository(root);
    const lesson = await new LessonService(repository, new DemoTeachingPlanProvider(), new DemoSpeechProvider(), "demo").create({ sourceName: NETWORKING_FIXTURE_NAME, sourceText: NETWORKING_FIXTURE, durationMinutes: 15, level: "intermediate", objective: "Detectar audio local que ya no puede reproducirse.", provider: "demo" });
    const directory = path.join(root, "audio", lesson.id);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "chapter-2.mp3"), new Uint8Array([1, 2, 3, 4]));
    for (const chapterId of ["chapter-1", "chapter-2"]) {
      lesson.audioByChapter[chapterId] = { status: "ready", kind: "file", url: `/api/lessons/${lesson.id}/audio/${chapterId}`, mimeType: "audio/mpeg", provider: "openai", profileKey: "openai:test", error: null, generatedAt: new Date().toISOString(), durationSeconds: 1, narrationVersion: 3 };
    }
    await repository.save(lesson);

    const reopened = await repository.get(lesson.id);

    expect(reopened?.audioByChapter["chapter-1"]).toMatchObject({ status: "failed", kind: null, url: null, durationSeconds: null, error: expect.stringMatching(/no longer exists/) });
    expect(reopened?.audioByChapter["chapter-2"]).toMatchObject({ status: "failed", kind: null, url: null, durationSeconds: null, error: expect.stringMatching(/not a valid MP3/) });
    const persisted = await new FileLessonRepository(root).get(lesson.id);
    expect(persisted?.audioByChapter["chapter-1"].status).toBe("failed");
    await expect(access(path.join(directory, "chapter-2.mp3"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stores audio for imported chapters with stable IDs without accepting traversal", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-test-")); roots.push(root);
    const repository = new FileLessonRepository(root);
    const lessonId = "8df97b52-568e-4319-89cc-1818ea2a7606";
    const url = await repository.saveAudio(lessonId, "ch-architecture-1", new Uint8Array([1, 2, 3]));
    expect(url).toBe(`/api/lessons/${lessonId}/audio/ch-architecture-1`);
    await expect(repository.saveAudio(lessonId, "../escape", new Uint8Array([1]))).rejects.toThrow(/invalid chapter/i);
  });

  it("deletes MP3 files no longer backed by a current artifact", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-test-")); roots.push(root);
    const repository = new FileLessonRepository(root);
    const service = new LessonService(repository, new DemoTeachingPlanProvider(), new DemoSpeechProvider(), "demo");
    const lesson = await service.create({ sourceName: NETWORKING_FIXTURE_NAME, sourceText: NETWORKING_FIXTURE, durationMinutes: 15, level: "intermediate", objective: "Entender cómo viajan los paquetes y poder explicarlo.", provider: "demo" });
    const directory = path.join(root, "audio", lesson.id);
    await mkdir(directory, { recursive: true });
    const retained = path.join(directory, "chapter-1.mp3");
    const stale = path.join(directory, "old-chapter.mp3");
    await writeFile(retained, new Uint8Array([1, 2, 3]));
    await writeFile(stale, new Uint8Array([4, 5, 6]));
    lesson.audioByChapter["chapter-1"] = { status: "ready", kind: "file", url: `/api/lessons/${lesson.id}/audio/chapter-1`, mimeType: "audio/mpeg", provider: "demo", profileKey: "demo:file:es-ES:v1", error: null, generatedAt: new Date().toISOString(), durationSeconds: 1, narrationVersion: 3 };

    await repository.save(lesson);

    await expect(access(retained)).resolves.toBeUndefined();
    await expect(access(stale)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recovers an abandoned lesson lock without touching an active operation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-stale-lesson-lock-")); roots.push(root);
    const repository = new FileLessonRepository(root);
    const lesson = await new LessonContentService(repository).createImported({
      courseId: "33333333-3333-4333-8333-333333333333",
      sourceIds: ["source-1"],
      durationMinutes: 8,
      level: "intermediate",
      objective: "Especificar la recuperación conservadora de bloqueos abandonados.",
      plan: await new DemoTeachingPlanProvider().createPlan(createLessonInputSchema.parse({
        sourceName: NETWORKING_FIXTURE_NAME,
        sourceText: NETWORKING_FIXTURE,
        durationMinutes: 8,
        level: "intermediate",
        objective: "Especificar la recuperación conservadora de bloqueos abandonados.",
        provider: "demo",
      })),
    });
    const lockPath = path.join(root, ".locks", `lesson-${lesson.id}`);
    await mkdir(lockPath, { recursive: true });
    const abandonedAt = new Date(Date.now() - 60_000);
    await utimes(lockPath, abandonedAt, abandonedAt);
    const updated = {
      ...lesson,
      revision: lesson.revision + 1,
      updatedAt: new Date().toISOString(),
      progress: { ...lesson.progress, activeChapterId: "chapter-2", updatedAt: new Date().toISOString() },
    };

    await repository.save(updated, lesson.revision);

    await expect(repository.get(lesson.id)).resolves.toMatchObject({
      revision: lesson.revision + 1,
      progress: { activeChapterId: "chapter-2" },
    });
  }, 5_000);
});
