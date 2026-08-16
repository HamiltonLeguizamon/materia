import { createHash, randomUUID } from "node:crypto";

import type { CourseCleanupRepository, CoursePersistenceUnitOfWork, CourseRepository, LessonRepository, OperationRepository } from "@/application/ports";
import { LessonContentService } from "@/application/lesson-content-service";
import {
  courseAssessmentSchema,
  courseModuleSchema,
  courseSchema,
  courseSourceSchema,
  coverageEntrySchema,
  learningObjectiveSchema,
  type Course,
  type CourseAssessment,
  type CourseModule,
  type CourseSource,
  type CourseValidationIssue,
  type CoverageEntry,
  type LearningObjective,
} from "@/domain/course";
import { inspectTeachingPlanQuality, lessonDurationSchema, lessonLevelSchema, teachingPlanSchema, type Lesson, type TeachingPlan } from "@/domain/teaching";

export type CourseValidation = { valid: boolean; issues: CourseValidationIssue[] };
export type CourseMutationResult = { course: Course; reused: boolean };

export class CourseService {
  private readonly lessonContent: LessonContentService;

  constructor(
    private readonly courses: CourseRepository,
    private readonly lessons: LessonRepository,
    private readonly operations: OperationRepository,
    private readonly cleanup?: CourseCleanupRepository,
    private readonly unitOfWork?: CoursePersistenceUnitOfWork,
  ) {
    this.lessonContent = new LessonContentService(lessons);
  }

  async listCourses(): Promise<Course[]> { await this.unitOfWork?.recover(); return this.courses.list(); }
  async getCourse(id: string): Promise<Course | null> { await this.unitOfWork?.recover(); return this.courses.get(id); }
  async getLesson(id: string): Promise<Lesson | null> { await this.unitOfWork?.recover(); return this.lessons.get(id); }

  async deleteStandaloneLesson(lessonId: string): Promise<boolean> {
    await this.unitOfWork?.recover();
    const lesson = await this.lessons.get(lessonId);
    if (!lesson) return false;
    if (lesson.source.kind === "course-sources") {
      throw new Error("This lesson belongs to a course. Remove it through course editing or delete the entire course.");
    }
    return this.lessons.delete(lessonId);
  }

  async deleteCourse(input: { courseId: string; expectedRevision: number; confirmed: boolean }): Promise<{ deleted: true; lessonCount: number }> {
    if (!input.confirmed) throw new Error("Deleting the course requires explicit confirmation.");
    const course = await this.requireCourse(input.courseId);
    this.assertRevision(course, input.expectedRevision);
    const lessonIds = [...new Set(course.modules.flatMap((module) => module.lessonIds))];
    const ownedLessons: Lesson[] = [];
    for (const lessonId of lessonIds) {
      const lesson = await this.lessons.get(lessonId);
      if (lesson?.source.kind === "course-sources" && lesson.source.courseId === course.id) ownedLessons.push(lesson);
    }
    if (this.unitOfWork) await this.unitOfWork.deleteCourse({ course, lessons: ownedLessons, cleanup: this.cleanup });
    else {
      for (const lesson of ownedLessons) await this.lessons.delete(lesson.id);
      await this.cleanup?.deleteRelated(course.id, lessonIds);
      if (!(await this.courses.delete(course.id))) throw new Error("The course no longer exists.");
    }
    return { deleted: true, lessonCount: lessonIds.length };
  }

  async createCourse(input: {
    operationId: string;
    title: string;
    summary: string;
    certification?: { name: string; examCode?: string | null; url?: string | null } | null;
    level: "beginner" | "intermediate" | "advanced";
    language?: string;
  }): Promise<CourseMutationResult> {
    return this.idempotent("create-course", input.operationId, input, async () => {
      const now = new Date().toISOString();
      const course = courseSchema.parse({
        schemaVersion: 1, id: randomUUID(), revision: 1, status: "draft",
        title: input.title, summary: input.summary, certification: input.certification || null,
        level: lessonLevelSchema.parse(input.level), language: input.language || "en-US",
        sources: [], objectives: [], modules: [], assessments: [], coverage: [],
        createdAt: now, updatedAt: now, validatedAt: null, publishedAt: null,
      });
      await this.courses.create(course);
      return course;
    });
  }

