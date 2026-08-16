import type { Lesson } from "@/domain/teaching";

export type GenerationPhase = "idle" | "checking-cache" | "planning" | "synthesizing" | "saving" | "completed" | "failed";

export type GenerationStatus = {
  requestId: string | null;
  state: "idle" | "running" | "completed" | "failed";
  phase: GenerationPhase;
  provider: "demo" | "openai" | null;
  sourceName: string | null;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  lessonId: string | null;
  reused: boolean;
  error: string | null;
};

export type GenerationRegistry = {
  activeOpenAI: { key: string; promise: Promise<Lesson> } | null;
  status: GenerationStatus;
};

export function createGenerationRegistry(): GenerationRegistry {
  const now = new Date().toISOString();
  return {
    activeOpenAI: null,
    status: {
      requestId: null,
      state: "idle",
      phase: "idle",
      provider: null,
      sourceName: null,
      startedAt: null,
      updatedAt: now,
      completedAt: null,
      lessonId: null,
      reused: false,
      error: null,
    },
  };
}
