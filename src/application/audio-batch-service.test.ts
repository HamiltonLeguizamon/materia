import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NETWORKING_TEACHING_PLAN } from "@/adapters/demo/demo-providers";
import { FileAudioBatchJobRepository, FileAudioJobRepository, FileCourseRepository, FileOperationRepository } from "@/adapters/persistence/file-course-repository";
import { FileLessonRepository } from "@/adapters/persistence/file-lesson-repository";
import { FileAudioAdmissionCoordinator } from "@/adapters/persistence/file-audio-admission-coordinator";
import { AudioBatchService } from "@/application/audio-batch-service";
import { LessonContentService } from "@/application/lesson-content-service";
import { SelectiveAudioService } from "@/application/selective-audio-service";
import type { SpeechProvider } from "@/application/ports";
import type { Course } from "@/domain/course";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))); });

describe("audio batch service", () => {
  it("generates an entire course strictly sequentially", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-batch-")); roots.push(root);
    const lessons = new FileLessonRepository(root), courses = new FileCourseRepository(root), content = new LessonContentService(lessons);
    const courseId = "33333333-3333-4333-8333-333333333333";
    const sourceIds = NETWORKING_TEACHING_PLAN.references.map((item) => item.id);
    const first = await content.createImported({ courseId, sourceIds, durationMinutes: 8, level: "intermediate", objective: "Primera lección completa para probar una cola secuencial.", plan: NETWORKING_TEACHING_PLAN });
    const second = await content.createImported({ courseId, sourceIds, durationMinutes: 8, level: "intermediate", objective: "Segunda lección completa para probar una cola secuencial.", plan: { ...NETWORKING_TEACHING_PLAN, title: "Segunda lección" } });
    const now = new Date().toISOString();
    await courses.create({ schemaVersion: 1, id: courseId, revision: 1, status: "published", title: "Curso completo", summary: "Curso suficiente para validar la generación secuencial de todos sus capítulos.", certification: null, level: "intermediate", language: "es-ES", sources: [], objectives: [], modules: [{ id: "module", title: "Módulo", summary: "Módulo de prueba para la cola de generación secuencial.", position: 1, lessonIds: [first.id, second.id] }], assessments: [], coverage: [], createdAt: now, updatedAt: now, validatedAt: now, publishedAt: now } as Course);
    let concurrent = 0, maximum = 0;
    const speech: SpeechProvider = { profileKey: "test", profile: { provider: "kokoro", nodeId: "test", voice: "voice", speed: 1, language: "es", style: "neutral", pronunciation: "literal" }, synthesize: vi.fn(async () => { concurrent += 1; maximum = Math.max(maximum, concurrent); await new Promise((resolve) => setTimeout(resolve, 2)); concurrent -= 1; return { kind: "browser-speech" as const, mimeType: "application/x-browser-speech" as const }; }) };
    const selective = new SelectiveAudioService(lessons, new FileAudioJobRepository(root), new FileOperationRepository(root), () => speech);
    const batches = new AudioBatchService(courses, lessons, new FileAudioBatchJobRepository(root), selective);
    const started = await batches.startCourse({ courseId, expectedRevision: 1, confirmed: true, provider: "kokoro", profile: speech.profile });
    const completed = await batches.waitForJob(started.id);
    expect(completed).toMatchObject({ state: "completed", totalChapters: 8, completedChapters: 8 });
    expect(maximum).toBe(1);
    expect(speech.synthesize).toHaveBeenCalledTimes(8);
  });

  it("rejects an overlapping chapter from another instance while the batch holds its reservation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-batch-admission-")); roots.push(root);
    const lessons = new FileLessonRepository(root), courses = new FileCourseRepository(root), content = new LessonContentService(lessons);
    const lesson = await content.createImported({ courseId: "33333333-3333-4333-8333-333333333333", sourceIds: NETWORKING_TEACHING_PLAN.references.map((item) => item.id), durationMinutes: 8, level: "intermediate", objective: "Evitar trabajos de audio solapados sobre una lección.", plan: NETWORKING_TEACHING_PLAN });
    let synthesisStarted!: () => void;
    let finishSynthesis!: () => void;
    const started = new Promise<void>((resolve) => { synthesisStarted = resolve; });
    const finish = new Promise<void>((resolve) => { finishSynthesis = resolve; });
    const speech: SpeechProvider = { profileKey: "test", profile: { provider: "demo", nodeId: null, voice: "browser-default", speed: 1, language: "es", style: "neutral", pronunciation: "literal" }, synthesize: vi.fn(async () => { synthesisStarted(); await finish; return { kind: "browser-speech" as const, mimeType: "application/x-browser-speech" as const }; }) };
    const firstSelective = new SelectiveAudioService(lessons, new FileAudioJobRepository(root), new FileOperationRepository(root), () => speech, undefined, new FileAudioAdmissionCoordinator(root));
    const secondSelective = new SelectiveAudioService(lessons, new FileAudioJobRepository(root), new FileOperationRepository(root), () => speech, undefined, new FileAudioAdmissionCoordinator(root));
    const batches = new AudioBatchService(courses, lessons, new FileAudioBatchJobRepository(root), firstSelective);

    const batch = await batches.startLesson({ lessonId: lesson.id, confirmed: true, provider: "demo", profile: speech.profile });
    await started;
    await expect(secondSelective.start({ operationId: "overlapping-chapter", lessonId: lesson.id, expectedLessonRevision: lesson.revision, chapterIds: ["chapter-2"], confirmed: true, provider: "demo", profile: speech.profile })).rejects.toThrow(/audio operation is already active/);
    finishSynthesis();
    const completed = await batches.waitForJob(batch.id);
    expect(completed?.state).toBe("completed");
  });

  it("does not persist a batch when the provider is unavailable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-batch-provider-")); roots.push(root);
    const lessons = new FileLessonRepository(root);
    const lesson = await new LessonContentService(lessons).createImported({ courseId: "33333333-3333-4333-8333-333333333333", sourceIds: NETWORKING_TEACHING_PLAN.references.map((item) => item.id), durationMinutes: 8, level: "intermediate", objective: "Rechazar proveedores no disponibles antes de crear la cola.", plan: NETWORKING_TEACHING_PLAN });
    const speech: SpeechProvider = { profileKey: "openai:test", profile: { provider: "openai", nodeId: null, voice: "coral", speed: 1, language: "es", style: "serious", pronunciation: "literal" }, synthesize: vi.fn() };
    const save = vi.fn();
    const selective = new SelectiveAudioService(lessons, new FileAudioJobRepository(root), new FileOperationRepository(root), () => speech, undefined, new FileAudioAdmissionCoordinator(root), async () => { throw new Error("OpenAI no está configurada en el proceso servidor."); });
    const batches = new AudioBatchService(new FileCourseRepository(root), lessons, { get: async () => null, save }, selective);

    await expect(batches.startLesson({ lessonId: lesson.id, confirmed: true, provider: "openai", profile: speech.profile })).rejects.toThrow(/no está configurada/);
    expect(save).not.toHaveBeenCalled();
  });
});
