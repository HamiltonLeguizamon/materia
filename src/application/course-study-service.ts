import type { CourseProgressRepository, CourseRepository } from "@/application/ports";
import { courseStudyProgressSchema, type CourseStudyProgress } from "@/domain/course";

export class CourseStudyService {
  constructor(private readonly courses: CourseRepository, private readonly progress: CourseProgressRepository) {}

  async getProgress(courseId: string): Promise<CourseStudyProgress> {
    const course = await this.courses.get(courseId);
    if (!course) throw new Error("The course does not exist.");
    return (await this.progress.get(courseId)) || { schemaVersion: 1, courseId, revision: 1, answers: {}, updatedAt: course.createdAt };
  }

  async answer(input: { courseId: string; assessmentId: string; questionId: string; option: number; expectedRevision: number }) {
    const course = await this.courses.get(input.courseId);
    if (!course) throw new Error("The course does not exist.");
    const assessment = course.assessments.find((item) => item.id === input.assessmentId);
    if (!assessment) throw new Error("The assessment does not exist.");
    const question = assessment.questions.find((item) => item.id === input.questionId);
    if (!question) throw new Error("The question does not exist.");
    if (!Number.isInteger(input.option) || input.option < 0 || input.option >= question.options.length) throw new Error("The selected answer is invalid.");
    const current = await this.getProgress(input.courseId);
    if (current.revision !== input.expectedRevision) throw new Error(`Revision conflict: expected ${input.expectedRevision}, but course progress is at ${current.revision}.`);
    const now = new Date().toISOString();
    const updated = courseStudyProgressSchema.parse({
      ...current,
      revision: current.revision + 1,
      answers: { ...current.answers, [question.id]: { assessmentId: assessment.id, option: input.option, correct: input.option === question.expectedOption, answeredAt: now } },
      updatedAt: now,
    });
    await this.progress.save(updated, current.revision);
    return { progress: updated, result: { assessmentId: assessment.id, questionId: question.id, option: input.option, correct: input.option === question.expectedOption, explanation: question.explanation } };
  }
}
