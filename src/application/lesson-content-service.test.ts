import { describe, expect, it, vi } from "vitest";

import { DemoTeachingPlanProvider } from "@/adapters/demo/demo-providers";
import { LessonContentService } from "@/application/lesson-content-service";
import type { LessonRepository, SpeechProvider } from "@/application/ports";
import { NETWORKING_FIXTURE, NETWORKING_FIXTURE_NAME } from "@/fixtures/networking";

const input = {
  sourceName: NETWORKING_FIXTURE_NAME,
  sourceText: NETWORKING_FIXTURE,
  durationMinutes: 8 as const,
  level: "intermediate" as const,
  objective: "Comprender el recorrido de un paquete y explicarlo con claridad.",
  provider: "openai" as const,
};

describe("lesson content service", () => {
  it("persists a plan with pending audio without constructing or invoking a speech provider", async () => {
    let saved: Parameters<LessonRepository["save"]>[0] | null = null;
    const repository = {
      save: vi.fn(async (lesson) => { saved = lesson; }),
    } as unknown as LessonRepository;
    const forbiddenSpeech: SpeechProvider = {
      profileKey: "forbidden:v1",
      profile: { provider: "openai", nodeId: null, voice: "coral", speed: 1, language: "es", style: "serious", pronunciation: "literal" },
      synthesize: vi.fn(async () => { throw new Error("El contenido no debe sintetizar audio."); }),
    };
    const plan = await new DemoTeachingPlanProvider().createPlan(input);

    const lesson = await new LessonContentService(repository).createFromPlan(input, plan);

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(forbiddenSpeech.synthesize).not.toHaveBeenCalled();
    expect(saved).toEqual(lesson);
    expect(lesson.schemaVersion).toBe(4);
    expect(lesson.origin).toBe("generated");
    expect(lesson.planProvider).toBe("openai");
    expect(Object.values(lesson.audioByChapter)).toHaveLength(plan.chapters.length);
    expect(Object.values(lesson.audioByChapter).every((audio) => audio.status === "pending" && audio.provider === null)).toBe(true);
  });
});