  async upsertFoundation(input: {
    operationId: string; courseId: string; expectedRevision: number;
    sources: CourseSource[]; objectives: LearningObjective[]; coverage: CoverageEntry[];
  }): Promise<CourseMutationResult> {
    return this.mutate("upsert-foundation", input, async (course) => ({
      ...course,
      sources: input.sources.map((item) => courseSourceSchema.parse(item)),
      objectives: input.objectives.map((item) => learningObjectiveSchema.parse(item)),
      coverage: input.coverage.map((item) => coverageEntrySchema.parse(item)),
      status: "draft", validatedAt: null, publishedAt: null,
    }));
  }

  async upsertModule(input: { operationId: string; courseId: string; expectedRevision: number; module: CourseModule }): Promise<CourseMutationResult> {
    return this.mutate("upsert-module", input, async (course) => ({
      ...course,
      modules: upsert(course.modules, courseModuleSchema.parse(input.module)),
      status: "draft", validatedAt: null, publishedAt: null,
    }));
  }

  async upsertLesson(input: {
    operationId: string; courseId: string; moduleId: string; expectedRevision: number;
    lessonId?: string; expectedLessonRevision?: number; sourceIds: string[]; durationMinutes: number; level: "beginner" | "intermediate" | "advanced";
    objective: string; plan: TeachingPlan;
  }): Promise<{ course: Course; lesson: Lesson; reused: boolean }> {
    const replay = await this.claim("upsert-lesson", input.operationId, input);
    if (replay) return replay as { course: Course; lesson: Lesson; reused: boolean };
    try {
      const course = await this.requireCourse(input.courseId);
      this.assertRevision(course, input.expectedRevision);
      const courseModule = course.modules.find((item) => item.id === input.moduleId);
      if (!courseModule) throw new Error("The module does not exist.");
      const knownSources = new Set(course.sources.map((item) => item.id));
      if (input.sourceIds.some((id) => !knownSources.has(id))) throw new Error("The lesson contains sources that do not belong to the course.");
      const plan = teachingPlanSchema.parse(input.plan);
      if (plan.references.some((reference) => !input.sourceIds.includes(reference.id))) throw new Error("The teaching plan contains references that are not declared in sourceIds.");
      const beforeLesson = input.lessonId ? await this.lessons.get(input.lessonId) : null;
      let lesson: Lesson;
      if (beforeLesson) {
        if (beforeLesson.origin !== "agent-imported") throw new Error("Only agent-imported lessons can be updated through a course.");
        if (input.expectedLessonRevision === undefined) throw new Error("Updating a lesson requires expectedLessonRevision.");
        lesson = this.lessonContent.buildUpdatedImported(beforeLesson, {
          lessonId: beforeLesson.id, expectedRevision: input.expectedLessonRevision,
          courseId: course.id,
          sourceIds: input.sourceIds, durationMinutes: lessonDurationSchema.parse(input.durationMinutes), level: lessonLevelSchema.parse(input.level),
          objective: input.objective, contentLanguage: course.language, plan,
        });
      } else {
        lesson = this.lessonContent.buildImported({
          id: input.lessonId, courseId: course.id, sourceIds: input.sourceIds,
          durationMinutes: lessonDurationSchema.parse(input.durationMinutes), level: lessonLevelSchema.parse(input.level),
          objective: input.objective, contentLanguage: course.language, plan,
        });
      }
      const next = courseSchema.parse({
        ...course, revision: course.revision + 1, status: "draft", updatedAt: new Date().toISOString(), validatedAt: null, publishedAt: null,
        modules: course.modules.map((item) => item.id === courseModule.id ? { ...item, lessonIds: [...new Set([...item.lessonIds, lesson!.id])] } : item),
      });
      if (this.unitOfWork) {
        await this.unitOfWork.saveCourseAndLesson({ operationId: input.operationId, beforeCourse: course, afterCourse: next, beforeLesson, afterLesson: lesson });
      } else {
        try {
          await this.lessons.save(lesson, beforeLesson?.revision, { pruneAudio: false });
          await this.courses.save(next, course.revision);
        } catch (error) {
          await this.lessons.restore(lesson.id, beforeLesson);
          throw error;
        }
        try { await this.lessons.pruneAudio(lesson); }
        catch (error) { console.warn(`[persistence] could not remove orphaned audio after committing ${input.operationId}: ${error instanceof Error ? error.message : "unknown error"}`); }
      }
      const result = { course: next, lesson, reused: false };
      await this.operations.complete(input.operationId, result);
      return result;
    } catch (error) { await this.operations.release(input.operationId); throw error; }
  }

