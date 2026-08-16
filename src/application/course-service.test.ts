import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { NETWORKING_TEACHING_PLAN } from "@/adapters/demo/demo-providers";
import { FileCourseRepository, FileOperationRepository } from "@/adapters/persistence/file-course-repository";
import { FileLessonRepository } from "@/adapters/persistence/file-lesson-repository";
import { CourseService } from "@/application/course-service";
import type { CourseRepository } from "@/application/ports";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))); });

describe("course service", () => {
  it("normalizes a historical course language alias before importing lessons", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-course-language-")); roots.push(root);
    const service = new CourseService(new FileCourseRepository(root), new FileLessonRepository(root), new FileOperationRepository(root));
    const created = await service.createCourse({
      operationId: "language-create", title: "Spanish course",
      summary: "A course that verifies canonical language propagation into imported lessons.",
      level: "beginner", language: "es",
    });
    expect(created.course.language).toBe("es-ES");

    const sources = NETWORKING_TEACHING_PLAN.references.map((reference) => ({
      id: reference.id, title: reference.label, url: `https://example.com/${reference.id}`,
      publisher: "Example", retrievedAt: "2026-08-12T12:00:00.000Z", excerpt: reference.excerpt, locator: reference.label,
    }));
    const foundation = await service.upsertFoundation({
      operationId: "language-foundation", courseId: created.course.id, expectedRevision: created.course.revision,
      sources, objectives: [{ id: "objective-1", title: "Understand canonical language propagation", weightMinPercent: null, weightMaxPercent: null, sourceIds: [sources[0].id] }],
      coverage: [{ objectiveId: "objective-1", status: "missing", lessonIds: [], assessmentIds: [], note: "Not authored yet." }],
    });
    const moduleResult = await service.upsertModule({
      operationId: "language-module", courseId: created.course.id, expectedRevision: foundation.course.revision,
      module: { id: "language", title: "Language handling", summary: "A module used to verify the canonical content-language contract.", position: 1, lessonIds: [] },
    });
    const lessonResult = await service.upsertLesson({
      operationId: "language-lesson", courseId: created.course.id, moduleId: "language", expectedRevision: moduleResult.course.revision,
      sourceIds: sources.map((source) => source.id), durationMinutes: 8, level: "beginner",
      objective: "Understand how a course language reaches every imported lesson.", plan: NETWORKING_TEACHING_PLAN,
    });
    expect(lessonResult.lesson.preferences.contentLanguage).toBe("es-ES");
  });

  it("idempotently builds a two-lesson course without generating audio", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-course-")); roots.push(root);
    const service = new CourseService(new FileCourseRepository(root), new FileLessonRepository(root), new FileOperationRepository(root));
    const creation = {
      operationId: "gh600-create", title: "GitHub Certified: Agentic AI Developer",
      summary: "Preparación trazable para los dominios oficiales del examen GH-600.",
      certification: { name: "GitHub Certified: Agentic AI Developer", examCode: "GH-600", url: "https://learn.microsoft.com/en-us/credentials/certifications/agentic-ai-developer/" },
      level: "intermediate" as const, language: "es-ES",
    };
    const created = await service.createCourse(creation);
    const replay = await service.createCourse(creation);
    expect(replay.reused).toBe(true);
    expect(replay.course.id).toBe(created.course.id);

    const sources = NETWORKING_TEACHING_PLAN.references.map((reference) => ({
      id: reference.id, title: reference.label, url: `https://learn.microsoft.com/training/${reference.id}`,
      publisher: "Microsoft Learn", retrievedAt: "2026-08-12T12:00:00.000Z", excerpt: reference.excerpt, locator: reference.label,
    }));
    const objective = { id: "domain-1", title: "Preparar la arquitectura del agente y los procesos del SDLC", weightMinPercent: 15, weightMaxPercent: 20, sourceIds: ["source-1"] };
    let result = await service.upsertFoundation({ operationId: "gh600-foundation", courseId: created.course.id, expectedRevision: 1, sources, objectives: [objective], coverage: [{ objectiveId: "domain-1", status: "missing", lessonIds: [], assessmentIds: [], note: "Pendiente." }] });
    result = await service.upsertModule({ operationId: "gh600-module", courseId: created.course.id, expectedRevision: result.course.revision, module: { id: "architecture", title: "Arquitectura y SDLC", summary: "Diseño, límites y supervisión de agentes dentro del ciclo de desarrollo.", position: 1, lessonIds: [] } });

    const first = await service.upsertLesson({ operationId: "gh600-lesson-1", courseId: created.course.id, moduleId: "architecture", expectedRevision: result.course.revision, sourceIds: sources.map((item) => item.id), durationMinutes: 8, level: "intermediate", objective: "Comprender la arquitectura de un agente y sus límites de ejecución.", plan: NETWORKING_TEACHING_PLAN });
    const second = await service.upsertLesson({ operationId: "gh600-lesson-2", courseId: created.course.id, moduleId: "architecture", expectedRevision: first.course.revision, sourceIds: sources.map((item) => item.id), durationMinutes: 8, level: "intermediate", objective: "Aplicar controles seguros dentro del ciclo de desarrollo de software.", plan: { ...NETWORKING_TEACHING_PLAN, title: "Controles seguros para agentes" } });
    expect(Object.values(first.lesson.audioByChapter).every((audio) => audio.status === "pending")).toBe(true);
    expect(first.lesson.planProvider).toBe("agent");

    const revisedPlan = structuredClone(NETWORKING_TEACHING_PLAN);
    revisedPlan.title = "Arquitectura revisada de agentes";
    revisedPlan.chapters[0].blocks[0].content = `${revisedPlan.chapters[0].blocks[0].content} Esta ampliación cambia únicamente el primer capítulo y debe invalidar solo su audio.`;
    const revised = await service.upsertLesson({ operationId: "gh600-lesson-1-revise", courseId: created.course.id, moduleId: "architecture", expectedRevision: second.course.revision, lessonId: first.lesson.id, expectedLessonRevision: first.lesson.revision, sourceIds: sources.map((item) => item.id), durationMinutes: 8, level: "intermediate", objective: "Comprender la arquitectura revisada de un agente y sus límites de ejecución.", plan: revisedPlan });
    expect(revised.lesson.id).toBe(first.lesson.id);
    expect(revised.lesson.revision).toBe(first.lesson.revision + 1);
    expect(revised.course.modules[0].lessonIds).toHaveLength(2);

    const assessment = { id: "architecture-check", moduleId: "architecture", title: "Evaluación de arquitectura", questions: [{ id: "architecture-q1", type: "scenario-single-choice" as const, prompt: "Un agente necesita modificar código de forma autónoma. ¿Qué límite debe definirse primero?", options: ["Repositorio, rama, herramientas y permisos autorizados.", "Una voz más natural para explicar los cambios."], expectedOption: 0, explanation: "El contexto de ejecución limita dónde actúa el agente y qué operaciones puede realizar.", objectiveIds: ["domain-1"], sourceIds: ["source-1"] }] };
    result = await service.upsertAssessment({ operationId: "gh600-assessment", courseId: created.course.id, expectedRevision: revised.course.revision, assessment });
    const obsoleteAssessment = { ...assessment, id: "architecture-check-obsolete", title: "Evaluación obsoleta" };
    result = await service.upsertAssessment({ operationId: "gh600-assessment-obsolete", courseId: created.course.id, expectedRevision: result.course.revision, assessment: obsoleteAssessment });
    await expect(service.deleteAssessment({ operationId: "gh600-assessment-delete-rejected", courseId: created.course.id, expectedRevision: result.course.revision, assessmentId: obsoleteAssessment.id, confirmed: false })).rejects.toThrow(/explicit confirmation/);
    result = await service.deleteAssessment({ operationId: "gh600-assessment-delete", courseId: created.course.id, expectedRevision: result.course.revision, assessmentId: obsoleteAssessment.id, confirmed: true });
    expect(result.course.assessments.map((item) => item.id)).toEqual([assessment.id]);
    result = await service.upsertFoundation({ operationId: "gh600-coverage", courseId: created.course.id, expectedRevision: result.course.revision, sources, objectives: [objective], coverage: [{ objectiveId: "domain-1", status: "covered", lessonIds: [first.lesson.id, second.lesson.id], assessmentIds: [assessment.id], note: "Dos lecciones y una evaluación." }] });

    const validation = await service.validateCourse(created.course.id);
    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "dominant-block-shape", severity: "warning" })]));
    const validated = await service.markValidated({ operationId: "gh600-validate", courseId: created.course.id, expectedRevision: result.course.revision });
    await expect(service.publish({ operationId: "gh600-publish-rejected", courseId: created.course.id, expectedRevision: validated.course.revision, confirmed: false })).rejects.toThrow(/explicit confirmation/);
    await expect(service.getCourse(created.course.id)).resolves.toMatchObject({ status: "validated", revision: validated.course.revision, publishedAt: null });
    const published = await service.publish({ operationId: "gh600-publish", courseId: created.course.id, expectedRevision: validated.course.revision, confirmed: true });
    expect(published.course.status).toBe("published");
    expect(published.course.modules[0].lessonIds).toEqual([first.lesson.id, second.lesson.id]);
    await expect(service.deleteStandaloneLesson(first.lesson.id)).rejects.toThrow(/belongs to a course/);
    await expect(service.getLesson(first.lesson.id)).resolves.toMatchObject({ id: first.lesson.id });
    await expect(service.upsertModule({ operationId: "stale-update", courseId: created.course.id, expectedRevision: 1, module: published.course.modules[0] })).rejects.toThrow(/Revision conflict/);
    const draftRevision = await service.upsertLesson({ operationId: "gh600-lesson-1-after-publication", courseId: created.course.id, moduleId: "architecture", expectedRevision: published.course.revision, lessonId: first.lesson.id, expectedLessonRevision: revised.lesson.revision, sourceIds: sources.map((item) => item.id), durationMinutes: 8, level: "intermediate", objective: "Reconstruir una lección publicada para una nueva revisión editorial.", plan: revisedPlan });
    expect(draftRevision.course).toMatchObject({ status: "draft", publishedAt: null });
    await expect(service.deleteCourse({ courseId: created.course.id, expectedRevision: draftRevision.course.revision, confirmed: false })).rejects.toThrow(/confirmation/);
    await expect(service.deleteCourse({ courseId: created.course.id, expectedRevision: draftRevision.course.revision, confirmed: true })).resolves.toEqual({ deleted: true, lessonCount: 2 });
    await expect(service.getCourse(created.course.id)).resolves.toBeNull();
    await expect(new FileLessonRepository(root).get(first.lesson.id)).resolves.toBeNull();
  });

  it("rolls back the lesson when saving the course revision fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-course-fault-")); roots.push(root);
    const courses = new FileCourseRepository(root);
    const lessons = new FileLessonRepository(root);
    const operations = new FileOperationRepository(root);
    const service = new CourseService(courses, lessons, operations);
    const created = await service.createCourse({
      operationId: "fault-create",
      title: "Curso para inyección de fallos",
      summary: "Curso temporal que especifica la atomicidad entre curso y lección.",
      level: "intermediate",
    });
    const sources = NETWORKING_TEACHING_PLAN.references.map((reference) => ({
      id: reference.id,
      title: reference.label,
      url: `https://learn.microsoft.com/training/${reference.id}`,
      publisher: "Microsoft Learn",
      retrievedAt: "2026-08-15T00:00:00.000Z",
      excerpt: reference.excerpt,
      locator: reference.label,
    }));
    const foundation = await service.upsertFoundation({
      operationId: "fault-foundation",
      courseId: created.course.id,
      expectedRevision: created.course.revision,
      sources,
      objectives: [],
      coverage: [],
    });
    const moduleResult = await service.upsertModule({
      operationId: "fault-module",
      courseId: created.course.id,
      expectedRevision: foundation.course.revision,
      module: {
        id: "fault-module",
        title: "Módulo de recuperación",
        summary: "Módulo temporal para verificar una escritura interrumpida.",
        position: 1,
        lessonIds: [],
      },
    });
    const failingCourses: CourseRepository = {
      list: () => courses.list(),
      get: (id) => courses.get(id),
      create: (course) => courses.create(course),
      save: async () => { throw new Error("fallo inyectado después de guardar la lección"); },
      delete: (id) => courses.delete(id),
    };
    const failingService = new CourseService(failingCourses, lessons, operations);

    await expect(failingService.upsertLesson({
      operationId: "fault-upsert-lesson",
      courseId: created.course.id,
      moduleId: "fault-module",
      expectedRevision: moduleResult.course.revision,
      sourceIds: sources.map((source) => source.id),
      durationMinutes: 8,
      level: "intermediate",
      objective: "Probar que una lección no queda separada de la revisión del curso.",
      plan: NETWORKING_TEACHING_PLAN,
    })).rejects.toThrow(/fallo inyectado/);

    expect(await lessons.list()).toHaveLength(0);
    await expect(courses.get(created.course.id)).resolves.toMatchObject({
      revision: moduleResult.course.revision,
      modules: [expect.objectContaining({ id: "fault-module", lessonIds: [] })],
    });
  });
});
