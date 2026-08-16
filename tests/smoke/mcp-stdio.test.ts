import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { NETWORKING_TEACHING_PLAN } from "@/adapters/demo/demo-providers";
import type { AudioEstimate } from "@/application/selective-audio-service";
import type { CourseValidation } from "@/application/course-service";
import type { Course } from "@/domain/course";
import type { Lesson } from "@/domain/teaching";

type CourseResult = { course: Course };
type LessonResult = { course: Course; lesson: Lesson };

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))); });

describe("Materia MCP stdio smoke", () => {
  it("negotiates the protocol and builds a two-lesson draft without AI", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "materia-mcp-")); roots.push(dataDir);
    const client = new Client({ name: "materia-smoke", version: "1.0.0" }, { versionNegotiation: { mode: "legacy" } });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "--conditions=react-server", path.join(process.cwd(), "src", "mcp", "stdio.ts")],
      cwd: process.cwd(),
      env: { ...process.env, MATERIA_DATA_DIR: dataDir } as Record<string, string>,
      stderr: "pipe",
    });
    let step = "client.connect";
    let failed = false;
    let serverStderr = "";
    transport.stderr?.on("data", (chunk) => {
      serverStderr = `${serverStderr}${String(chunk)}`.slice(-16_384);
    });
    try {
      await client.connect(transport);
      step = "client.listTools";
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name);
      expect(names).toEqual(expect.arrayContaining(["materia_get_capabilities", "materia_get_lesson", "materia_create_course", "materia_upsert_lesson", "materia_validate_course", "materia_publish_course"]));
      expect(names).toEqual(expect.arrayContaining(["materia_estimate_audio", "materia_generate_audio", "materia_get_audio_job"]));
      expect(names.every((name) => name.startsWith("materia_"))).toBe(true);

      step = "materia_get_capabilities";
      const capabilities = await client.callTool({ name: "materia_get_capabilities", arguments: {} });
      expect(capabilities.isError).not.toBe(true);
      expect(capabilities.structuredContent).toMatchObject({ lessonSchemaVersion: 4, learningArtifacts: { kinds: ["code", "diagram", "image-reference"], narrated: false, remoteImagesEmbedded: false, codeExecution: false }, constraints: { contentLanguages: ["en-US", "en-GB", "es-ES"], postImportLessonReview: true, validationIsNotPedagogicalApproval: true, audioAvailable: true, audioRequiresConfirmation: true, hiddenAiCalls: false } });

      step = "materia_create_course:reject-language-alias";
      const invalidLanguage = await client.callTool({ name: "materia_create_course", arguments: { operationId: "mcp-invalid-language", title: "Invalid language course", summary: "This request must fail before any course data is persisted.", level: "intermediate", language: "es" } });
      expect(invalidLanguage.isError).toBe(true);

      const input = { operationId: "mcp-create-course", title: "Curso MCP de prueba", summary: "Un curso creado desde un cliente MCP real para validar el transporte STDIO.", level: "intermediate", language: "es-ES" };
      step = "materia_create_course:first";
      const first = await client.callTool({ name: "materia_create_course", arguments: input });
      step = "materia_create_course:idempotent-replay";
      const second = await client.callTool({ name: "materia_create_course", arguments: input });
      expect(first.isError).not.toBe(true);
      expect(second.structuredContent).toMatchObject({ reused: true });
      const courseId = (first.structuredContent as { course: { id: string } }).course.id;
      expect((second.structuredContent as { course: { id: string } }).course.id).toBe(courseId);

      const timestamp = "2026-08-12T12:00:00.000Z";
      const sources = NETWORKING_TEACHING_PLAN.references.map((reference) => ({ id: reference.id, title: reference.label, url: `https://learn.microsoft.com/training/${reference.id}`, publisher: "Microsoft Learn", retrievedAt: timestamp, excerpt: reference.excerpt, locator: reference.label }));
      step = "materia_upsert_foundation:first";
      const foundation = await invoke(client, "materia_upsert_foundation", { operationId: "mcp-foundation", courseId, expectedRevision: 1, sources, objectives: [{ id: "objective-1", title: "Comprender límites y controles de un sistema agéntico", weightMinPercent: null, weightMaxPercent: null, sourceIds: ["source-1"] }], coverage: [{ objectiveId: "objective-1", status: "missing", lessonIds: [], assessmentIds: [], note: "Pendiente de lecciones." }] });
      step = "materia_upsert_module";
      const moduleResult = await invoke(client, "materia_upsert_module", { operationId: "mcp-module", courseId, expectedRevision: foundation.course.revision, module: { id: "module-1", title: "Límites del agente", summary: "Arquitectura, contexto de ejecución y controles aplicados al ciclo de desarrollo.", position: 1, lessonIds: [] } });
      const artifactPlan = structuredClone(NETWORKING_TEACHING_PLAN);
      artifactPlan.chapters[0].blocks[0].artifacts = [{ id: "execution-boundary", kind: "diagram", title: "Frontera de ejecución", caption: "El contexto limita el agente antes de permitir cualquier efecto sobre el repositorio.", provenance: "authored", referenceIds: ["source-1"], direction: "left-right", nodes: [{ id: "task", label: "Tarea", detail: null }, { id: "context", label: "Contexto", detail: "Repositorio, rama y permisos" }, { id: "effect", label: "Efecto", detail: null }], edges: [{ from: "task", to: "context", label: null }, { from: "context", to: "effect", label: "autoriza" }] }];
      step = "materia_upsert_lesson:first";
      const firstLesson = await invoke(client, "materia_upsert_lesson", { operationId: "mcp-lesson-1", courseId, moduleId: "module-1", expectedRevision: moduleResult.course.revision, sourceIds: sources.map((source) => source.id), durationMinutes: 8, level: "intermediate", objective: "Comprender el contexto y los límites de ejecución de un agente.", plan: { ...artifactPlan, title: "Contexto y límites de ejecución" } });
      step = "materia_upsert_lesson:second";
      const secondLesson = await invoke(client, "materia_upsert_lesson", { operationId: "mcp-lesson-2", courseId, moduleId: "module-1", expectedRevision: firstLesson.course.revision, sourceIds: sources.map((source) => source.id), durationMinutes: 8, level: "intermediate", objective: "Aplicar controles seguros al trabajo autónomo de un agente.", plan: { ...NETWORKING_TEACHING_PLAN, title: "Controles seguros del agente" } });
      step = "materia_get_lesson";
      const readLesson = await invoke<{ lesson: Lesson }>(client, "materia_get_lesson", { lessonId: firstLesson.lesson.id });
      expect(readLesson.lesson).toMatchObject({ id: firstLesson.lesson.id, revision: firstLesson.lesson.revision });
      expect(readLesson.lesson.plan.chapters[0].blocks[0].artifacts[0]).toMatchObject({ id: "execution-boundary", kind: "diagram" });
      const assessment = { id: "module-1-check", moduleId: "module-1", title: "Evaluación de límites", questions: [{ id: "module-1-q1", type: "scenario-single-choice", prompt: "Un agente debe cambiar código. ¿Qué conjunto establece un contexto de ejecución controlado?", options: ["Repositorio, rama, herramientas y permisos.", "Solo el modelo de voz."], expectedOption: 0, explanation: "El contexto restringe tanto el ámbito visible como las acciones autorizadas.", objectiveIds: ["objective-1"], sourceIds: ["source-1"] }] };
      step = "materia_upsert_assessment";
      const assessed = await invoke(client, "materia_upsert_assessment", { operationId: "mcp-assessment", courseId, expectedRevision: secondLesson.course.revision, assessment });
      step = "materia_upsert_foundation:coverage";
      const covered = await invoke(client, "materia_upsert_foundation", { operationId: "mcp-coverage", courseId, expectedRevision: assessed.course.revision, sources, objectives: [{ id: "objective-1", title: "Comprender límites y controles de un sistema agéntico", weightMinPercent: null, weightMaxPercent: null, sourceIds: ["source-1"] }], coverage: [{ objectiveId: "objective-1", status: "covered", lessonIds: [firstLesson.lesson.id, secondLesson.lesson.id], assessmentIds: [assessment.id], note: "Dos lecciones y una evaluación trazable." }] });
      step = "materia_validate_course";
      const validation = await invoke(client, "materia_validate_course", { courseId, markValidated: false });
      expect(validation.valid).toBe(true);
      expect(validation.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "dominant-block-shape", severity: "warning" })]));
      expect(covered.course.modules[0].lessonIds).toHaveLength(2);
      expect(Object.values(firstLesson.lesson.audioByChapter).every((artifact) => (artifact as { status: string }).status === "pending")).toBe(true);

      step = "materia_estimate_audio";
      const estimate = await invoke(client, "materia_estimate_audio", { lessonId: firstLesson.lesson.id, chapterIds: [firstLesson.lesson.plan.chapters[0].id], provider: "openai" });
      expect(estimate).toMatchObject({ lessonId: firstLesson.lesson.id, chapterIds: [firstLesson.lesson.plan.chapters[0].id], cacheHits: [], estimatedCost: null });
    } catch (error) {
      failed = true;
      throw diagnosticError(step, error, serverStderr);
    } finally {
      try {
        await client.close();
      } catch (error) {
        if (!failed) throw diagnosticError("client.close", error, serverStderr);
      }
    }
  }, 60_000);
});

async function invoke<Result = CourseResult & LessonResult & CourseValidation & AudioEstimate>(client: Client, name: string, args: Record<string, unknown>): Promise<Result> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, `${name}: ${JSON.stringify(result.content)}`).not.toBe(true);
  return result.structuredContent as Result;
}

function diagnosticError(step: string, error: unknown, stderr: string): Error {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const serverOutput = stderr.trim() || "(sin salida en stderr)";
  return new Error(`MCP smoke falló en ${step}. ${message}\nServidor MCP stderr:\n${serverOutput}`, { cause: error });
}