  async upsertAssessment(input: { operationId: string; courseId: string; expectedRevision: number; assessment: CourseAssessment }): Promise<CourseMutationResult> {
    return this.mutate("upsert-assessment", input, async (course) => ({
      ...course,
      assessments: upsert(course.assessments, courseAssessmentSchema.parse(input.assessment)),
      status: "draft", validatedAt: null, publishedAt: null,
    }));
  }

  async deleteAssessment(input: { operationId: string; courseId: string; expectedRevision: number; assessmentId: string; confirmed: boolean }): Promise<CourseMutationResult> {
    if (!input.confirmed) throw new Error("Deleting an assessment requires explicit confirmation.");
    return this.mutate("delete-assessment", input, async (course) => {
      if (!course.assessments.some((assessment) => assessment.id === input.assessmentId)) throw new Error("The assessment does not exist.");
      return {
        ...course,
        assessments: course.assessments.filter((assessment) => assessment.id !== input.assessmentId),
        coverage: course.coverage.map((entry) => ({ ...entry, assessmentIds: entry.assessmentIds.filter((id) => id !== input.assessmentId) })),
        status: "draft", validatedAt: null, publishedAt: null,
      };
    });
  }

  async validateCourse(courseId: string): Promise<CourseValidation> {
    const course = await this.requireCourse(courseId);
    return this.validateLoaded(course);
  }

  async markValidated(input: { operationId: string; courseId: string; expectedRevision: number }): Promise<CourseMutationResult> {
    return this.mutate("validate-course", input, async (course) => {
      const validation = await this.validateLoaded(course);
      if (!validation.valid) throw new Error(`The course cannot be validated: ${validation.issues.filter((item) => item.severity === "error").map((item) => item.message).join(" ")}`);
      return { ...course, status: "validated", validatedAt: new Date().toISOString() };
    });
  }

  async publish(input: { operationId: string; courseId: string; expectedRevision: number; confirmed: boolean }): Promise<CourseMutationResult> {
    if (!input.confirmed) throw new Error("Publishing requires explicit confirmation.");
    return this.mutate("publish-course", input, async (course) => {
      if (course.status !== "validated") throw new Error("The course must be validated before publication.");
      const validation = await this.validateLoaded(course);
      if (!validation.valid) throw new Error("The course no longer meets the publication requirements.");
      return { ...course, status: "published", publishedAt: new Date().toISOString() };
    });
  }

