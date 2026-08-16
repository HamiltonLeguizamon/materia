import type { LessonRepository, SpeechProvider } from "@/application/ports";
import { chapterNarration, lessonSchema, NARRATION_PROJECTION_VERSION, type Lesson } from "@/domain/teaching";

export class LessonAudioService {
  constructor(
    private readonly repository: LessonRepository,
    private readonly speechProvider: SpeechProvider,
    private readonly provider: "demo" | "openai",
  ) {}

  async synthesizeAll(lessonId: string): Promise<Lesson> {
    const lesson = await this.repository.get(lessonId);
    if (!lesson) throw new Error("The lesson does not exist.");
    const startingRevision = lesson.revision;
    lesson.status = "synthesizing";
    lesson.revision += 1;
    lesson.updatedAt = new Date().toISOString();
    await this.repository.save(lesson, startingRevision);

    const audioEntries = await Promise.all(lesson.plan.chapters.map(async (chapter) => {
      try {
        const generated = await this.speechProvider.synthesize({ lessonTitle: lesson.plan.title, chapterTitle: chapter.title, narration: chapterNarration(chapter, lesson.plan.title, lesson.preferences.contentLanguage) });
        const url = generated.kind === "bytes" ? await this.repository.saveAudio(lesson.id, chapter.id, generated.bytes) : null;
        return [chapter.id, {
          status: "ready" as const,
          kind: generated.kind === "bytes" ? "file" as const : "browser-speech" as const,
          url,
          mimeType: generated.mimeType,
          provider: this.provider,
          profileKey: this.speechProvider.profileKey,
          speechProfile: this.speechProvider.profile,
          chunkCount: generated.kind === "bytes" ? generated.chunkCount : null,
          error: null,
          generatedAt: new Date().toISOString(),
          durationSeconds: generated.kind === "bytes" ? generated.durationSeconds : null,
          narrationVersion: NARRATION_PROJECTION_VERSION,
        }] as const;
      } catch (error) {
        return [chapter.id, {
          status: "failed" as const,
          kind: null,
          url: null,
          mimeType: null,
          provider: this.provider,
          profileKey: this.speechProvider.profileKey,
          speechProfile: this.speechProvider.profile,
          chunkCount: null,
          error: error instanceof Error ? error.message : "Could not generate audio.",
          generatedAt: null,
          durationSeconds: null,
        }] as const;
      }
    }));

    const updated = lessonSchema.parse({
      ...lesson,
      revision: lesson.revision + 1,
      status: audioEntries.some(([, audio]) => audio.status === "failed") ? "failed" : "ready",
      updatedAt: new Date().toISOString(),
      audioByChapter: Object.fromEntries(audioEntries),
    });
    await this.repository.save(updated, lesson.revision);
    return updated;
  }
}
