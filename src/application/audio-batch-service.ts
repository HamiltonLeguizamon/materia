import { randomUUID } from "node:crypto";

import { AudioActivityRegistry } from "@/application/audio-generation-status";
import type { AudioAdmissionLease, AudioBatchJob, AudioBatchJobRepository, CourseRepository, LessonRepository, SpeechProfile, SpeechProviderId } from "@/application/ports";
import type { SelectiveAudioService } from "@/application/selective-audio-service";
import { audioMatchesCurrentNarration } from "@/domain/teaching";

// Persist each chapter as soon as it is ready so playback can begin while the
// remaining course continues in the background.
const GROUP_SIZE = 1;
const WORDS_PER_MINUTE = 135;

type BatchInput = { provider: SpeechProviderId; profile?: Partial<SpeechProfile> };

export class AudioBatchService {
  private readonly active = new Map<string, Promise<void>>();
  private readonly activeByJob = new Map<string, Promise<void>>();
  constructor(
    private readonly courses: CourseRepository,
    private readonly lessons: LessonRepository,
    private readonly jobs: AudioBatchJobRepository,
    private readonly audio: SelectiveAudioService,
    private readonly activity = new AudioActivityRegistry(),
  ) {}

  getJob(id: string) { return this.jobs.get(id); }

  async waitForJob(id: string) {
    const active = this.activeByJob.get(id);
    if (active) await active;
    return this.jobs.get(id);
  }

  async estimateCourse(courseId: string, input: BatchInput) {
    const course = await this.courses.get(courseId);
    if (!course) throw new Error("The course does not exist.");
    return this.estimate("course", course.id, [...new Set(course.modules.flatMap((module) => module.lessonIds))], input);
  }

  async estimateLesson(lessonId: string, input: BatchInput) {
    return this.estimate("lesson", null, [lessonId], input);
  }

  async startCourse(input: BatchInput & { courseId: string; expectedRevision: number; confirmed: boolean }) {
    const course = await this.courses.get(input.courseId);
    if (!course) throw new Error("The course does not exist.");
    if (course.revision !== input.expectedRevision) throw new Error(`Revision conflict: expected ${input.expectedRevision}, but the course is at ${course.revision}.`);
    return this.start("course", course.id, [...new Set(course.modules.flatMap((module) => module.lessonIds))], input);
  }

  async startLesson(input: BatchInput & { lessonId: string; confirmed: boolean }) {
    return this.start("lesson", null, [input.lessonId], input);
  }

  private async estimate(scope: "lesson" | "course", courseId: string | null, lessonIds: string[], input: BatchInput) {
    let characters = 0; let words = 0; let chapters = 0; let profile: SpeechProfile | null = null; let profileKey = "";
    for (const lessonId of lessonIds) {
      const lesson = await this.lessons.get(lessonId);
      if (!lesson) throw new Error("The course contains a lesson that does not exist.");
      const pending = lesson.plan.chapters.filter((chapter) => !audioMatchesCurrentNarration(lesson.audioByChapter[chapter.id]));
      if (!pending.length) continue;
      const estimate = await this.audio.estimate({ lessonId, chapterIds: pending.map((chapter) => chapter.id), ...input });
      characters += estimate.characters; words += estimate.words; chapters += pending.length; profile = estimate.profile; profileKey = estimate.profileKey;
    }
    if (!profile) {
      const first = await this.lessons.get(lessonIds[0]);
      if (!first) throw new Error("No lessons are available.");
      const chapter = first.plan.chapters[0];
      const estimate = await this.audio.estimate({ lessonId: first.id, chapterIds: [chapter.id], ...input });
      profile = estimate.profile; profileKey = estimate.profileKey;
    }
    return { scope, courseId, lessonIds, lessons: lessonIds.length, chapters, characters, words, estimatedMinutes: Math.round((words / WORDS_PER_MINUTE) * 10) / 10, profile, profileKey, costMessage: input.provider === "openai" ? "OpenAI may incur a cost. The queue processes one chapter at a time and does not automatically switch providers." : "The queue uses the selected local node without calling OpenAI and processes chapters in order." };
  }

