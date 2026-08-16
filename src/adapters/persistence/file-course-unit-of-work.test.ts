import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { NETWORKING_TEACHING_PLAN } from "@/adapters/demo/demo-providers";
import { FileCourseRepository } from "@/adapters/persistence/file-course-repository";
import { FileCoursePersistenceUnitOfWork } from "@/adapters/persistence/file-course-unit-of-work";
import { FileLessonRepository } from "@/adapters/persistence/file-lesson-repository";
import { LessonContentService } from "@/application/lesson-content-service";
import { courseSchema, type Course } from "@/domain/course";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))); });

describe("file course persistence unit of work", () => {
  it("commits course and lesson and removes the bounded journal", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-uow-")); roots.push(root);
    const courses = new FileCourseRepository(root);
    const lessons = new FileLessonRepository(root);
    const beforeCourse = course();
    await courses.create(beforeCourse);
    const afterLesson = lesson(lessons, beforeCourse.id);
    const afterCourse = withLesson(beforeCourse, afterLesson.id);

    await new FileCoursePersistenceUnitOfWork(courses, lessons, root).saveCourseAndLesson({
      operationId: "uow-normal", beforeCourse, afterCourse, beforeLesson: null, afterLesson,
    });

    await expect(courses.get(beforeCourse.id)).resolves.toMatchObject({ revision: 2, status: "draft" });
    await expect(lessons.get(afterLesson.id)).resolves.toMatchObject({ revision: 1 });
    await expect(readdir(path.join(root, "journal"))).resolves.toEqual([]);
  });

  it("rolls back an orphaned lesson when recovering a prepared journal", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-uow-recovery-")); roots.push(root);
    const courses = new FileCourseRepository(root);
    const lessons = new FileLessonRepository(root);
    const beforeCourse = course();
    await courses.create(beforeCourse);
    const afterLesson = lesson(lessons, beforeCourse.id);
    const afterCourse = withLesson(beforeCourse, afterLesson.id);
    await lessons.save(afterLesson);
    const directory = path.join(root, "journal");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "partial.json"), `${JSON.stringify({
      schemaVersion: 1, id: "56565656-5656-4565-8565-565656565656", kind: "course-lesson-upsert", state: "prepared", operationId: "partial-upsert",
      beforeCourse, afterCourse, beforeLesson: null, afterLesson, preparedAt: new Date().toISOString(), committedAt: null,
    }, null, 2)}\n`);

    await new FileCoursePersistenceUnitOfWork(courses, lessons, root).recover();

    await expect(lessons.get(afterLesson.id)).resolves.toBeNull();
    await expect(courses.get(beforeCourse.id)).resolves.toMatchObject({ revision: 1, modules: [] });
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it("rolls forward a confirmed deletion left in prepared state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "materia-uow-delete-")); roots.push(root);
    const courses = new FileCourseRepository(root);
    const lessons = new FileLessonRepository(root);
    const base = course();
    const ownedLesson = lesson(lessons, base.id);
    const persistedCourse = withLesson(base, ownedLesson.id);
    await courses.create(persistedCourse);
    await lessons.save(ownedLesson);
    const directory = path.join(root, "journal");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "delete.json"), `${JSON.stringify({
      schemaVersion: 1, id: "78787878-7878-4787-8787-787878787878", kind: "course-delete", state: "prepared",
      course: persistedCourse, lessons: [ownedLesson], preparedAt: new Date().toISOString(), committedAt: null,
    }, null, 2)}\n`);

    await new FileCoursePersistenceUnitOfWork(courses, lessons, root).recover();

    await expect(courses.get(base.id)).resolves.toBeNull();
    await expect(lessons.get(ownedLesson.id)).resolves.toBeNull();
    await expect(readdir(directory)).resolves.toEqual([]);
  });
});

function course(): Course {
  const now = new Date().toISOString();
  return courseSchema.parse({
    schemaVersion: 1, id: "45454545-4545-4454-8454-454545454545", revision: 1, status: "draft", title: "Curso de recuperación",
    summary: "Curso temporal para probar el diario de recuperación.", certification: null, level: "intermediate", language: "es-ES",
    sources: [], objectives: [], modules: [], assessments: [], coverage: [], createdAt: now, updatedAt: now, validatedAt: null, publishedAt: null,
  });
}

function lesson(repository: FileLessonRepository, courseId: string) {
  return new LessonContentService(repository).buildImported({
    id: "67676767-6767-4676-8676-676767676767", courseId, sourceIds: ["source-1"], durationMinutes: 8, level: "intermediate",
    objective: "Probar una unidad de trabajo recuperable.", plan: NETWORKING_TEACHING_PLAN,
  });
}

function withLesson(before: Course, lessonId: string): Course {
  return courseSchema.parse({
    ...before, revision: before.revision + 1, updatedAt: new Date().toISOString(),
    modules: [{ id: "recovery", title: "Recuperación", summary: "Prueba del diario local.", position: 1, lessonIds: [lessonId] }],
  });
}
