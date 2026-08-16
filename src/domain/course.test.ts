import { describe, expect, it } from "vitest";

import { courseSchema } from "@/domain/course";

const timestamp = "2026-08-12T12:00:00.000Z";

describe("course domain", () => {
  it("validates internal relationships and rejects external sources", () => {
    const base = {
      schemaVersion: 1 as const,
      id: "22222222-2222-4222-8222-222222222222",
      revision: 1,
      status: "draft" as const,
      title: "Preparación para una certificación técnica",
      summary: "Un curso trazable organizado a partir de los objetivos oficiales de una certificación.",
      certification: { name: "Certificación de ejemplo", examCode: "EX-100", url: "https://learn.microsoft.com/example" },
      level: "intermediate" as const,
      language: "es-ES",
      sources: [{ id: "guide", title: "Guía oficial", url: "https://learn.microsoft.com/guide", publisher: "Microsoft", retrievedAt: timestamp, excerpt: "La guía enumera los objetivos que debe cubrir la certificación.", locator: "Objetivos" }],
      objectives: [{ id: "objective-1", title: "Comprender el primer dominio del examen", weightMinPercent: 10, weightMaxPercent: 20, sourceIds: ["guide"] }],
      modules: [], assessments: [],
      coverage: [{ objectiveId: "objective-1", status: "missing" as const, lessonIds: [], assessmentIds: [], note: "Pendiente de desarrollar." }],
      createdAt: timestamp, updatedAt: timestamp, validatedAt: null, publishedAt: null,
    };
    expect(courseSchema.parse(base).objectives[0].sourceIds).toEqual(["guide"]);
    expect(courseSchema.parse({ ...base, language: "es" }).language).toBe("es-ES");
    expect(() => courseSchema.parse({ ...base, language: "fr" })).toThrow();
    expect(courseSchema.parse({ ...base, level: "intermedio" }).level).toBe("intermediate");
    expect(() => courseSchema.parse({ ...base, objectives: [{ ...base.objectives[0], sourceIds: ["unknown"] }] })).toThrow(/Unknown source/);
    expect(() => courseSchema.parse({ ...base, sources: [...base.sources, base.sources[0]] })).toThrow(/Duplicate/);
  });
});
