import { createHash, randomUUID } from "node:crypto";

import { createGenerationRegistry, type GenerationPhase, type GenerationRegistry, type GenerationStatus } from "@/application/generation-status";
import type { LessonRepository } from "@/application/ports";
import type { LessonService } from "@/application/lesson-service";
import { createLessonInputSchema, type CreateLessonInput, type Lesson } from "@/domain/teaching";

type GenerationResult = { lesson: Lesson; reused: boolean };

export class LessonGenerationCoordinator {
  constructor(
    private readonly repository: Pick<LessonRepository, "findReusable">,
    private readonly serviceFor: (provider: "demo" | "openai") => Pick<LessonService, "create">,
    private readonly registry: GenerationRegistry = createGenerationRegistry(),
  ) {}

  getStatus(): GenerationStatus {
    return { ...this.registry.status };
  }

  async create(rawInput: CreateLessonInput): Promise<GenerationResult> {
    const input = createLessonInputSchema.parse(rawInput);
    if (input.provider === "demo") {
      const reusable = await this.repository.findReusable(input);
      if (reusable) return { lesson: reusable, reused: true };
      const requestId = randomUUID();
      return this.run(requestId, input, "demo");
    }

    const key = requestKey(input);
    if (this.registry.activeOpenAI) {
      if (this.registry.activeOpenAI.key === key) {
        const lesson = await this.registry.activeOpenAI.promise;
        if (lesson.planProvider !== "openai") throw new Error("The active generation returned an unexpected provider.");
        return { lesson, reused: true };
      }
      throw new Error("OpenAI generation is already running. Wait for it to finish before starting another one.");
    }

    const requestId = randomUUID();
    this.setStatus({ requestId, state: "running", phase: "checking-cache", provider: input.provider, sourceName: input.sourceName, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: null, lessonId: null, reused: false, error: null });
    const promise = this.createOpenAILesson(requestId, input);
    this.registry.activeOpenAI = { key, promise };
    try {
      return { lesson: await promise, reused: false };
    } finally {
      if (this.registry.activeOpenAI?.promise === promise) this.registry.activeOpenAI = null;
    }
  }

  private async createOpenAILesson(requestId: string, input: CreateLessonInput): Promise<Lesson> {
    try {
      const reusable = await this.repository.findReusable(input);
      if (reusable) {
        if (reusable.planProvider !== "openai") throw new Error("The cache returned a provider different from the one requested.");
        this.complete(requestId, reusable, true);
        return reusable;
      }
      return await this.runLesson(requestId, input, "openai");
    } catch (error) {
      if (this.registry.status.requestId === requestId && this.registry.status.state !== "failed") {
        const message = error instanceof Error ? error.message : "Generation failed.";
        this.setStatus({ state: "failed", phase: "failed", updatedAt: new Date().toISOString(), completedAt: new Date().toISOString(), error: message });
      }
      throw error;
    }
  }

  private async run(requestId: string, input: CreateLessonInput, provider: "demo" | "openai"): Promise<GenerationResult> {
    return { lesson: await this.runLesson(requestId, input, provider), reused: false };
  }

  private async runLesson(requestId: string, input: CreateLessonInput, provider: "demo" | "openai"): Promise<Lesson> {
    console.info(`[generation:${requestId}] started provider=${provider} characters=${input.sourceText.length}`);
    try {
      const lesson = await this.serviceFor(provider).create(input, (phase) => this.phase(requestId, phase));
      if (lesson.planProvider !== provider) throw new Error("The generated lesson does not match the requested provider.");
      this.complete(requestId, lesson, false);
      console.info(`[generation:${requestId}] completed provider=${provider} lesson=${lesson.id}`);
      return lesson;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Generation failed.";
      this.setStatus({ state: "failed", phase: "failed", updatedAt: new Date().toISOString(), completedAt: new Date().toISOString(), error: message });
      console.error(`[generation:${requestId}] failed provider=${provider}: ${message}`);
      throw error;
    }
  }

  private phase(requestId: string, phase: Exclude<GenerationPhase, "idle" | "checking-cache" | "completed" | "failed">): void {
    if (this.registry.status.requestId === requestId) this.setStatus({ phase, updatedAt: new Date().toISOString() });
  }

  private complete(requestId: string, lesson: Lesson, reused: boolean): void {
    const provider = lesson.planProvider === "agent" ? null : lesson.planProvider;
    const sourceName = lesson.source.kind === "local-text" ? lesson.source.name : "Course sources";
    this.setStatus({ requestId, state: "completed", phase: "completed", provider, sourceName, updatedAt: new Date().toISOString(), completedAt: new Date().toISOString(), lessonId: lesson.id, reused, error: null });
  }

  private setStatus(update: Partial<GenerationStatus>): void {
    this.registry.status = { ...this.registry.status, ...update };
  }
}

function requestKey(input: CreateLessonInput): string {
  return createHash("sha256").update(JSON.stringify({
    sourceName: input.sourceName,
    sourceText: input.sourceText,
    durationMinutes: input.durationMinutes,
    level: input.level,
    objective: input.objective,
    provider: input.provider,
    contentLanguage: input.contentLanguage,
  })).digest("hex");
}
