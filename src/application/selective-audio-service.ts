import { createHash, randomUUID } from "node:crypto";

import { AudioActivityRegistry } from "@/application/audio-generation-status";
import type { AudioAdmissionCoordinator, AudioAdmissionLease, AudioJob, AudioJobRepository, LessonRepository, OperationRepository, SpeechProfile, SpeechProvider, SpeechProviderId } from "@/application/ports";
import { audioMatchesCurrentNarration, chapterNarration, lessonSchema, NARRATION_PROJECTION_VERSION, type Lesson } from "@/domain/teaching";
import { pendingAudioByChapter } from "@/domain/teaching";

const MAX_CHAPTERS_PER_JOB = 3;
const WORDS_PER_MINUTE = 135;

export type AudioEstimate = {
  lessonId: string;
  lessonRevision: number;
  chapterIds: string[];
  characters: number;
  words: number;
  estimatedMinutes: number;
  estimatedCost: null;
  costMessage: string;
  cacheHits: string[];
  profileKey: string;
};

export class SelectiveAudioService {
  private readonly activeByLesson = new Map<string, Promise<AudioJob>>();
  private readonly busyLessons = new Set<string>();

  constructor(
    private readonly lessons: LessonRepository,
    private readonly jobs: AudioJobRepository,
    private readonly operations: OperationRepository,
    private readonly speechFor: (provider: SpeechProviderId, profile?: Partial<SpeechProfile>) => SpeechProvider,
    private readonly activity = new AudioActivityRegistry(),
    private readonly admission?: AudioAdmissionCoordinator,
    private readonly providerAvailable: (provider: SpeechProviderId, profile?: Partial<SpeechProfile>) => Promise<void> = async () => {},
  ) {}

  assertAvailable(provider: SpeechProviderId, profile?: Partial<SpeechProfile>): Promise<void> { return this.providerAvailable(provider, profile); }

  async acquireAdmission(lessonIds: string[]): Promise<AudioAdmissionLease> {
    if (this.admission) return this.admission.acquire(lessonIds);
    return { lessonIds: new Set(lessonIds), release: async () => {} };
  }

  async estimate(input: { lessonId: string; chapterIds: string[]; provider?: SpeechProviderId; profile?: Partial<SpeechProfile> }): Promise<AudioEstimate & { profile: SpeechProfile }> {
    const lesson = await this.requireLesson(input.lessonId);
    const chapters = selectChapters(lesson, input.chapterIds);
    const provider = input.provider || "openai";
    const speech = this.speechFor(provider, input.profile);
    const profileKey = speech.profileKey;
    const words = chapters.reduce((total, chapter) => total + chapterNarration(chapter, lesson.plan.title, lesson.preferences.contentLanguage).trim().split(/\s+/).length, 0);
    return {
      lessonId: lesson.id, lessonRevision: lesson.revision, chapterIds: chapters.map((chapter) => chapter.id),
      characters: chapters.reduce((total, chapter) => total + chapterNarration(chapter, lesson.plan.title, lesson.preferences.contentLanguage).length, 0), words,
      estimatedMinutes: Math.round((words / WORDS_PER_MINUTE) * 10) / 10,
      estimatedCost: null,
      costMessage: provider === "kokoro" || provider === "qwen" || provider === "chatterbox"
        ? `${provider === "qwen" ? "Qwen" : provider === "chatterbox" ? "Chatterbox" : "Kokoro"} runs on your device: it does not use the OpenAI API; it only uses local resources and your configured private network.`
        : provider === "demo"
          ? "Demo mode uses the browser voice and makes no paid calls."
          : "Materia can estimate length and duration, but does not claim a price without a verifiable rate for the configured model.",
      cacheHits: chapters.filter((chapter) => audioMatchesCurrentNarration(lesson.audioByChapter[chapter.id]) && lesson.audioByChapter[chapter.id]?.provider === provider && lesson.audioByChapter[chapter.id]?.profileKey === profileKey).map((chapter) => chapter.id),
      profile: speech.profile,
      profileKey,
    };
  }

  getJob(id: string): Promise<AudioJob | null> { return this.jobs.get(id); }

