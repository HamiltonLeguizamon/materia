import type { LessonRepository, SpeechProvider, TeachingPlanProvider } from "@/application/ports";
import { LessonAudioService } from "@/application/lesson-audio-service";
import { LessonContentService } from "@/application/lesson-content-service";
import { LessonStudyService } from "@/application/lesson-study-service";
import { createLessonInputSchema, type CreateLessonInput, type Lesson } from "@/domain/teaching";

export type GenerationProgress = (phase: "planning" | "synthesizing" | "saving") => void;

export class LessonService {
  private readonly contentService: LessonContentService;
  private readonly audioService: LessonAudioService;
  private readonly studyService: LessonStudyService;

  constructor(
    repository: LessonRepository,
    private readonly planProvider: TeachingPlanProvider,
    speechProvider: SpeechProvider,
    provider: "demo" | "openai",
  ) {
    this.contentService = new LessonContentService(repository);
    this.audioService = new LessonAudioService(repository, speechProvider, provider);
    this.studyService = new LessonStudyService(repository);
  }

  async create(rawInput: CreateLessonInput, onProgress: GenerationProgress = () => undefined): Promise<Lesson> {
    const input = createLessonInputSchema.parse(rawInput);
    onProgress("planning");
    const plan = await this.planProvider.createPlan(input);
    const content = await this.contentService.createFromPlan(input, plan);
    onProgress("synthesizing");
    const lesson = await this.audioService.synthesizeAll(content.id);
    onProgress("saving");
    return lesson;
  }

  async updateProgress(lessonId: string, input: { expectedRevision: number; activeChapterId?: string; completedChapterIds?: string[]; questionId?: string; answer?: number }): Promise<Lesson> {
    return this.studyService.updateProgress(lessonId, input);
  }
}
