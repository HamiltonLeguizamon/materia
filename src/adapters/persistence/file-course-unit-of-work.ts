import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { materiaDataRoot } from "@/config/environment";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import { FileCourseRepository } from "@/adapters/persistence/file-course-repository";
import { FileLessonRepository } from "@/adapters/persistence/file-lesson-repository";
import { removeDurable, withFileLease, writeDurableJson } from "@/adapters/persistence/file-system-utils";
import type { CourseCleanupRepository, CoursePersistenceUnitOfWork } from "@/application/ports";
import { courseSchema } from "@/domain/course";
import { lessonSchema } from "@/domain/teaching";

const journalSchema = z.discriminatedUnion("kind", [
  z.object({
    schemaVersion: z.literal(1), id: z.string().uuid(), kind: z.literal("course-lesson-upsert"), state: z.enum(["prepared", "committed"]),
    operationId: z.string().min(1), beforeCourse: courseSchema, afterCourse: courseSchema, beforeLesson: lessonSchema.nullable(), afterLesson: lessonSchema,
    preparedAt: z.string().datetime(), committedAt: z.string().datetime().nullable(),
  }),
  z.object({
    schemaVersion: z.literal(1), id: z.string().uuid(), kind: z.literal("course-delete"), state: z.enum(["prepared", "committed"]),
    course: courseSchema, lessons: z.array(lessonSchema), preparedAt: z.string().datetime(), committedAt: z.string().datetime().nullable(),
  }),
]);
type Journal = z.infer<typeof journalSchema>;

export class FileCoursePersistenceUnitOfWork implements CoursePersistenceUnitOfWork {
  private readonly recovery: Promise<void>;

  constructor(
    private readonly courses: FileCourseRepository,
    private readonly lessons: FileLessonRepository,
    private readonly root = materiaDataRoot(),
    private readonly cleanup?: CourseCleanupRepository,
  ) { this.recovery = this.recoverOnce(); }

  async saveCourseAndLesson(input: Parameters<CoursePersistenceUnitOfWork["saveCourseAndLesson"]>[0]): Promise<void> {
    await this.recover();
    await withFileLease(this.root, `unit-course-${input.afterCourse.id}`, async () => {
      const record: Journal = journalSchema.parse({
        schemaVersion: 1, id: randomUUID(), kind: "course-lesson-upsert", state: "prepared", ...input,
        preparedAt: new Date().toISOString(), committedAt: null,
      });
      const journalPath = this.journalPath(record.id, input.operationId);
      await writeDurableJson(journalPath, record);
      try {
        await this.lessons.save(input.afterLesson, input.beforeLesson?.revision, { pruneAudio: false });
        await this.courses.save(input.afterCourse, input.beforeCourse.revision);
      } catch (error) {
        await this.lessons.restore(input.afterLesson.id, input.beforeLesson);
        await this.courses.restore(input.beforeCourse);
        await removeDurable(journalPath);
        throw error;
      }
      await this.commitAndRemove(journalPath, record);
      try { await this.lessons.pruneAudio(input.afterLesson); }
      catch (error) { console.warn(`[persistence] could not remove orphaned audio after committing ${input.operationId}: ${error instanceof Error ? error.message : "unknown error"}`); }
    });
  }

  async deleteCourse(input: Parameters<CoursePersistenceUnitOfWork["deleteCourse"]>[0]): Promise<void> {
    await this.recover();
    await withFileLease(this.root, `unit-course-${input.course.id}`, async () => {
      const record: Journal = journalSchema.parse({ schemaVersion: 1, id: randomUUID(), kind: "course-delete", state: "prepared", course: input.course, lessons: input.lessons, preparedAt: new Date().toISOString(), committedAt: null });
      if (record.kind !== "course-delete") throw new Error("The deletion journal is invalid.");
      const journalPath = this.journalPath(record.id, `delete-${input.course.id}`);
      await writeDurableJson(journalPath, record);
      await this.finishDeletion(record, input.cleanup);
      await this.commitAndRemove(journalPath, record);
    });
  }

  async recover(): Promise<void> {
    return this.recovery;
  }

  private async recoverOnce(): Promise<void> {
    await mkdir(this.directory(), { recursive: true, mode: 0o700 });
    const names = (await readdir(this.directory())).filter((name) => name.endsWith(".json"));
    for (const name of names) {
      const journalPath = path.join(this.directory(), name);
      const parsed = journalSchema.safeParse(JSON.parse(await readFile(journalPath, "utf8")));
      if (!parsed.success) throw new Error(`Invalid recovery journal: ${parsed.error.issues[0]?.message || "unknown schema"}.`);
      const record = parsed.data;
      if (record.state === "committed") { await removeDurable(journalPath); continue; }
      if (record.kind === "course-delete") await this.finishDeletion(record);
      else {
        const currentCourse = await this.courses.get(record.afterCourse.id);
        const currentLesson = await this.lessons.get(record.afterLesson.id);
        const courseIsBefore = isDeepStrictEqual(currentCourse, record.beforeCourse);
        const courseIsAfter = isDeepStrictEqual(currentCourse, record.afterCourse);
        const lessonIsBefore = isDeepStrictEqual(currentLesson, record.beforeLesson);
        const lessonIsAfter = isDeepStrictEqual(currentLesson, record.afterLesson);
        const bothApplied = courseIsAfter && lessonIsAfter;
        if (!bothApplied) {
          if ((!courseIsBefore && !courseIsAfter) || (!lessonIsBefore && !lessonIsAfter)) {
            throw new Error(`Journal ${record.id} conflicts with later revisions; no data was overwritten.`);
          }
          await this.lessons.restore(record.afterLesson.id, record.beforeLesson);
          await this.courses.restore(record.beforeCourse);
        }
      }
      await removeDurable(journalPath);
    }
  }

  private async finishDeletion(record: Extract<Journal, { kind: "course-delete" }>, cleanup?: Parameters<CoursePersistenceUnitOfWork["deleteCourse"]>[0]["cleanup"]): Promise<void> {
    for (const lesson of record.lessons) await this.lessons.delete(lesson.id);
    await (cleanup || this.cleanup)?.deleteRelated(record.course.id, record.lessons.map((lesson) => lesson.id));
    await this.courses.delete(record.course.id);
  }

  private async commitAndRemove(journalPath: string, record: Journal): Promise<void> {
    await writeDurableJson(journalPath, { ...record, state: "committed", committedAt: new Date().toISOString() });
    await removeDurable(journalPath);
  }

  private directory() { return path.join(this.root, "journal"); }
  private journalPath(id: string, operationId: string) {
    const fingerprint = createHash("sha256").update(operationId).digest("hex").slice(0, 12);
    return path.join(this.directory(), `${fingerprint}-${id}.json`);
  }
}