  async start(input: { operationId: string; lessonId: string; expectedLessonRevision: number; chapterIds: string[]; confirmed: boolean; provider: SpeechProviderId; profile?: Partial<SpeechProfile> }, inheritedAdmission?: AudioAdmissionLease): Promise<AudioJob> {
    if (!input.confirmed) throw new Error("Generating audio requires explicit confirmation.");
    const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const claim = await this.operations.claim({ operationId: input.operationId, kind: "generate-audio", fingerprint });
    if (claim.state === "completed") return claim.result as AudioJob;
    const existing = await this.jobs.findByOperationId(input.operationId);
    if (existing?.remoteJobId && (existing.state === "running" || existing.state === "interrupted")) {
      if (this.busyLessons.has(input.lessonId)) return existing;
      let ownedAdmission: AudioAdmissionLease | null = null;
      try {
        ownedAdmission = await this.reserveAdmission(existing.lessonId, inheritedAdmission);
        await this.assertAvailable(existing.provider, existing.profile);
        const lesson = await this.requireLesson(existing.lessonId);
        this.busyLessons.add(existing.lessonId);
        const promise = this.run(existing, lesson);
        this.track(input.operationId, existing.lessonId, promise, ownedAdmission);
        return existing;
      } catch (error) { await ownedAdmission?.release(); throw error; }
    }
    if (existing) return existing;
    if (claim.state === "running") throw new Error("The same audio generation is still running.");
    if (this.busyLessons.has(input.lessonId)) { await this.operations.release(input.operationId); throw new Error("An audio operation is already active for this lesson."); }
    let ownedAdmission: AudioAdmissionLease | null = null;
    this.busyLessons.add(input.lessonId);
    try {
      ownedAdmission = await this.reserveAdmission(input.lessonId, inheritedAdmission);
      await this.assertAvailable(input.provider, input.profile);
      const lesson = await this.requireLesson(input.lessonId);
      if (lesson.revision !== input.expectedLessonRevision) throw new Error(`Revision conflict: expected ${input.expectedLessonRevision}, but the lesson is at ${lesson.revision}.`);
      const chapters = selectChapters(lesson, input.chapterIds);
      if (chapters.length > MAX_CHAPTERS_PER_JOB) throw new Error(`A generation job supports at most ${MAX_CHAPTERS_PER_JOB} chapters.`);
      const now = new Date().toISOString();
      const speech = this.speechFor(input.provider, input.profile);
      const profileKey = speech.profileKey;
      const job: AudioJob = { schemaVersion: 1, id: randomUUID(), operationId: input.operationId, lessonId: lesson.id, expectedLessonRevision: input.expectedLessonRevision, chapterIds: chapters.map((chapter) => chapter.id), provider: input.provider, profileKey, profile: speech.profile, state: "queued", createdAt: now, updatedAt: now, completedAt: null, error: null, lessonRevision: null, remoteSubmissionState: "not-started", remoteJobId: null, remoteChapterId: null };
      await this.jobs.save(job);
      this.activity.begin({ id: job.id, scope: chapters.length === 1 ? "chapter" : "lesson", phase: "queued", provider: job.provider, nodeId: job.profile.nodeId, lessonId: job.lessonId, chapterId: chapters[0]?.id || null, completedChapters: 0, totalChapters: chapters.length });
      const promise = this.run(job, lesson);
      this.track(input.operationId, input.lessonId, promise, ownedAdmission);
      return job;
    } catch (error) {
      this.busyLessons.delete(input.lessonId);
      await ownedAdmission?.release();
      await this.operations.release(input.operationId);
      throw error;
    }
  }

