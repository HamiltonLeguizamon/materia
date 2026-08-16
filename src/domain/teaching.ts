import { z } from "zod";

import { lessonLevelSchema, persistedLessonLevelSchema } from "@/domain/lesson-level";
import { asContentLanguage } from "@/i18n/locale";

export { lessonLevelSchema };
export const lessonDurationSchema = z.number().int().min(1).max(180);
export const chapterIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Use a stable chapter ID with lowercase letters and hyphens.");
export const teachingBlockIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Use a stable block ID with lowercase letters and hyphens.");
export const learningArtifactIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Use a stable artifact ID with lowercase letters and hyphens.");

export const sourceReferenceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  excerpt: z.string().min(1).max(1200),
  startLine: z.number().int().positive().nullable(),
  endLine: z.number().int().positive().nullable(),
});

export const teachingBlockKindSchema = z.enum([
  "explanation",
  "example",
  "scenario",
  "procedure",
  "comparison",
  "pitfall",
  "reflection",
  "summary",
]);

export const NARRATION_PROJECTION_VERSION = 3;

export const TEACHING_BLOCK_LABELS = {
  explanation: "Explanation",
  example: "Example",
  scenario: "Scenario",
  procedure: "Procedure",
  comparison: "Comparison",
  pitfall: "Common pitfall",
  reflection: "Reflection",
  summary: "Summary",
} as const;

const artifactBase = {
  id: learningArtifactIdSchema,
  title: z.string().min(3).max(140),
  caption: z.string().min(10).max(600),
  provenance: z.enum(["quoted", "adapted", "authored"]),
  referenceIds: z.array(z.string().min(1)).min(1).max(8),
};