  private async start(scope: "lesson" | "course", courseId: string | null, lessonIds: string[], input: BatchInput & { confirmed: boolean }) {
    if (!input.confirmed) throw new Error("Generating the batch requires explicit confirmation.");
    const key = `${scope}:${courseId || lessonIds[0]}`;
    if (this.active.has(key)) throw new Error("A sequential generation is already active for this selection.");
    await this.audio.assertAvailable(input.provider, input.profile);
    const admission = await this.audio.acquireAdmission(lessonIds);
    try {
      const estimate = await this.estimate(scope, courseId, lessonIds, input);
      if (!estimate.chapters) throw new Error("Every chapter already has audio.");
      const now = new Date().toISOString();
      const job: AudioBatchJob = { schemaVersion: 1, id: randomUUID(), scope, courseId, lessonIds, provider: input.provider, profile: estimate.profile, profileKey: estimate.profileKey, state: "queued", totalChapters: estimate.chapters, completedChapters: 0, currentLessonId: null, currentChapterId: null, createdAt: now, updatedAt: now, completedAt: null, error: null };
      await this.jobs.save(job);
      this.activity.begin({ id: job.id, scope, phase: "queued", provider: job.provider, nodeId: job.profile.nodeId, lessonId: scope === "lesson" ? lessonIds[0] || null : null, chapterId: null, completedChapters: 0, totalChapters: job.totalChapters });
      const promise = this.run(job, admission).finally(() => {
        this.active.delete(key);
        this.activeByJob.delete(job.id);
      });
      this.active.set(key, promise);
      this.activeByJob.set(job.id, promise);
      void promise;
      return job;
    } catch (error) { await admission.release(); throw error; }
  }

  private async run(initial: AudioBatchJob, admission: AudioAdmissionLease): Promise<void> {
    let job: AudioBatchJob = { ...initial, state: "running", updatedAt: new Date().toISOString() };
    await this.jobs.save(job);
    try {
      for (const lessonId of job.lessonIds) {
        let lesson = await this.lessons.get(lessonId);
        if (!lesson) throw new Error("A lesson in the batch no longer exists.");
        const loadedLesson = lesson;
        const pending = loadedLesson.plan.chapters.filter((chapter) => !audioMatchesCurrentNarration(loadedLesson.audioByChapter[chapter.id])).map((chapter) => chapter.id);
        for (let offset = 0; offset < pending.length; offset += GROUP_SIZE) {
          const group = pending.slice(offset, offset + GROUP_SIZE);
          job = { ...job, currentLessonId: lesson.id, currentChapterId: group[0], updatedAt: new Date().toISOString() };
          await this.jobs.save(job);
          this.activity.update(job.id, { phase: "synthesizing", lessonId: lesson.id, chapterId: group[0] || null, completedChapters: job.completedChapters });
          const child = await this.audio.generate({ operationId: `batch:${job.id}:${lesson.id}:${offset}`, lessonId: lesson.id, expectedLessonRevision: lesson.revision, chapterIds: group, confirmed: true, provider: job.provider, profile: job.profile }, admission);
          if (child.state !== "completed") throw new Error(child.error || "An audio segment did not complete successfully.");
          job = { ...job, completedChapters: Math.min(job.totalChapters, job.completedChapters + group.length), updatedAt: new Date().toISOString() };
          await this.jobs.save(job);
          this.activity.update(job.id, { phase: job.completedChapters === job.totalChapters ? "finalizing" : "queued", completedChapters: job.completedChapters });
          lesson = await this.lessons.get(lesson.id);
          if (!lesson) throw new Error("The lesson disappeared during generation.");
        }
      }
      job = { ...job, state: "completed", currentLessonId: null, currentChapterId: null, updatedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
      await this.jobs.save(job);
      this.activity.complete(job.id, job.totalChapters);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sequential generation failed.";
      job = { ...job, state: "failed", updatedAt: new Date().toISOString(), completedAt: new Date().toISOString(), error: message };
      await this.jobs.save(job);
      this.activity.fail(job.id, message);
    } finally { await admission.release(); }
  }
}