  async deleteChapterAudio(input: { lessonId: string; chapterId: string; expectedLessonRevision: number; confirmed: boolean }): Promise<Lesson> {
    if (!input.confirmed) throw new Error("Deleting audio requires explicit confirmation.");
    if (this.busyLessons.has(input.lessonId)) throw new Error("An audio operation is already active for this lesson.");
    const admission = await this.acquireAdmission([input.lessonId]);
    this.busyLessons.add(input.lessonId);
    try {
      const lesson = await this.requireLesson(input.lessonId);
      if (lesson.revision !== input.expectedLessonRevision) throw new Error(`Revision conflict: expected ${input.expectedLessonRevision}, but the lesson is at ${lesson.revision}.`);
      const chapter = lesson.plan.chapters.find((item) => item.id === input.chapterId);
      if (!chapter) throw new Error("The chapter does not exist.");
      const artifact = lesson.audioByChapter[chapter.id];
      if (!artifact || artifact.status === "pending") return lesson;
      const pending = pendingAudioByChapter({ ...lesson.plan, chapters: [chapter] })[chapter.id];
      const updated = lessonSchema.parse({
        ...lesson,
        revision: lesson.revision + 1,
        updatedAt: new Date().toISOString(),
        audioByChapter: { ...lesson.audioByChapter, [chapter.id]: pending },
      });
      await this.lessons.save(updated, lesson.revision);
      if (artifact.kind === "file") await this.lessons.deleteAudio(lesson.id, chapter.id);
      return updated;
    } finally {
      this.busyLessons.delete(input.lessonId);
      await admission.release();
    }
  }

  async generate(input: { operationId: string; lessonId: string; expectedLessonRevision: number; chapterIds: string[]; confirmed: boolean; provider: SpeechProviderId; profile?: Partial<SpeechProfile> }, inheritedAdmission?: AudioAdmissionLease): Promise<AudioJob> {
    const job = await this.start(input, inheritedAdmission);
    if (job.state === "completed" || job.state === "failed") return job;
    const active = this.activeByLesson.get(input.lessonId);
    return active ? active : job;
  }

  private async run(initialJob: AudioJob, lesson: Lesson): Promise<AudioJob> {
    const chapters = selectChapters(lesson, initialJob.chapterIds);
    let job: AudioJob = { ...initialJob, state: "running", updatedAt: new Date().toISOString() };
    await this.jobs.save(job);
    try {
      const provider = this.speechFor(job.provider, job.profile);
      if (provider.profileKey !== job.profileKey) throw new Error("The voice profile changed after generation was confirmed. Request a new estimate.");
      const audioByChapter = { ...lesson.audioByChapter };
      const generatedByChapter: Record<string, Lesson["audioByChapter"][string]> = {};
      let completedChapters = 0;
      for (const chapter of chapters) {
        if (audioMatchesCurrentNarration(audioByChapter[chapter.id]) && audioByChapter[chapter.id]?.provider === job.provider && audioByChapter[chapter.id]?.profileKey === job.profileKey) continue;
        this.activity.update(job.id, { phase: "synthesizing", chapterId: chapter.id, completedChapters });
        const resumableRemoteJobId = job.remoteChapterId === chapter.id ? job.remoteJobId || undefined : undefined;
        const generated = await provider.synthesize(
          { lessonTitle: lesson.plan.title, chapterTitle: chapter.title, narration: chapterNarration(chapter, lesson.plan.title, lesson.preferences.contentLanguage) },
          {
            remoteJobId: resumableRemoteJobId,
            onRemoteSubmissionStarted: async () => {
              job = { ...job, remoteSubmissionState: "submitting", remoteJobId: null, remoteChapterId: chapter.id, updatedAt: new Date().toISOString() };
              await this.jobs.save(job);
            },
            onRemoteAccepted: async (remoteJobId) => {
              job = { ...job, remoteSubmissionState: "accepted", remoteJobId, remoteChapterId: chapter.id, updatedAt: new Date().toISOString() };
              await this.jobs.save(job);
            },
            onRemoteRejected: async () => {
              job = { ...job, remoteSubmissionState: "not-started", remoteJobId: null, remoteChapterId: null, updatedAt: new Date().toISOString() };
              await this.jobs.save(job);
            },
          },
        );
        this.activity.update(job.id, { phase: "finalizing", chapterId: chapter.id, completedChapters });
        const url = generated.kind === "bytes" ? await this.lessons.saveAudio(lesson.id, chapter.id, generated.bytes) : null;
        const artifact: Lesson["audioByChapter"][string] = { status: "ready", kind: generated.kind === "bytes" ? "file" : "browser-speech", url, mimeType: generated.mimeType, provider: job.provider, profileKey: job.profileKey, speechProfile: provider.profile, chunkCount: generated.kind === "bytes" ? generated.chunkCount : null, error: null, generatedAt: new Date().toISOString(), durationSeconds: generated.kind === "bytes" ? generated.durationSeconds : null, narrationVersion: NARRATION_PROJECTION_VERSION };
        audioByChapter[chapter.id] = artifact;
        generatedByChapter[chapter.id] = artifact;
        job = { ...job, remoteSubmissionState: "not-started", remoteJobId: null, remoteChapterId: null, updatedAt: new Date().toISOString() };
        await this.jobs.save(job);
        completedChapters += 1;
        this.activity.update(job.id, { completedChapters });
      }
      const updated = Object.keys(generatedByChapter).length
        ? await this.mergeGeneratedAudio(lesson.id, generatedByChapter)
        : await this.requireLesson(lesson.id);
      job = { ...job, state: "completed", updatedAt: new Date().toISOString(), completedAt: new Date().toISOString(), lessonRevision: updated.revision };
      await this.jobs.save(job);
      this.activity.complete(job.id, chapters.length);
      return job;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Audio generation failed.";
      const uncertain = job.remoteSubmissionState === "submitting" && !job.remoteJobId;
      const resumable = Boolean(job.remoteJobId);
      job = {
        ...job,
        state: uncertain ? "unknown" : resumable ? "interrupted" : "failed",
        updatedAt: new Date().toISOString(), completedAt: uncertain || !resumable ? new Date().toISOString() : null, error: message,
      };
      await this.jobs.save(job);
      this.activity.fail(job.id, message);
      throw error;
    }
  }