export const codeLearningArtifactSchema = z.object({
  ...artifactBase,
  kind: z.literal("code"),
  language: z.string().regex(/^[a-z0-9+#.-]{1,32}$/i, "Use a short language identifier."),
  code: z.string().min(1).max(12_000),
  filename: z.string().min(1).max(160).nullable(),
});

export const diagramLearningArtifactSchema = z.object({
  ...artifactBase,
  kind: z.literal("diagram"),
  direction: z.enum(["left-right", "top-bottom"]),
  nodes: z.array(z.object({
    id: learningArtifactIdSchema,
    label: z.string().min(1).max(120),
    detail: z.string().min(1).max(280).nullable(),
  })).min(2).max(12),
  edges: z.array(z.object({
    from: learningArtifactIdSchema,
    to: learningArtifactIdSchema,
    label: z.string().min(1).max(120).nullable(),
  })).min(1).max(20),
}).superRefine((artifact, context) => {
  const nodeIds = new Set(artifact.nodes.map((node) => node.id));
  if (nodeIds.size !== artifact.nodes.length) context.addIssue({ code: "custom", message: "Diagram node IDs must be unique.", path: ["nodes"] });
  artifact.edges.forEach((edge, edgeIndex) => {
    if (!nodeIds.has(edge.from)) context.addIssue({ code: "custom", message: `Unknown source node: ${edge.from}`, path: ["edges", edgeIndex, "from"] });
    if (!nodeIds.has(edge.to)) context.addIssue({ code: "custom", message: `Unknown target node: ${edge.to}`, path: ["edges", edgeIndex, "to"] });
  });
});

export const imageReferenceLearningArtifactSchema = z.object({
  ...artifactBase,
  kind: z.literal("image-reference"),
  url: z.string().url().refine((url) => url.startsWith("https://"), "Image references must use HTTPS."),
  alt: z.string().min(10).max(500),
  attribution: z.string().min(3).max(300),
});

export const learningArtifactSchema = z.discriminatedUnion("kind", [
  codeLearningArtifactSchema,
  diagramLearningArtifactSchema,
  imageReferenceLearningArtifactSchema,
]);

const obviousSecretPattern = /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[a-z0-9_-]{20,}|\bgh[opusr]_[a-z0-9]{20,}|\bAIza[0-9A-Za-z_-]{20,})/i;

export const teachingBlockSchema = z.object({
  id: teachingBlockIdSchema,
  kind: teachingBlockKindSchema,
  title: z.string().min(3).max(120).nullable(),
  content: z.string().min(40).max(6000),
  referenceIds: z.array(z.string().min(1)).min(1).max(8),
  artifacts: z.array(learningArtifactSchema).max(6),
});

const legacyTeachingBlockSchema = teachingBlockSchema.omit({ artifacts: true });

const legacyBlockTeachingChapterSchema = z.object({
  id: chapterIdSchema,
  title: z.string().min(3).max(120),
  purpose: z.string().min(10).max(400),
  blocks: z.array(legacyTeachingBlockSchema).min(1).max(12),
  estimatedMinutes: z.number().positive().max(30),
  keyPoints: z.array(z.string().min(3).max(240)).min(1).max(6),
});

export const teachingChapterSchema = z.object({
  id: chapterIdSchema,
  title: z.string().min(3).max(120),
  purpose: z.string().min(10).max(400),
  blocks: z.array(teachingBlockSchema).min(1).max(12),
  estimatedMinutes: z.number().positive().max(30),
  keyPoints: z.array(z.string().min(3).max(240)).min(1).max(6),
});

export const reviewQuestionSchema = z.object({
  id: z.string().min(1),
  chapterId: chapterIdSchema,
  prompt: z.string().min(8).max(300),
  options: z.array(z.string().min(1).max(240)).min(2).max(5),
  expectedOption: z.number().int().nonnegative(),
  explanation: z.string().min(10).max(600),
}).refine((value) => value.expectedOption < value.options.length, {
  message: "The expected answer must point to an existing option.",
  path: ["expectedOption"],
});

const teachingPlanBase = {
  title: z.string().min(3).max(140),
  summary: z.string().min(20).max(600),
  objectives: z.array(z.string().min(8).max(240)).min(1).max(6),
  requiredConcepts: z.array(z.string().min(2).max(120)).min(2).max(16),
  references: z.array(sourceReferenceSchema).min(1).max(24),
  questions: z.array(reviewQuestionSchema).min(1).max(16),
  closing: z.string().min(20).max(1200),
  recommendedReview: z.array(z.string().min(4).max(240)).min(1).max(6),
};

export const teachingPlanSchema = z.object({
  ...teachingPlanBase,
  chapters: z.array(teachingChapterSchema).min(1).max(20),
}).superRefine((plan, context) => {
  const references = new Set(plan.references.map((item) => item.id));
  const chapters = new Set(plan.chapters.map((item) => item.id));
  if (chapters.size !== plan.chapters.length) context.addIssue({ code: "custom", message: "Chapter IDs must be unique.", path: ["chapters"] });
  const blockIds = new Set<string>();
  const artifactIds = new Set<string>();
  for (const [chapterIndex, chapter] of plan.chapters.entries()) {
    if (chapterNarration(chapter, plan.title).length > 9000) context.addIssue({ code: "custom", message: "The chapter's narrated content exceeds 9,000 characters.", path: ["chapters", chapterIndex, "blocks"] });
    for (const [blockIndex, block] of chapter.blocks.entries()) {
      if (blockIds.has(block.id)) context.addIssue({ code: "custom", message: `Duplicate block: ${block.id}`, path: ["chapters", chapterIndex, "blocks", blockIndex, "id"] });
      blockIds.add(block.id);
      for (const referenceId of block.referenceIds) {
        if (!references.has(referenceId)) context.addIssue({ code: "custom", message: `Unknown reference: ${referenceId}`, path: ["chapters", chapterIndex, "blocks", blockIndex, "referenceIds"] });
      }
      for (const [artifactIndex, artifact] of block.artifacts.entries()) {
        const artifactPath = ["chapters", chapterIndex, "blocks", blockIndex, "artifacts", artifactIndex];
        if (artifactIds.has(artifact.id)) context.addIssue({ code: "custom", message: `Duplicate artifact: ${artifact.id}`, path: [...artifactPath, "id"] });
        artifactIds.add(artifact.id);
        for (const referenceId of artifact.referenceIds) {
          if (!references.has(referenceId)) context.addIssue({ code: "custom", message: `Unknown artifact reference: ${referenceId}`, path: [...artifactPath, "referenceIds"] });
          if (!block.referenceIds.includes(referenceId)) context.addIssue({ code: "custom", message: `Artifact reference ${referenceId} must also be linked from its teaching block.`, path: [...artifactPath, "referenceIds"] });
        }
        if (artifact.kind === "code" && obviousSecretPattern.test(artifact.code)) context.addIssue({ code: "custom", message: "Code artifacts must not contain credentials or private keys.", path: [...artifactPath, "code"] });
      }
    }
  }
  for (const [questionIndex, question] of plan.questions.entries()) {
    if (!chapters.has(question.chapterId)) context.addIssue({ code: "custom", message: `Unknown chapter: ${question.chapterId}`, path: ["questions", questionIndex, "chapterId"] });
  }
  for (const chapter of plan.chapters) {
    if (!plan.questions.some((question) => question.chapterId === chapter.id)) context.addIssue({ code: "custom", message: `Chapter ${chapter.id} needs at least one review question.`, path: ["questions"] });
  }
});

const legacyTeachingChapterSchema = z.object({
  id: chapterIdSchema,
  title: z.string().min(3).max(120),
  purpose: z.string().min(10).max(400),
  narration: z.string().min(80).max(9000),
  estimatedMinutes: z.number().positive().max(30),
  referenceIds: z.array(z.string().min(1)).min(1).max(8),
  keyPoints: z.array(z.string().min(3).max(240)).min(1).max(6),
});

const legacyTeachingPlanSchema = z.object({
  ...teachingPlanBase,
  chapters: z.array(legacyTeachingChapterSchema).min(1).max(20),
});

const legacyBlockTeachingPlanSchema = z.object({
  ...teachingPlanBase,
  chapters: z.array(legacyBlockTeachingChapterSchema).min(1).max(20),
});

export type TeachingPlan = z.infer<typeof teachingPlanSchema>;
export type TeachingChapter = z.infer<typeof teachingChapterSchema>;
export type TeachingBlock = z.infer<typeof teachingBlockSchema>;
export type LearningArtifact = z.infer<typeof learningArtifactSchema>;
export type TeachingBlockKind = z.infer<typeof teachingBlockKindSchema>;
export type { LessonLevel } from "@/domain/lesson-level";
export type LessonDuration = z.infer<typeof lessonDurationSchema>;
export type ChapterNarrationSegment = {
  role: "opening" | "transition" | "content" | "recap";
  blockId: string | null;
  blockKind: TeachingBlockKind | null;
  text: string;
};

function asSentence(value: string): string {
  const trimmed = value.trim();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function chapterListeningIntroduction(chapter: TeachingChapter, lessonTitle?: string, language = "es-ES"): string {
  if (asContentLanguage(language) !== "es-ES") {
    const context = lessonTitle ? `, from the lesson “${lessonTitle}”` : "";
    return `We begin the chapter “${chapter.title}”${context}. Our goal is to ${asSentence(chapter.purpose).replace(/^./, (letter) => letter.toLocaleLowerCase("en"))}`;
  }
  const context = lessonTitle ? `, dentro de la lección «${lessonTitle}»` : "";
  return `Comenzamos el capítulo «${chapter.title}»${context}. Nuestro objetivo es ${asSentence(chapter.purpose).replace(/^./, (letter) => letter.toLocaleLowerCase("es"))}`;
}

export function blockListeningTransition(block: TeachingBlock, index: number, language = "es-ES"): string {
  const first = index === 0;
  if (asContentLanguage(language) !== "es-ES") {
    const leadByKind: Record<TeachingBlockKind, string> = {
      explanation: first ? "Let us start with the main idea" : "With that foundation, let us clarify the next idea",
      example: first ? "Let us start with a concrete example" : "Now let us see it in a concrete example",
      scenario: first ? "Let us begin with a concrete scenario" : "Let us apply this idea to a concrete scenario",
      procedure: first ? "Let us start with the procedure" : "With that foundation, let us move to the procedure",
      comparison: first ? "To set the scene, let us start with a comparison" : "Now let us contrast the two possibilities",
      pitfall: first ? "Let us start with a common pitfall" : "Before moving on, let us pause at a common pitfall",
      reflection: first ? "Let us start with a question to consider" : "Let us pause for a moment to reflect",
      summary: "To close, let us bring together the essentials",
    };
    return block.title ? `${leadByKind[block.kind]}: ${asSentence(block.title)}` : `${leadByKind[block.kind]}.`;
  }
  const leadByKind: Record<TeachingBlockKind, string> = {
    explanation: first ? "Empecemos por la idea principal" : "Con esta base, aclaremos la idea siguiente",
    example: first ? "Empecemos con un ejemplo concreto" : "Veámoslo ahora con un ejemplo concreto",
    scenario: first ? "Situémonos en un escenario concreto" : "Llevemos esta idea a un escenario concreto",
    procedure: first ? "Empecemos por el procedimiento" : "Con esta base, pasemos al procedimiento",
    comparison: first ? "Para situarnos, empecemos con una comparación" : "Ahora contrastemos las dos posibilidades",
    pitfall: first ? "Empecemos por un error frecuente" : "Antes de avanzar, detengámonos en un error frecuente",
    reflection: first ? "Empecemos con una pregunta para pensar" : "Hagamos una pausa para pensar",
    summary: "Para cerrar, reunamos lo esencial",
  };
  return block.title ? `${leadByKind[block.kind]}: ${asSentence(block.title)}` : `${leadByKind[block.kind]}.`;
}

function titledBlock(block: TeachingBlock): string {
  return block.title ? ` «${block.title}»` : "";
}

export function blockNarrationTransition(block: TeachingBlock, index: number, previousBlock?: TeachingBlock, language = "es-ES"): string {
  if (asContentLanguage(language) !== "es-ES") {
    if (index === 0 || !previousBlock) {
      const openingByKind: Record<TeachingBlockKind, string> = {
        explanation: "To build a clear foundation, we will begin with the main idea",
        example: "To get started, we will begin with a concrete example",
        scenario: "To frame the problem, we will begin with a concrete scenario",
        procedure: "To get started, we will first walk through the procedure",
        comparison: "To understand the starting point, we will first contrast two possibilities",
        pitfall: "To get started, we will first recognize a common pitfall",
        reflection: "To open the chapter, let us first pause at a question",
        summary: "This chapter brings its essential ideas together directly",
      };
      return `${openingByKind[block.kind]}${block.title ? ` “${block.title}”` : ""}.`;
    }
    const previous = previousBlock.title ? `“${previousBlock.title}”` : "the previous block";
    const title = block.title ? ` “${block.title}”` : "";
    const bridgeByKind: Record<TeachingBlockKind, string> = {
      explanation: `Using ${previous} as our starting point, we will now clarify the idea${title}`,
      example: `We now have the foundation from ${previous}. Let us see how it appears in an example${title}`,
      scenario: `Building on ${previous}, let us apply the decision to a concrete scenario${title}`,
      procedure: `The previous idea is now in place. We will turn it into action through the procedure${title}`,
      comparison: `To sharpen what we learned in ${previous}, let us now contrast the alternatives${title}`,
      pitfall: `With ${previous} in mind, it is useful to recognize where this reasoning commonly fails${title}`,
      reflection: `After ${previous}, let us pause to consider the question${title}`,
      summary: `After working through ${previous}, let us bring the conclusion together in the summary${title}`,
    };
    return `${bridgeByKind[block.kind]}.`;
  }
  if (index === 0 || !previousBlock) {
    const openingByKind: Record<TeachingBlockKind, string> = {
      explanation: "Para construir una base clara, empezaremos por la idea principal",
      example: "Para entrar en materia, comenzaremos con un ejemplo concreto",
      scenario: "Para situar el problema, comenzaremos con un escenario concreto",
      procedure: "Para entrar en materia, recorreremos primero el procedimiento",
      comparison: "Para entender el punto de partida, contrastaremos primero dos posibilidades",
      pitfall: "Para entrar en materia, reconoceremos primero un error frecuente",
      reflection: "Para abrir el capítulo, detengámonos primero en una pregunta",
      summary: "Este capítulo reúne directamente sus ideas esenciales",
    };
    return `${openingByKind[block.kind]}${titledBlock(block)}.`;
  }

  const previous = previousBlock.title ? `«${previousBlock.title}»` : `el bloque anterior`;
  const bridgeByKind: Record<TeachingBlockKind, string> = {
    explanation: `Con ${previous} como punto de partida, ahora aclararemos la idea${titledBlock(block)}`,
    example: `Ya tenemos la base de ${previous}. Veamos cómo se manifiesta en un ejemplo${titledBlock(block)}`,
    scenario: `A partir de ${previous}, llevemos la decisión a un escenario concreto${titledBlock(block)}`,
    procedure: `La idea anterior ya está situada. Ahora la convertiremos en una forma de actuar mediante el procedimiento${titledBlock(block)}`,
    comparison: `Para precisar lo aprendido en ${previous}, contrastemos ahora las alternativas${titledBlock(block)}`,
    pitfall: `Con ${previous} en mente, conviene reconocer dónde suele fallar este razonamiento${titledBlock(block)}`,
    reflection: `Después de ${previous}, hagamos una pausa para pensar en la pregunta${titledBlock(block)}`,
    summary: `Después de recorrer ${previous}, reunamos la conclusión en la síntesis${titledBlock(block)}`,
  };
  return `${bridgeByKind[block.kind]}.`;
}

export function chapterNarrationSegments(chapter: TeachingChapter, lessonTitle?: string, language = "es-ES"): ChapterNarrationSegment[] {
  const segments: ChapterNarrationSegment[] = [{
    role: "opening",
    blockId: null,
    blockKind: null,
    text: chapterListeningIntroduction(chapter, lessonTitle, language),
  }];
  chapter.blocks.forEach((block, index) => {
    segments.push({ role: "transition", blockId: block.id, blockKind: block.kind, text: blockNarrationTransition(block, index, chapter.blocks[index - 1], language) });
    segments.push({ role: "content", blockId: block.id, blockKind: block.kind, text: block.content.trim() });
  });
  if (chapter.blocks.at(-1)?.kind !== "summary") {
    const english = asContentLanguage(language) !== "es-ES";
    const ordinal = english ? ["First", "Second", "Third", "Fourth", "Fifth", "Sixth"] : ["Primera", "Segunda", "Tercera", "Cuarta", "Quinta", "Sexta"];
    const recap = chapter.keyPoints.length === 1
      ? english ? `Before closing, let us keep one idea in mind. ${asSentence(chapter.keyPoints[0])}` : `Antes de cerrar, quedémonos con una idea. ${asSentence(chapter.keyPoints[0])}`
      : english ? `Before closing, let us recall ${chapter.keyPoints.length} ideas. ${chapter.keyPoints.map((point, index) => `${ordinal[index]}: ${asSentence(point)}`).join(" ")}` : `Antes de cerrar, recordemos ${chapter.keyPoints.length} ideas. ${chapter.keyPoints.map((point, index) => `${ordinal[index]}: ${asSentence(point)}`).join(" ")}`;
    segments.push({
      role: "recap",
      blockId: null,
      blockKind: null,
      text: recap,
    });
  }
  return segments;
}

export function chapterContentText(chapter: TeachingChapter): string {
  return chapter.blocks.map((block) => block.content.trim()).filter(Boolean).join("\n\n");
}

export function chapterNarration(chapter: TeachingChapter, lessonTitle?: string, language = "es-ES"): string {
  return chapterNarrationSegments(chapter, lessonTitle, language).map((segment) => segment.text).filter(Boolean).join("\n\n");
}

export function chapterReferenceIds(chapter: TeachingChapter): string[] {
  return [...new Set(chapter.blocks.flatMap((block) => block.referenceIds))];
}

export function migrateTeachingPlan(raw: unknown): TeachingPlan {
  const current = teachingPlanSchema.safeParse(raw);
  if (current.success) return current.data;
  const legacyBlocks = legacyBlockTeachingPlanSchema.safeParse(raw);
  if (legacyBlocks.success) return teachingPlanSchema.parse({
    ...legacyBlocks.data,
    chapters: legacyBlocks.data.chapters.map((chapter) => ({
      ...chapter,
      blocks: chapter.blocks.map((block) => ({ ...block, artifacts: [] })),
    })),
  });
  const legacy = legacyTeachingPlanSchema.parse(raw);
  return teachingPlanSchema.parse({
    ...legacy,
    chapters: legacy.chapters.map(({ narration, referenceIds, ...chapter }, chapterIndex) => ({
      ...chapter,
      blocks: [{
        id: `chapter-${chapterIndex + 1}-block-1`,
        kind: "explanation",
        title: null,
        content: narration,
        referenceIds,
        artifacts: [],
      }],
    })),
  });
}

export function canonicalizeChapterIds(plan: TeachingPlan): TeachingPlan {
  const chapterIds = new Map(plan.chapters.map((chapter, index) => [chapter.id, `chapter-${index + 1}`]));
  return teachingPlanSchema.parse({
    ...plan,
    chapters: plan.chapters.map((chapter, chapterIndex) => ({
      ...chapter,
      id: chapterIds.get(chapter.id),
      blocks: chapter.blocks.map((block, blockIndex) => ({ ...block, id: `chapter-${chapterIndex + 1}-block-${blockIndex + 1}` })),
      estimatedMinutes: Math.min(30, Math.max(0.1, Math.round((chapterNarration(chapter, plan.title).split(/\s+/).length / 135) * 10) / 10)),
    })),
    questions: plan.questions.map((question) => ({ ...question, chapterId: chapterIds.get(question.chapterId) || question.chapterId })),
  });
}

export type TeachingQualityIssue = {
  code: "uniform-chapter-length" | "missing-applied-block" | "single-block-pattern" | "thin-chapter-pattern" | "repeated-block-sequence";
  message: string;
  path: string;
};

export function inspectTeachingPlanQuality(plan: TeachingPlan): TeachingQualityIssue[] {
  const issues: TeachingQualityIssue[] = [];
  const wordCounts = plan.chapters.map((chapter) => chapterNarration(chapter, plan.title).split(/\s+/).filter(Boolean).length);
  if (wordCounts.length >= 3) {
    const average = wordCounts.reduce((total, value) => total + value, 0) / wordCounts.length;
    if (Math.max(...wordCounts) - Math.min(...wordCounts) < Math.max(25, average * 0.16)) issues.push({ code: "uniform-chapter-length", message: "Chapter lengths are suspiciously uniform; check whether the subject warrants more variation.", path: "plan.chapters" });
  }
  const appliedKinds = new Set<TeachingBlockKind>(["example", "scenario", "procedure", "comparison", "pitfall"]);
  if (!plan.chapters.some((chapter) => chapter.blocks.some((block) => appliedKinds.has(block.kind)))) issues.push({ code: "missing-applied-block", message: "The lesson contains no explicit examples, scenarios, procedures, comparisons, or common pitfalls.", path: "plan.chapters.blocks" });
  if (plan.chapters.length >= 2 && plan.chapters.every((chapter) => chapter.blocks.length === 1 && chapter.blocks[0].kind === "explanation")) issues.push({ code: "single-block-pattern", message: "Every chapter uses a single explanation block; check whether the design inherited a uniform template.", path: "plan.chapters.blocks" });
  const thinChapters = wordCounts.filter((count) => count < 150).length;
  if (wordCounts.length >= 3 && thinChapters / wordCounts.length > 0.5) issues.push({ code: "thin-chapter-pattern", message: `${thinChapters} of ${wordCounts.length} chapters are below 150 narrated words; check that summarization did not replace necessary explanations, examples, or practice.`, path: "plan.chapters" });
  const sequences = plan.chapters.map((chapter) => chapter.blocks.map((block) => block.kind).join("→"));
  const sequenceFrequency = new Map<string, number>();
  for (const sequence of sequences) sequenceFrequency.set(sequence, (sequenceFrequency.get(sequence) || 0) + 1);
  const repeatedSequence = [...sequenceFrequency.entries()].sort((left, right) => right[1] - left[1])[0];
  if (sequences.length >= 3 && repeatedSequence && repeatedSequence[1] / sequences.length > 0.5) issues.push({ code: "repeated-block-sequence", message: `${repeatedSequence[1]} of ${sequences.length} chapters repeat the sequence ${repeatedSequence[0]}; justify that it fits the subject or redesign the progression.`, path: "plan.chapters.blocks" });
  return issues;
}

export const createLessonInputSchema = z.object({
  sourceName: z.string().trim().min(1).max(160),
  sourceText: z.string().trim().min(300, "The source needs at least 300 characters.").max(80_000, "The source exceeds 80,000 characters."),
  durationMinutes: lessonDurationSchema,
  level: lessonLevelSchema,
  objective: z.string().trim().min(10).max(500),
  provider: z.enum(["demo", "openai"]).default("demo"),
  contentLanguage: z.enum(["en-US", "en-GB", "es-ES"]).default("en-US"),
});

export type CreateLessonInput = z.input<typeof createLessonInputSchema>;

export const audioArtifactSchema = z.object({
  status: z.enum(["pending", "ready", "failed"]),
  kind: z.enum(["browser-speech", "file"]).nullable(),
  url: z.string().nullable(),
  mimeType: z.string().nullable(),
  provider: z.enum(["demo", "openai", "kokoro", "qwen", "chatterbox"]).nullable(),
  profileKey: z.string().min(1).nullable().default(null),
  speechProfile: z.object({ provider: z.enum(["demo", "openai", "kokoro", "qwen", "chatterbox"]), nodeId: z.string().nullable().default(null), voice: z.string().min(1), speed: z.number().positive(), language: z.enum(["es", "en-us", "en-gb"]), style: z.enum(["neutral", "serious", "warm"]), pronunciation: z.enum(["literal", "technical-es"]) }).nullable().optional(),
  chunkCount: z.number().int().positive().nullable().optional(),
  error: z.string().nullable(),
  generatedAt: z.string().datetime().nullable(),
  durationSeconds: z.number().positive().nullable().default(null),
  narrationVersion: z.number().int().positive().nullable().default(null),
});

export const studyProgressSchema = z.object({
  activeChapterId: z.string().nullable(),
  completedChapterIds: z.array(z.string()),
  answers: z.record(z.string(), z.number().int().nonnegative()),
  updatedAt: z.string().datetime(),
});

export const lessonOriginSchema = z.enum(["demo", "generated", "agent-imported"]);
export const lessonPlanProviderSchema = z.enum(["demo", "openai", "agent"]);

const lessonBaseFields = {
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  status: z.enum(["planning", "synthesizing", "ready", "failed"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("local-text"), name: z.string(), text: z.string(), characterCount: z.number().int().nonnegative() }),
    z.object({ kind: z.literal("course-sources"), courseId: z.string().uuid(), sourceIds: z.array(z.string().min(1)).min(1).max(24) }),
  ]),
  preferences: z.object({ durationMinutes: lessonDurationSchema, level: persistedLessonLevelSchema, objective: z.string(), contentLanguage: z.enum(["en-US", "en-GB", "es-ES"]).default("es-ES") }),
  audioByChapter: z.record(z.string(), audioArtifactSchema),
  progress: studyProgressSchema,
};

