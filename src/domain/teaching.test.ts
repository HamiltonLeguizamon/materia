import { describe, expect, it } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";

import { DemoTeachingPlanProvider, NETWORKING_TEACHING_PLAN } from "@/adapters/demo/demo-providers";
import { audioMatchesCurrentNarration, blockListeningTransition, blockNarrationTransition, canonicalizeChapterIds, chapterContentText, chapterNarration, chapterNarrationSegments, createLessonInputSchema, inspectTeachingPlanQuality, lessonSchema, migrateLesson, NARRATION_PROJECTION_VERSION, teachingPlanSchema } from "@/domain/teaching";
import { LEGACY_LESSON_V1 } from "@/fixtures/legacy-lesson-v1";
import { NETWORKING_FIXTURE, NETWORKING_FIXTURE_NAME } from "@/fixtures/networking";

const input = {
  sourceName: NETWORKING_FIXTURE_NAME,
  sourceText: NETWORKING_FIXTURE,
  durationMinutes: 15 as const,
  level: "intermediate" as const,
  objective: "Entender el recorrido de un paquete entre redes.",
  provider: "demo" as const,
  contentLanguage: "es-ES" as const,
};

describe("teaching domain", () => {
  it("rejects chapter IDs that cannot be persisted safely", () => {
    const unsafe = structuredClone(NETWORKING_TEACHING_PLAN);
    unsafe.chapters[0].id = "../escape";
    unsafe.questions[0].chapterId = "../escape";
    expect(() => teachingPlanSchema.parse(unsafe)).toThrow(/stable chapter ID/i);
  });
  it("validates complete input and limits sources that are too short", () => {
    expect(createLessonInputSchema.parse(input).provider).toBe("demo");
    expect(createLessonInputSchema.parse({ ...input, durationMinutes: 8 }).durationMinutes).toBe(8);
    expect(() => createLessonInputSchema.parse({ ...input, sourceText: "demasiado breve" })).toThrow(/300/);
  });

  it("accepts the deterministic teaching artifact", async () => {
    const plan = await new DemoTeachingPlanProvider().createPlan(input);
    expect(teachingPlanSchema.parse(plan).chapters).toHaveLength(4);
    expect(plan.requiredConcepts).toContain("encapsulación");
    expect(plan.chapters[0].blocks.map((block) => block.kind)).toEqual(["scenario", "explanation"]);
    expect(inspectTeachingPlanQuality(plan).map((issue) => issue.code)).not.toContain("single-block-pattern");
  });

  it("converts the plan to the structured format required by OpenAI", () => {
    expect(() => zodTextFormat(teachingPlanSchema, "teaching_plan")).not.toThrow();
  });

  it("normalizes chapter IDs before storing audio", async () => {
    const plan = await new DemoTeachingPlanProvider().createPlan(input);
    const providerPlan = structuredClone(plan);
    providerPlan.chapters = providerPlan.chapters.map((chapter, index) => ({ ...chapter, id: `cap-${index + 1}` }));
    providerPlan.questions = providerPlan.questions.map((question, index) => ({ ...question, chapterId: `cap-${index + 1}` }));
    const normalized = canonicalizeChapterIds(providerPlan);
    expect(normalized.chapters.map((chapter) => chapter.id)).toEqual(["chapter-1", "chapter-2", "chapter-3", "chapter-4"]);
    expect(normalized.questions.map((question) => question.chapterId)).toEqual(["chapter-1", "chapter-2", "chapter-3", "chapter-4"]);
    expect(normalized.chapters[0].estimatedMinutes).toBeCloseTo(chapterNarration(normalized.chapters[0], normalized.title).split(/\s+/).length / 135, 1);
  });

  it("rejects references that do not exist", async () => {
    const plan = await new DemoTeachingPlanProvider().createPlan(input);
    const invalid = structuredClone(plan);
    invalid.chapters[0].blocks[0].referenceIds = ["source-missing"];
    expect(() => teachingPlanSchema.parse(invalid)).toThrow(/Unknown reference/);
  });

  it("migrates a v1 lesson to v4 without losing content, audio, or progress", () => {
    const migrated = migrateLesson(LEGACY_LESSON_V1);
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.origin).toBe("demo");
    expect(migrated.planProvider).toBe("demo");
    expect(migrated.preferences.level).toBe("intermediate");
    expect(chapterContentText(migrated.plan.chapters[0])).toBe(LEGACY_LESSON_V1.plan.chapters[0].narration);
    expect(migrated.audioByChapter["chapter-1"].kind).toBe("browser-speech");
    expect(lessonSchema.parse(migrated)).toEqual(migrated);
    expect(migrateLesson(migrated)).toEqual(migrated);
  });

  it("migrates a v2 lesson to v4 while preserving revisions and audio", () => {
    const { provider, ...legacyFields } = LEGACY_LESSON_V1;
    const versionTwo = {
      ...legacyFields,
      schemaVersion: 2,
      revision: 7,
      origin: "demo",
      planProvider: provider,
      source: { kind: "local-text", ...legacyFields.source },
    };
    const migrated = migrateLesson(versionTwo);
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.revision).toBe(7);
    expect(chapterContentText(migrated.plan.chapters[1])).toBe(versionTwo.plan.chapters[1].narration);
    expect(migrated.audioByChapter["chapter-2"]).toMatchObject(versionTwo.audioByChapter["chapter-2"]);
  });

  it("flags uniform teaching patterns without invalidating legacy plans", () => {
    const legacyShaped = teachingPlanSchema.parse({
      ...NETWORKING_TEACHING_PLAN,
      chapters: NETWORKING_TEACHING_PLAN.chapters.map((chapter, index) => ({
        ...chapter,
        blocks: [{ id: `legacy-${index + 1}`, kind: "explanation", title: null, content: chapterContentText(chapter), referenceIds: [...new Set(chapter.blocks.flatMap((block) => block.referenceIds))], artifacts: [] }],
      })),
    });
    const issues = inspectTeachingPlanQuality(legacyShaped);
    expect(issues.map((issue) => issue.code)).toContain("single-block-pattern");
    expect(teachingPlanSchema.safeParse(legacyShaped).success).toBe(true);
  });

  it("projects guided narration and distinguishes older audio", () => {
    const chapter = NETWORKING_TEACHING_PLAN.chapters[0];
    const narration = chapterNarration(chapter, NETWORKING_TEACHING_PLAN.title);
    expect(narration).toContain(`Comenzamos el capítulo «${chapter.title}»`);
    expect(narration).toContain(blockNarrationTransition(chapter.blocks[0], 0));
    expect(narration).toContain(chapter.blocks[0].content);
    const segments = chapterNarrationSegments(chapter, NETWORKING_TEACHING_PLAN.title);
    expect(segments.map((segment) => segment.role)).toContain("recap");
    expect(segments.find((segment) => segment.role === "transition" && segment.blockId === chapter.blocks[1].id)?.text).toContain(`«${chapter.blocks[0].title}»`);
    expect(blockListeningTransition(chapter.blocks[0], 0)).not.toEqual(blockNarrationTransition(chapter.blocks[0], 0));
    const artifact = { status: "ready" as const, kind: "file" as const, url: "/audio.mp3", mimeType: "audio/mpeg", provider: "qwen" as const, profileKey: "test", speechProfile: null, chunkCount: 1, error: null, generatedAt: new Date().toISOString(), durationSeconds: 3 };
    expect(audioMatchesCurrentNarration({ ...artifact, narrationVersion: null })).toBe(false);
    expect(audioMatchesCurrentNarration({ ...artifact, narrationVersion: NARRATION_PROJECTION_VERSION })).toBe(true);
  });

  it("persists typed artifacts while keeping them out of narration", () => {
    const plan = structuredClone(NETWORKING_TEACHING_PLAN);
    plan.chapters[0].blocks[0].artifacts = [
      { id: "request-example", kind: "code", title: "Petición HTTP", caption: "Una petición mínima para identificar método y recurso.", provenance: "authored", referenceIds: ["source-1"], language: "http", filename: null, code: "GET / HTTP/1.1\nHost: example.test" },
      { id: "packet-flow", kind: "diagram", title: "Recorrido del paquete", caption: "El paquete avanza por decisiones acotadas entre origen y destino.", provenance: "adapted", referenceIds: ["source-1"], direction: "left-right", nodes: [{ id: "client", label: "Cliente", detail: null }, { id: "router", label: "Router", detail: "Elige el siguiente salto" }, { id: "server", label: "Servidor", detail: null }], edges: [{ from: "client", to: "router", label: null }, { from: "router", to: "server", label: "ruta" }] },
      { id: "canonical-figure", kind: "image-reference", title: "Figura canónica", caption: "La documentación original contiene una figura de apoyo para ampliar el concepto.", provenance: "quoted", referenceIds: ["source-1"], url: "https://example.test/figure", alt: "Diagrama de cliente, router y servidor conectados", attribution: "Fuente de ejemplo" },
    ];
    const parsed = teachingPlanSchema.parse(plan);
    expect(parsed.chapters[0].blocks[0].artifacts.map((artifact) => artifact.kind)).toEqual(["code", "diagram", "image-reference"]);
    const narration = chapterNarration(parsed.chapters[0], parsed.title);
    expect(narration).not.toContain("GET / HTTP/1.1");
    expect(narration).not.toContain("https://example.test/figure");
  });

  it("rejects unsafe or structurally invalid artifacts", () => {
    const plan = structuredClone(NETWORKING_TEACHING_PLAN);
    plan.chapters[0].blocks[0].artifacts = [{ id: "unsafe-code", kind: "code", title: "Credencial insegura", caption: "Este ejemplo debe rechazarse antes de persistir el contenido.", provenance: "authored", referenceIds: ["source-1"], language: "text", filename: null, code: ["sk", "abcdefghijklmnopqrstuvwxyz123456"].join("-") }];
    expect(() => teachingPlanSchema.parse(plan)).toThrow(/credentials or private keys/i);
    plan.chapters[0].blocks[0].artifacts = [{ id: "broken-flow", kind: "diagram", title: "Flujo incompleto", caption: "Este diagrama apunta deliberadamente a un nodo que no existe.", provenance: "authored", referenceIds: ["source-1"], direction: "top-bottom", nodes: [{ id: "start", label: "Inicio", detail: null }, { id: "end", label: "Fin", detail: null }], edges: [{ from: "start", to: "missing", label: null }] }];
    expect(() => teachingPlanSchema.parse(plan)).toThrow(/Unknown target node/i);
  });
});