  private track(operationId: string, lessonId: string, promise: Promise<AudioJob>, ownedAdmission: AudioAdmissionLease | null): void {
    const tracked = promise.then(async (completed) => {
      await this.operations.complete(operationId, completed);
      return completed;
    }).catch(async (error: unknown) => {
      const persisted = await this.jobs.findByOperationId(operationId);
      if (persisted?.state === "unknown") await this.operations.complete(operationId, persisted);
      else if (!persisted?.remoteJobId) await this.operations.release(operationId);
      throw error;
    }).finally(async () => {
      if (this.activeByLesson.get(lessonId) === tracked) this.activeByLesson.delete(lessonId);
      this.busyLessons.delete(lessonId);
      await ownedAdmission?.release();
    });
    this.activeByLesson.set(lessonId, tracked);
    void tracked.catch(() => {});
  }

  private async reserveAdmission(lessonId: string, inherited?: AudioAdmissionLease): Promise<AudioAdmissionLease | null> {
    if (inherited) {
      if (!inherited.lessonIds.has(lessonId)) throw new Error("The batch reservation does not cover this lesson.");
      return null;
    }
    return this.admission ? this.admission.acquire([lessonId]) : null;
  }

  private async mergeGeneratedAudio(lessonId: string, generatedByChapter: Record<string, Lesson["audioByChapter"][string]>): Promise<Lesson> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await this.requireLesson(lessonId);
      const updated = lessonSchema.parse({
        ...current,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
        audioByChapter: { ...current.audioByChapter, ...generatedByChapter },
      });
      try {
        await this.lessons.save(updated, current.revision);
        return updated;
      } catch (error) {
        const conflict = error instanceof Error && error.message.startsWith("Revision conflict:");
        if (!conflict || attempt === 4) throw error;
      }
    }
    throw new Error("Could not reconcile the audio with the current lesson revision.");
  }

  private async requireLesson(id: string): Promise<Lesson> {
    const lesson = await this.lessons.get(id);
    if (!lesson) throw new Error("The lesson does not exist.");
    return lesson;
  }
}

function selectChapters(lesson: Lesson, requested: string[]) {
  if (requested.length === 0) throw new Error("Select at least one chapter.");
  if (new Set(requested).size !== requested.length) throw new Error("Do not repeat chapters in the same request.");
  const chapters = requested.map((id) => lesson.plan.chapters.find((chapter) => chapter.id === id));
  if (chapters.some((chapter) => !chapter)) throw new Error("The selection contains an unknown chapter.");
  return chapters as Lesson["plan"]["chapters"];
}