export const lessonSchema = z.object({
  schemaVersion: z.literal(4),
  origin: lessonOriginSchema,
  planProvider: lessonPlanProviderSchema,
  ...lessonBaseFields,
  plan: teachingPlanSchema,
});

const legacyLessonV3Schema = z.object({
  schemaVersion: z.literal(3),
  origin: lessonOriginSchema,
  planProvider: lessonPlanProviderSchema,
  ...lessonBaseFields,
  plan: legacyBlockTeachingPlanSchema,
});

const legacyLessonV2Schema = z.object({
  schemaVersion: z.literal(2),
  origin: lessonOriginSchema,
  planProvider: lessonPlanProviderSchema,
  ...lessonBaseFields,
  plan: legacyTeachingPlanSchema,
});

const legacyAudioArtifactSchema = audioArtifactSchema.extend({
  kind: z.enum(["browser-speech", "file"]),
  mimeType: z.string(),
  provider: z.enum(["demo", "openai"]),
});

export const legacyLessonSchema = z.object({
  schemaVersion: z.literal(1),
  provider: z.enum(["demo", "openai"]),
  ...lessonBaseFields,
  revision: z.never().optional(),
  source: z.object({ name: z.string(), text: z.string(), characterCount: z.number().int().nonnegative() }),
  plan: legacyTeachingPlanSchema,
  audioByChapter: z.record(z.string(), legacyAudioArtifactSchema),
});

