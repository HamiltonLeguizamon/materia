import type { LessonRepository } from "@/application/ports";
import type { Lesson } from "@/domain/teaching";

export class LessonStudyService {
  constructor(private readonly repository: LessonRepository) {}

  async updateProgress(lessonId: string, input: { expectedRevision: number; activeChapterId?: string; completedChapterIds?: string[]; questionId?: string; answer?: number }): Promise<Lesson> {
    const lesson = await this.requireLesson(lessonId);
    if (lesson.revision !== input.expectedRevision) throw new Error(`Revision conflict: expected ${input.expectedRevision}, but the lesson is at ${lesson.revision}.`);
    const chapterIds = new Set(lesson.plan.chapters.map((item) => item.id));
    let changed = false;
    if (input.activeChapterId && !chapterIds.has(input.activeChapterId)) throw new Error("Invalid chapter.");
    if (input.completedChapterIds?.some((id) => !chapterIds.has(id))) throw new Error("Invalid chapter progress.");
    if (input.questionId !== undefined) {
      const question = lesson.plan.questions.find((item) => item.id === input.questionId);
      if (!question || input.answer === undefined || input.answer < 0 || input.answer >= question.options.length) throw new Error("Invalid answer.");
      if (lesson.progress.answers[input.questionId] !== input.answer) { lesson.progress.answers[input.questionId] = input.answer; changed = true; }
    }
    if (input.activeChapterId && lesson.progress.activeChapterId !== input.activeChapterId) { lesson.progress.activeChapterId = input.activeChapterId; changed = true; }
    if (input.completedChapterIds) {
      const completed = [...new Set(input.completedChapterIds)];
      const current = new Set(lesson.progress.completedChapterIds);
      const answers = { ...lesson.progress.answers, ...(input.questionId !== undefined && input.answer !== undefined ? { [input.questionId]: input.answer } : {}) };
      for (const chapterId of completed.filter((id) => !current.has(id))) {
        const questions = lesson.plan.questions.filter((question) => question.chapterId === chapterId);
        if (questions.length === 0 || questions.some((question) => answers[question.id] !== question.expectedOption)) {
          throw new Error("Answer correctly before completing the chapter.");
        }
      }
      if (completed.length !== current.size || completed.some((id) => !current.has(id))) { lesson.progress.completedChapterIds = completed; changed = true; }
    }
    if (!changed) return lesson;
    const now = new Date().toISOString();
    lesson.progress.updatedAt = now;
    lesson.updatedAt = now;
    const expectedRevision = lesson.revision;
    lesson.revision += 1;
    await this.repository.save(lesson, expectedRevision);
    return lesson;
  }

  private async requireLesson(id: string): Promise<Lesson> {
    const lesson = await this.repository.get(id);
    if (!lesson) throw new Error("The lesson does not exist.");
    return lesson;
  }
}