  private async validateLoaded(course: Course): Promise<CourseValidation> {
    const issues: CourseValidationIssue[] = [];
    const loadedLessons: Lesson[] = [];
    if (course.sources.length === 0) issues.push({ code: "missing-sources", severity: "error", message: "The course needs at least one traceable source.", path: "sources" });
    if (course.objectives.length === 0) issues.push({ code: "missing-objectives", severity: "error", message: "The course needs verifiable learning objectives.", path: "objectives" });
    if (course.modules.length === 0) issues.push({ code: "missing-modules", severity: "error", message: "The course needs at least one module.", path: "modules" });
    const lessonIds = new Set<string>();
    for (const courseModule of course.modules) {
      if (courseModule.lessonIds.length === 0) issues.push({ code: "empty-module", severity: "error", message: `Module ${courseModule.title} contains no lessons.`, path: `modules.${courseModule.id}` });
      for (const lessonId of courseModule.lessonIds) {
        lessonIds.add(lessonId);
        const lesson = await this.lessons.get(lessonId);
        if (!lesson) issues.push({ code: "missing-lesson", severity: "error", message: `Lesson ${lessonId} does not exist.`, path: `modules.${courseModule.id}.lessonIds` });
        else {
          loadedLessons.push(lesson);
          if (lesson.origin === "agent-imported" && (lesson.source.kind !== "course-sources" || lesson.source.sourceIds.some((id) => !course.sources.some((source) => source.id === id)))) {
            issues.push({ code: "invalid-lesson-source", severity: "error", message: `Lesson ${lesson.plan.title} references sources outside the course.`, path: `modules.${courseModule.id}.lessonIds` });
          }
          for (const qualityIssue of inspectTeachingPlanQuality(lesson.plan)) {
            issues.push({ ...qualityIssue, severity: "warning", message: `${lesson.plan.title}: ${qualityIssue.message}`, path: `lessons.${lesson.id}.${qualityIssue.path}` });
          }
        }
      }
    }
    if (loadedLessons.length >= 3 && new Set(loadedLessons.map((lesson) => lesson.plan.chapters.length)).size === 1) {
      issues.push({ code: "uniform-course-shape", severity: "warning", message: `All ${loadedLessons.length} lessons have exactly ${loadedLessons[0].plan.chapters.length} chapters; confirm that this reflects the content rather than a template.`, path: "modules.lessonIds" });
    }
    const blockCounts = loadedLessons.flatMap((lesson) => lesson.plan.chapters.map((chapter) => chapter.blocks.length));
    if (blockCounts.length >= 8) {
      const frequencies = new Map<number, number>();
      for (const count of blockCounts) frequencies.set(count, (frequencies.get(count) || 0) + 1);
      const [dominantCount, occurrences] = [...frequencies.entries()].sort((left, right) => right[1] - left[1])[0];
      if (occurrences / blockCounts.length > 0.5) {
        issues.push({ code: "dominant-block-shape", severity: "warning", message: `${occurrences} of ${blockCounts.length} chapters use exactly ${dominantCount} blocks; check whether the structure reflects the subject or repeats an editorial template.`, path: "modules.lessonIds" });
      }
    }
    const coverageByObjective = new Map(course.coverage.map((item) => [item.objectiveId, item]));
    for (const objective of course.objectives) {
      const coverage = coverageByObjective.get(objective.id);
      if (!coverage) issues.push({ code: "missing-objective-coverage", severity: "error", message: `Coverage is not declared for ${objective.title}.`, path: `coverage.${objective.id}` });
      else {
        if (coverage.status !== "covered") issues.push({ code: "uncovered-objective", severity: "warning", message: `${objective.title} remains ${coverage.status}.`, path: `coverage.${objective.id}` });
        if (coverage.lessonIds.some((id) => !lessonIds.has(id))) issues.push({ code: "missing-lesson", severity: "error", message: `Coverage for ${objective.title} links to a lesson outside the course.`, path: `coverage.${objective.id}.lessonIds` });
      }
    }
    if (course.assessments.length === 0) issues.push({ code: "missing-assessment", severity: "error", message: "The course needs at least one assessment.", path: "assessments" });
    return { valid: !issues.some((item) => item.severity === "error"), issues };
  }

  private async mutate<T extends { operationId: string; courseId: string; expectedRevision: number }>(kind: string, input: T, apply: (course: Course) => Promise<Course> | Course): Promise<CourseMutationResult> {
    return this.idempotent(kind, input.operationId, input, async () => {
      const current = await this.requireCourse(input.courseId);
      this.assertRevision(current, input.expectedRevision);
      const updated = await apply(current);
      const next = courseSchema.parse({ ...updated, revision: current.revision + 1, status: updated.status === "published" ? "published" : updated.status, updatedAt: new Date().toISOString() });
      await this.courses.save(next, current.revision);
      return next;
    });
  }

  private async idempotent(kind: string, operationId: string, input: unknown, action: () => Promise<Course>): Promise<CourseMutationResult> {
    const replay = await this.claim(kind, operationId, input);
    if (replay) return replay as CourseMutationResult;
    try {
      const course = await action();
      const result = { course, reused: false };
      await this.operations.complete(operationId, result);
      return result;
    } catch (error) { await this.operations.release(operationId); throw error; }
  }

  private async claim(kind: string, operationId: string, input: unknown): Promise<unknown | null> {
    const fingerprint = createHash("sha256").update(stableJson(input)).digest("hex");
    const claim = await this.operations.claim({ operationId, kind, fingerprint });
    if (claim.state === "running") throw new Error("The same operation is still running.");
    if (claim.state === "completed") return { ...(claim.result as object), reused: true };
    return null;
  }

  private async requireCourse(id: string): Promise<Course> {
    await this.unitOfWork?.recover();
    const course = await this.courses.get(id);
    if (!course) throw new Error("The course does not exist.");
    return course;
  }

  private assertRevision(course: Course, expected: number): void {
    if (course.revision !== expected) throw new Error(`Revision conflict: expected ${expected}, but the course is at ${course.revision}.`);
  }
}

function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  return items.some((current) => current.id === item.id) ? items.map((current) => current.id === item.id ? item : current) : [...items, item];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