export type Lesson = z.infer<typeof lessonSchema>;
export type AudioArtifact = z.infer<typeof audioArtifactSchema>;

export function migrateLesson(raw: unknown): Lesson {
  const current = lessonSchema.safeParse(raw);
  if (current.success) return current.data;
  const versionThree = legacyLessonV3Schema.safeParse(raw);
  if (versionThree.success) return lessonSchema.parse({ ...versionThree.data, schemaVersion: 4, plan: migrateTeachingPlan(versionThree.data.plan) });
  const versionTwo = legacyLessonV2Schema.safeParse(raw);
  if (versionTwo.success) return lessonSchema.parse({ ...versionTwo.data, schemaVersion: 4, plan: migrateTeachingPlan(versionTwo.data.plan) });
  const legacy = legacyLessonSchema.parse(raw);
  const { provider, ...fields } = legacy;
  return lessonSchema.parse({
    ...fields,
    schemaVersion: 4,
    revision: 1,
    origin: provider === "demo" ? "demo" : "generated",
    planProvider: provider,
    plan: migrateTeachingPlan(fields.plan),
    source: { kind: "local-text", ...fields.source },
  });
}

export function pendingAudioByChapter(plan: TeachingPlan): Record<string, AudioArtifact> {
  return Object.fromEntries(plan.chapters.map((chapter) => [chapter.id, {
    status: "pending",
    kind: null,
    url: null,
    mimeType: null,
    provider: null,
    profileKey: null,
    speechProfile: null,
    chunkCount: null,
    error: null,
    generatedAt: null,
    durationSeconds: null,
    narrationVersion: null,
  }]));
}

export function audioMatchesCurrentNarration(audio: AudioArtifact | undefined): boolean {
  return audio?.status === "ready" && audio.narrationVersion === NARRATION_PROJECTION_VERSION;
}

export function lessonAudioMinutes(lesson: Lesson): number | null {
  const durations = Object.values(lesson.audioByChapter).filter(audioMatchesCurrentNarration).map((audio) => audio.durationSeconds).filter((value): value is number => value !== null);
  return durations.length === lesson.plan.chapters.length
    ? Math.max(1, Math.round(durations.reduce((total, value) => total + value, 0) / 60))
    : null;
}
