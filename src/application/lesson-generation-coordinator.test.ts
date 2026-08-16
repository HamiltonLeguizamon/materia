import { describe, expect, it, vi } from "vitest";

import { LessonGenerationCoordinator } from "@/application/lesson-generation-coordinator";
import type { Lesson } from "@/domain/teaching";
import { NETWORKING_FIXTURE, NETWORKING_FIXTURE_NAME } from "@/fixtures/networking";

const input = {
  sourceName: NETWORKING_FIXTURE_NAME,
  sourceText: NETWORKING_FIXTURE,
  durationMinutes: 15 as const,
  level: "intermediate" as const,
  objective: "Comprender el recorrido de un paquete y explicarlo con claridad.",
  provider: "openai" as const,
};

describe("lesson generation coordinator", () => {
  it("shares identical OpenAI requests while they are running", async () => {
    let resolve!: (lesson: Lesson) => void;
    const pending = new Promise<Lesson>((done) => { resolve = done; });
    const create = vi.fn(() => pending);
    const coordinator = new LessonGenerationCoordinator(
      { findReusable: vi.fn().mockResolvedValue(null) },
      () => ({ create }),
    );

    const first = coordinator.create(input);
    const second = coordinator.create(input);
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    resolve({ id: "shared", planProvider: "openai", source: { kind: "local-text", name: NETWORKING_FIXTURE_NAME } } as Lesson);
    await expect(Promise.all([first, second])).resolves.toEqual([
      { lesson: { id: "shared", planProvider: "openai", source: { kind: "local-text", name: NETWORKING_FIXTURE_NAME } }, reused: false },
      { lesson: { id: "shared", planProvider: "openai", source: { kind: "local-text", name: NETWORKING_FIXTURE_NAME } }, reused: true },
    ]);
  });

  it("blocks another OpenAI generation until the active one finishes", async () => {
    let resolve!: (lesson: Lesson) => void;
    const pending = new Promise<Lesson>((done) => { resolve = done; });
    const coordinator = new LessonGenerationCoordinator(
      { findReusable: vi.fn().mockResolvedValue(null) },
      () => ({ create: vi.fn(() => pending) }),
    );

    const first = coordinator.create(input);
    await expect(coordinator.create({ ...input, objective: "Aprender un objetivo distinto y suficientemente largo." }))
      .rejects.toThrow(/OpenAI generation is already running/);
    resolve({ id: "finished", planProvider: "openai", source: { kind: "local-text", name: NETWORKING_FIXTURE_NAME } } as Lesson);
    await first;
  });
});
