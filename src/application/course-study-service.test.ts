import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FileCourseProgressRepository, FileCourseRepository, FileOperationRepository } from "@/adapters/persistence/file-course-repository";
import { FileLessonRepository } from "@/adapters/persistence/file-lesson-repository";
import { CourseService } from "@/application/course-service";
import { CourseStudyService } from "@/application/course-study-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))));

describe("CourseStudyService", () => {
  it("persists answers without modifying the course or using providers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-study-")); roots.push(root);
    const courses = new FileCourseRepository(root);
    const authoring = new CourseService(courses, new FileLessonRepository(root), new FileOperationRepository(root));
    const created = await authoring.createCourse({ operationId: "study-create", title: "Curso evaluable", summary: "Curso local para demostrar evaluación determinista y persistente.", level: "intermediate" });
    expect(created.course.language).toBe("en-US");
    const withModule = await authoring.upsertModule({ operationId: "study-module", courseId: created.course.id, expectedRevision: 1, module: { id: "module-1", title: "Primer módulo", summary: "Un módulo suficiente para asociar una evaluación local.", position: 1, lessonIds: [] } });
    const withAssessment = await authoring.upsertAssessment({ operationId: "study-assessment", courseId: created.course.id, expectedRevision: withModule.course.revision, assessment: { id: "assessment-1", moduleId: "module-1", title: "Comprobación", questions: [{ id: "question-1", type: "single-choice", prompt: "¿Qué operación no debe invocar un modelo de inteligencia artificial?", options: ["Guardar una respuesta local", "Generar voz"], expectedOption: 0, explanation: "El progreso se guarda localmente y no necesita generación.", objectiveIds: ["objective-1"], sourceIds: ["source-1"] }] } }).catch(async () => {
      const foundation = await authoring.upsertFoundation({ operationId: "study-foundation", courseId: created.course.id, expectedRevision: withModule.course.revision, sources: [{ id: "source-1", title: "Fuente pública", url: "https://example.com/source", publisher: "Example", retrievedAt: new Date().toISOString(), excerpt: "Una fuente pública suficientemente descriptiva.", locator: null }], objectives: [{ id: "objective-1", title: "Distinguir operaciones locales de generación remota", weightMinPercent: null, weightMaxPercent: null, sourceIds: ["source-1"] }], coverage: [{ objectiveId: "objective-1", status: "missing", lessonIds: [], assessmentIds: [], note: "Pendiente." }] });
      return authoring.upsertAssessment({ operationId: "study-assessment", courseId: created.course.id, expectedRevision: foundation.course.revision, assessment: { id: "assessment-1", moduleId: "module-1", title: "Comprobación", questions: [{ id: "question-1", type: "single-choice", prompt: "¿Qué operación no debe invocar un modelo de inteligencia artificial?", options: ["Guardar una respuesta local", "Generar voz"], expectedOption: 0, explanation: "El progreso se guarda localmente y no necesita generación.", objectiveIds: ["objective-1"], sourceIds: ["source-1"] }] } });
    });
    const study = new CourseStudyService(courses, new FileCourseProgressRepository(root));
    const response = await study.answer({ courseId: created.course.id, assessmentId: "assessment-1", questionId: "question-1", option: 0, expectedRevision: 1 });
    expect(response.result.correct).toBe(true);
    expect((await study.getProgress(created.course.id)).answers["question-1"].option).toBe(0);
    const concurrent = await Promise.allSettled([
      study.answer({ courseId: created.course.id, assessmentId: "assessment-1", questionId: "question-1", option: 0, expectedRevision: response.progress.revision }),
      study.answer({ courseId: created.course.id, assessmentId: "assessment-1", questionId: "question-1", option: 1, expectedRevision: response.progress.revision }),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(concurrent.find((result) => result.status === "rejected")).toMatchObject({ reason: expect.objectContaining({ message: expect.stringMatching(/Revision conflict/) }) });
    expect((await study.getProgress(created.course.id)).revision).toBe(response.progress.revision + 1);
    expect((await courses.get(created.course.id))?.revision).toBe(withAssessment.course.revision);
  });
});
