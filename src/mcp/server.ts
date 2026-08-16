import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { CourseService } from "@/application/course-service";
import type { SelectiveAudioService } from "@/application/selective-audio-service";
import { kokoroConfigured, openAiConfigured, qwenConfigured } from "@/config/runtime-models";
import { courseAssessmentSchema, courseModuleSchema, courseSourceSchema, coverageEntrySchema, learningObjectiveSchema } from "@/domain/course";
import { lessonDurationSchema, lessonLevelSchema, teachingPlanSchema } from "@/domain/teaching";
import { KOKORO_SPEECH_VOICES, OPENAI_SPEECH_VOICES, QWEN_SPEECH_VOICES } from "@/domain/speech-options";
import { CONTENT_LANGUAGES } from "@/i18n/locale";

const mutating = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const destructive = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const speechProfileInput = z.object({ nodeId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).nullable().default(null), voice: z.string().min(1), speed: z.number().min(0.5).max(2).default(1), language: z.enum(["es", "en-us", "en-gb"]).default("es"), style: z.enum(["neutral", "serious", "warm"]).default("neutral"), pronunciation: z.enum(["literal", "technical-es"]).default("literal") });

export function createMateriaMcpServer(service: CourseService, audio?: SelectiveAudioService): McpServer {
  const server = new McpServer(
    { name: "materia", version: "0.1.0" },
    { instructions: "Materia stores agent-authored learning courses. Research and cite public sources before writing. Write the course in the language requested by the user; default to English when no language is specified. Derive lesson and chapter scope from conceptual complexity and evidence, never from a preferred duration or repeated template. Write for both reading and guided listening: semantic blocks need purposeful titles and coherent transitions. After every lesson import, read the persisted lesson back, audit whether it actually teaches its objective, and revise thin, repetitive, or awkward material before authoring the next lesson. Create drafts incrementally with stable operationId values, inspect course and lesson revisions before every mutation, validate before publishing, and never imply that importing or studying calls an AI model. Estimate audio first and call generation only after the user explicitly authorizes that exact selection." },
  );

  registerMateriaTool(server, "get_capabilities", {
    title: "Get Materia capabilities",
    description: "Inspect the supported course-authoring workflow, limits, and cost boundaries before creating content.",
    inputSchema: z.object({}), annotations: readOnly,
  }, async () => ({
    transports: ["stdio"], courseSchemaVersion: 1, lessonSchemaVersion: 4, narrationProjectionVersion: 3,
    learningArtifacts: {
      kinds: ["code", "diagram", "image-reference"],
      narrated: false,
      remoteImagesEmbedded: false,
      codeExecution: false,
    },
    workflow: ["create-course", "upsert-foundation", "upsert-module", "upsert-lesson", "get-lesson-audit", "revise-until-sufficient", "upsert-assessment", "validate-course", "publish-course", "estimate-audio", "generate-confirmed-audio", "poll-audio-job"],
    constraints: { draftFirst: true, explicitRevisions: true, idempotentMutations: true, contentLanguages: CONTENT_LANGUAGES, postImportLessonReview: true, validationIsNotPedagogicalApproval: true, audioAvailable: Boolean(audio), openAiConfigured: openAiConfigured(), kokoroConfigured: kokoroConfigured(), qwenConfigured: qwenConfigured(), audioProviders: ["demo", "openai", "kokoro", "qwen", "chatterbox"], speechVoices: { openai: OPENAI_SPEECH_VOICES, kokoro: KOKORO_SPEECH_VOICES, qwen: QWEN_SPEECH_VOICES, chatterbox: "dynamic-by-node" }, speechLanguages: ["es", "en-us", "en-gb"], speechStyles: { openai: ["neutral", "serious", "warm"], kokoro: ["neutral"], qwen: ["serious"], chatterbox: ["neutral"] }, audioRequiresConfirmation: true, maxChaptersPerAudioJob: 3, hiddenAiCalls: false },
  }));

  registerMateriaTool(server, "list_courses", {
    title: "List Materia courses", description: "List locally stored courses with compact status and revision metadata.", inputSchema: z.object({}), annotations: readOnly,
  }, async () => ({ courses: (await service.listCourses()).map((course) => ({ id: course.id, title: course.title, status: course.status, revision: course.revision, moduleCount: course.modules.length, updatedAt: course.updatedAt })) }));

  registerMateriaTool(server, "get_course", {
    title: "Get Materia course", description: "Read a complete local course draft, including sources, coverage, modules, assessments, status, and revision.", inputSchema: z.object({ courseId: z.string().uuid() }), annotations: readOnly,
  }, async ({ courseId }) => ({ course: await service.getCourse(courseId) }));

  registerMateriaTool(server, "get_lesson", {
    title: "Get Materia lesson",
    description: "Read one complete lesson, including its current revision, semantic teaching plan, narration-ready blocks, progress, and audio metadata. Use this before revising an existing lesson.",
    inputSchema: z.object({ lessonId: z.string().uuid() }), annotations: readOnly,
  }, async ({ lessonId }) => ({ lesson: await service.getLesson(lessonId) }));

  registerMateriaTool(server, "create_course", {
    title: "Create course draft", description: "Create an empty course draft. language must be en-US, en-GB, or es-ES. Reuse operationId when retrying the exact same request.",
    inputSchema: z.object({ operationId: z.string().min(1).max(128), title: z.string().min(3).max(180), summary: z.string().min(20).max(1000), certification: z.object({ name: z.string().min(3).max(180), examCode: z.string().min(2).max(40).nullable().optional(), url: z.string().url().nullable().optional() }).nullable().optional(), level: lessonLevelSchema, language: z.enum(CONTENT_LANGUAGES).default("en-US") }), annotations: mutating,
  }, (input) => service.createCourse(input));

  registerMateriaTool(server, "upsert_foundation", {
    title: "Set sources, objectives, and coverage", description: "Replace the course foundation atomically. Sources must be canonical public URLs and every objective must link to source IDs.",
    inputSchema: z.object({ operationId: z.string().min(1).max(128), courseId: z.string().uuid(), expectedRevision: z.number().int().positive(), sources: z.array(courseSourceSchema).max(200), objectives: z.array(learningObjectiveSchema).max(80), coverage: z.array(coverageEntrySchema).max(80) }), annotations: mutating,
  }, (input) => service.upsertFoundation(input));

  registerMateriaTool(server, "upsert_module", {
    title: "Create or update a course module", description: "Upsert one ordered module using its stable ID. Pass the current course revision.",
    inputSchema: z.object({ operationId: z.string().min(1).max(128), courseId: z.string().uuid(), expectedRevision: z.number().int().positive(), module: courseModuleSchema }), annotations: mutating,
  }, (input) => service.upsertModule(input));

  registerMateriaTool(server, "upsert_lesson", {
    title: "Create or revise an agent-authored lesson", description: "Import a complete semantic teaching plan without invoking text generation or TTS. Duration is a descriptive estimate, never a compression target. Chapters and blocks must follow conceptual boundaries and may vary substantially in count and length. Use purpose-specific blocks such as explanation, example, scenario, procedure, comparison, pitfall, reflection or summary; avoid repeated templates and preview the guided-listening flow before import. After import, read the persisted lesson with materia_get_lesson and audit teaching sufficiency, evidence, structural variety, assessment quality, and oral flow before continuing. On update, first read the lesson and pass lessonId plus expectedLessonRevision. Every block reference ID must be included in sourceIds.",
    inputSchema: z.object({ operationId: z.string().min(1).max(128), courseId: z.string().uuid(), moduleId: z.string().min(1).max(64), expectedRevision: z.number().int().positive(), lessonId: z.string().uuid().optional(), expectedLessonRevision: z.number().int().positive().optional(), sourceIds: z.array(z.string().min(1)).min(1).max(24), durationMinutes: lessonDurationSchema, level: lessonLevelSchema, objective: z.string().min(10).max(500), plan: teachingPlanSchema }), annotations: mutating,
  }, (input) => service.upsertLesson(input));

  registerMateriaTool(server, "upsert_assessment", {
    title: "Create or update a module assessment", description: "Upsert a deterministic local assessment whose questions cite course objectives and sources.",
    inputSchema: z.object({ operationId: z.string().min(1).max(128), courseId: z.string().uuid(), expectedRevision: z.number().int().positive(), assessment: courseAssessmentSchema }), annotations: mutating,
  }, (input) => service.upsertAssessment(input));

  registerMateriaTool(server, "delete_assessment", {
    title: "Delete a course assessment",
    description: "Delete one obsolete assessment after explicit confirmation and remove its coverage links. Use this to clean up superseded assessment records without editing persistence files.",
    inputSchema: z.object({ operationId: z.string().min(1).max(128), courseId: z.string().uuid(), expectedRevision: z.number().int().positive(), assessmentId: z.string().min(1).max(64), confirmed: z.literal(true) }), annotations: destructive,
  }, (input) => service.deleteAssessment(input));

  const validationInput = z.discriminatedUnion("markValidated", [z.object({ markValidated: z.literal(false), courseId: z.string().uuid() }), z.object({ markValidated: z.literal(true), operationId: z.string().min(1).max(128), courseId: z.string().uuid(), expectedRevision: z.number().int().positive() })]);
  server.registerTool("materia_validate_course", {
    title: "Validate course draft", description: "Inspect structural, provenance, coverage, lesson, and assessment issues. Structural validity is not pedagogical approval: resolve or explicitly justify every warning after rereading the persisted lessons. With markValidated=true, persist validated status only when no errors remain.",
    inputSchema: validationInput, annotations: mutating,
  }, async (input) => resultOf(async () => {
    if (input.markValidated) return service.markValidated(input);
    return service.validateCourse(input.courseId);
  }));

  registerMateriaTool(server, "publish_course", {
    title: "Publish validated course", description: "Publish a validated course after explicit user confirmation. Publishing does not generate audio.",
    inputSchema: z.object({ operationId: z.string().min(1).max(128), courseId: z.string().uuid(), expectedRevision: z.number().int().positive(), confirmed: z.literal(true) }), annotations: mutating,
  }, (input) => service.publish(input));

  if (audio) {
    registerMateriaTool(server, "estimate_audio", {
      title: "Estimate selected lesson audio",
      description: "Estimate characters and duration for specific chapters without calling a speech model or incurring API cost. Review this result with the user before generation.",
      inputSchema: z.object({ lessonId: z.string().uuid(), chapterIds: z.array(z.string().min(1)).min(1).max(3), provider: z.enum(["demo", "openai", "kokoro", "qwen", "chatterbox"]).default("openai"), profile: speechProfileInput.optional() }), annotations: readOnly,
    }, (input) => audio.estimate(input));

    registerMateriaTool(server, "generate_audio", {
      title: "Generate explicitly confirmed audio",
      description: "Start speech generation for at most three selected chapters. Call only after showing the estimate and receiving explicit user authorization. Retry the identical request with the same operationId.",
      inputSchema: z.object({ operationId: z.string().min(1).max(128), lessonId: z.string().uuid(), expectedLessonRevision: z.number().int().positive(), chapterIds: z.array(z.string().min(1)).min(1).max(3), provider: z.enum(["demo", "openai", "kokoro", "qwen", "chatterbox"]).default("openai"), profile: speechProfileInput.optional(), confirmed: z.literal(true) }), annotations: mutating,
    }, (input) => audio.start(input));

    registerMateriaTool(server, "get_audio_job", {
      title: "Get audio job status",
      description: "Poll a previously started audio job. This read-only operation never calls a speech model.",
      inputSchema: z.object({ jobId: z.string().uuid() }), annotations: readOnly,
    }, async ({ jobId }) => ({ job: await audio.getJob(jobId) }));
  }

  return server;
}

function registerMateriaTool<Shape extends z.ZodRawShape, Result>(server: McpServer, suffix: string, config: { title: string; description: string; inputSchema: z.ZodObject<Shape>; annotations: typeof readOnly | typeof mutating | typeof destructive }, handler: (input: z.infer<z.ZodObject<Shape>>) => Promise<Result> | Result): void {
  server.registerTool(`materia_${suffix}`, config, (input) => resultOf(() => handler(input as z.infer<z.ZodObject<Shape>>)));
}

async function resultOf<Result>(handler: () => Promise<Result> | Result) {
  try {
    const result = await handler();
    const structured = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    return { content: [{ type: "text" as const, text: JSON.stringify(structured) }], structuredContent: structured };
  } catch (error) {
    return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : "The Materia operation failed." }], isError: true };
  }
}
