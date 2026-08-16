import { randomUUID } from "node:crypto";

import type { LessonRepository } from "@/application/ports";
import {
  createLessonInputSchema,
  lessonSchema,
  pendingAudioByChapter,
  chapterNarration,
  teachingPlanSchema,
  type CreateLessonInput,
  type Lesson,
  type TeachingPlan,
} from "@/domain/teaching";

export class LessonContentService {
  constructor(private readonly repository: LessonRepository) {}

  async createFromPlan(rawInput: CreateLessonInput, rawPlan: TeachingPlan): Promise<Lesson> {
    const input = createLessonInputSchema.parse(rawInput);
    const plan = teachingPlanSchema.parse(rawPlan);
    const now = new Date().toISOString();
    const lesson = lessonSchema.parse({
      schemaVersion: 4,
      id: randomUUID(),
      revision: 1,
      status: "ready",
      createdAt: now,
      updatedAt: now,
      origin: input.provider === "demo" ? "demo" : "generated",
      planProvider: input.provider,
      source: { kind: "local-text", name: input.sourceName, text: input.sourceText, characterCount: input.sourceText.length },
      preferences: { durationMinutes: input.durationMinutes, level: input.level, objective: input.objective, contentLanguage: input.contentLanguage },
      plan,
      audioByChapter: pendingAudioByChapter(plan),
      progress: { activeChapterId: plan.chapters[0]?.id || null, completedChapterIds: [], answers: {}, updatedAt: now },
    });
    await this.repository.save(lesson);
    return lesson;
  }

  async createImported(input: {
    id?: string;
    courseId: string;
    sourceIds: string[];
    durationMinutes: CreateLessonInput["durationMinutes"];
    level: CreateLessonInput["level"];
    objective: string;
    contentLanguage?: string;
    plan: TeachingPlan;
  }): Promise<Lesson> {
    const lesson = this.buildImported(input);
    await this.repository.save(lesson);
    return lesson;
  }

  buildImported(input: {
    id?: string;
    courseId: string;
    sourceIds: string[];
    durationMinutes: CreateLessonInput["durationMinutes"];
    level: CreateLessonInput["level"];
    objective: string;
    contentLanguage?: string;
    plan: TeachingPlan;
  }): Lesson {
    const plan = teachingPlanSchema.parse(input.plan);
    const now = new Date().toISOString();
    const lesson = lessonSchema.parse({
      schemaVersion: 4,
      id: input.id || randomUUID(),
      revision: 1,
      status: "ready",
      createdAt: now,
      updatedAt: now,
      origin: "agent-imported",
      planProvider: "agent",
      source: { kind: "course-sources", courseId: input.courseId, sourceIds: input.sourceIds },
      preferences: { durationMinutes: input.durationMinutes, level: input.level, objective: input.objective, contentLanguage: input.contentLanguage || "en-US" },
      plan,
      audioByChapter: pendingAudioByChapter(plan),
      progress: { activeChapterId: plan.chapters[0]?.id || null, completedChapterIds: [], answers: {}, updatedAt: now },
    });
    return lesson;
  }

  async updateImported(input: {
    lessonId: string;
    courseId: string;
    expectedRevision: number;
    sourceIds: string[];
    durationMinutes: CreateLessonInput["durationMinutes"];
    level: CreateLessonInput["level"];
    objective: string;
    contentLanguage?: string;
    plan: TeachingPlan;
  }): Promise<Lesson> {
    const current = await this.repository.get(input.lessonId);
    if (!current) throw new Error("The lesson does not exist.");
    const lesson = this.buildUpdatedImported(current, input);
    await this.repository.save(lesson, current.revision);
    return lesson;
  }

  buildUpdatedImported(current: Lesson, input: {
    lessonId: string;
    courseId: string;
    expectedRevision: number;
    sourceIds: string[];
    durationMinutes: CreateLessonInput["durationMinutes"];
    level: CreateLessonInput["level"];
    objective: string;
    contentLanguage?: string;
    plan: TeachingPlan;
  }): Lesson {
    if (current.origin !== "agent-imported" || current.planProvider !== "agent") throw new Error("Solo se pueden editar por este camino las lecciones importadas por un agente.");
    if (current.revision !== input.expectedRevision) throw new Error(`Revision conflict: expected ${input.expectedRevision}, but the lesson is at ${current.revision}.`);
    const plan = teachingPlanSchema.parse(input.plan);
    const existingAudio = current.audioByChapter;
    const audioByChapter = Object.fromEntries(plan.chapters.map((chapter) => {
      const previousChapter = current.plan.chapters.find((item) => item.id === chapter.id);
      const previousAudio = existingAudio[chapter.id];
      const nextLanguage = input.contentLanguage || current.preferences.contentLanguage;
      const sameSpeech = previousChapter?.title === chapter.title && current.preferences.contentLanguage === nextLanguage && previousChapter && chapterNarration(previousChapter, current.plan.title, current.preferences.contentLanguage) === chapterNarration(chapter, plan.title, nextLanguage);
      return [chapter.id, sameSpeech && previousAudio ? previousAudio : pendingAudioByChapter({ ...plan, chapters: [chapter] })[chapter.id]];
    }));
    const questionIds = new Set(plan.questions.map((question) => question.id));
    const chapterIds = new Set(plan.chapters.map((chapter) => chapter.id));
    const now = new Date().toISOString();
    const lesson = lessonSchema.parse({
      ...current,
      revision: current.revision + 1,
      updatedAt: now,
      status: "ready",
      source: { kind: "course-sources", courseId: input.courseId, sourceIds: input.sourceIds },
      preferences: { durationMinutes: input.durationMinutes, level: input.level, objective: input.objective, contentLanguage: input.contentLanguage || current.preferences.contentLanguage },
      plan,
      audioByChapter,
      progress: {
        ...current.progress,
        activeChapterId: current.progress.activeChapterId && chapterIds.has(current.progress.activeChapterId) ? current.progress.activeChapterId : plan.chapters[0]?.id || null,
        completedChapterIds: current.progress.completedChapterIds.filter((id) => chapterIds.has(id)),
        answers: Object.fromEntries(Object.entries(current.progress.answers).filter(([id]) => questionIds.has(id))),
        updatedAt: now,
      },
    });
    return lesson;
  }
}
