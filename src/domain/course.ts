import { z } from "zod";

import { persistedLessonLevelSchema } from "@/domain/lesson-level";
import { asContentLanguage, CONTENT_LANGUAGES } from "@/i18n/locale";

export const stableIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Use a stable ID with lowercase letters and hyphens.");
const canonicalUrlSchema = z.string().url().refine((value) => new URL(value).protocol === "https:", "The source must use HTTPS.");
const persistedContentLanguageSchema = z.enum([...CONTENT_LANGUAGES, "en", "es", "en-us", "en-gb", "es-es"]).transform(asContentLanguage);

export const courseSourceSchema = z.object({
  id: stableIdSchema,
  title: z.string().min(3).max(240),
  url: canonicalUrlSchema,
  publisher: z.string().min(2).max(120),
  retrievedAt: z.string().datetime(),
  excerpt: z.string().min(10).max(2000).nullable().default(null),
  locator: z.string().min(1).max(240).nullable().default(null),
});

export const learningObjectiveSchema = z.object({
  id: stableIdSchema,
  title: z.string().min(8).max(300),
  weightMinPercent: z.number().min(0).max(100).nullable().default(null),
  weightMaxPercent: z.number().min(0).max(100).nullable().default(null),
  sourceIds: z.array(stableIdSchema).min(1).max(12),
}).refine((value) => value.weightMinPercent === null || value.weightMaxPercent === null || value.weightMinPercent <= value.weightMaxPercent, {
  message: "The minimum weight cannot exceed the maximum.", path: ["weightMinPercent"],
});

export const courseModuleSchema = z.object({
  id: stableIdSchema,
  title: z.string().min(3).max(180),
  summary: z.string().min(20).max(800),
  position: z.number().int().positive(),
  lessonIds: z.array(z.string().uuid()).max(40),
});

export const assessmentQuestionSchema = z.object({
  id: stableIdSchema,
  type: z.enum(["single-choice", "scenario-single-choice"]),
  prompt: z.string().min(12).max(1200),
  options: z.array(z.string().min(1).max(500)).min(2).max(6),
  expectedOption: z.number().int().nonnegative(),
  explanation: z.string().min(20).max(1200),
  objectiveIds: z.array(stableIdSchema).min(1).max(8),
  sourceIds: z.array(stableIdSchema).min(1).max(8),
}).refine((value) => value.expectedOption < value.options.length, {
  message: "The expected answer must point to an existing option.", path: ["expectedOption"],
});

export const courseAssessmentSchema = z.object({
  id: stableIdSchema,
  moduleId: stableIdSchema,
  title: z.string().min(3).max(180),
  questions: z.array(assessmentQuestionSchema).min(1).max(80),
});

export const coverageEntrySchema = z.object({
  objectiveId: stableIdSchema,
  status: z.enum(["missing", "partial", "covered"]),
  lessonIds: z.array(z.string().uuid()).max(40),
  assessmentIds: z.array(stableIdSchema).max(20),
  note: z.string().min(3).max(600).nullable().default(null),
});

export const courseSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  status: z.enum(["draft", "validated", "published"]),
  title: z.string().min(3).max(180),
  summary: z.string().min(20).max(1000),
  certification: z.object({
    name: z.string().min(3).max(180),
    examCode: z.string().min(2).max(40).nullable().default(null),
    url: canonicalUrlSchema.nullable().default(null),
  }).nullable().default(null),
  level: persistedLessonLevelSchema,
  language: persistedContentLanguageSchema,
  sources: z.array(courseSourceSchema).max(200),
  objectives: z.array(learningObjectiveSchema).max(80),
  modules: z.array(courseModuleSchema).max(40),
  assessments: z.array(courseAssessmentSchema).max(80),
  coverage: z.array(coverageEntrySchema).max(80),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  validatedAt: z.string().datetime().nullable(),
  publishedAt: z.string().datetime().nullable(),
}).superRefine((course, context) => {
  checkUnique(course.sources.map((item) => item.id), "source", ["sources"], context);
  checkUnique(course.objectives.map((item) => item.id), "objective", ["objectives"], context);
  checkUnique(course.modules.map((item) => item.id), "module", ["modules"], context);
  checkUnique(course.modules.map((item) => String(item.position)), "module position", ["modules"], context);
  checkUnique(course.assessments.map((item) => item.id), "assessment", ["assessments"], context);
  checkUnique(course.coverage.map((item) => item.objectiveId), "coverage", ["coverage"], context);

  const sourceIds = new Set(course.sources.map((item) => item.id));
  const objectiveIds = new Set(course.objectives.map((item) => item.id));
  const moduleIds = new Set(course.modules.map((item) => item.id));
  const assessmentIds = new Set(course.assessments.map((item) => item.id));
  for (const objective of course.objectives) for (const sourceId of objective.sourceIds) if (!sourceIds.has(sourceId)) issue(context, `Unknown source: ${sourceId}`, ["objectives"]);
  for (const assessment of course.assessments) {
    if (!moduleIds.has(assessment.moduleId)) issue(context, `Unknown module: ${assessment.moduleId}`, ["assessments"]);
    checkUnique(assessment.questions.map((item) => item.id), "question", ["assessments"], context);
    for (const question of assessment.questions) {
      for (const objectiveId of question.objectiveIds) if (!objectiveIds.has(objectiveId)) issue(context, `Unknown objective: ${objectiveId}`, ["assessments"]);
      for (const sourceId of question.sourceIds) if (!sourceIds.has(sourceId)) issue(context, `Unknown source: ${sourceId}`, ["assessments"]);
    }
  }
  for (const coverage of course.coverage) {
    if (!objectiveIds.has(coverage.objectiveId)) issue(context, `Unknown objective: ${coverage.objectiveId}`, ["coverage"]);
    for (const assessmentId of coverage.assessmentIds) if (!assessmentIds.has(assessmentId)) issue(context, `Unknown assessment: ${assessmentId}`, ["coverage"]);
  }
});

function checkUnique(values: string[], label: string, path: PropertyKey[], context: z.RefinementCtx): void {
  if (new Set(values).size !== values.length) issue(context, `Duplicate ID or ${label}.`, path);
}

function issue(context: z.RefinementCtx, message: string, path: PropertyKey[]): void {
  context.addIssue({ code: "custom", message, path });
}

export type Course = z.infer<typeof courseSchema>;
export type CourseModule = z.infer<typeof courseModuleSchema>;
export type CourseAssessment = z.infer<typeof courseAssessmentSchema>;
export type CourseSource = z.infer<typeof courseSourceSchema>;
export type LearningObjective = z.infer<typeof learningObjectiveSchema>;
export type CoverageEntry = z.infer<typeof coverageEntrySchema>;

export type CourseValidationIssue = {
  code: "missing-sources" | "missing-objectives" | "missing-modules" | "empty-module" | "missing-objective-coverage" | "uncovered-objective" | "missing-assessment" | "missing-lesson" | "invalid-lesson-source" | "uniform-chapter-length" | "missing-applied-block" | "single-block-pattern" | "thin-chapter-pattern" | "repeated-block-sequence" | "uniform-course-shape" | "dominant-block-shape";
  severity: "error" | "warning";
  message: string;
  path: string;
};

export const courseQuestionAnswerSchema = z.object({
  assessmentId: stableIdSchema,
  option: z.number().int().nonnegative(),
  correct: z.boolean(),
  answeredAt: z.string().datetime(),
});

export const courseStudyProgressSchema = z.object({
  schemaVersion: z.literal(1),
  courseId: z.string().uuid(),
  revision: z.number().int().positive().default(1),
  answers: z.record(stableIdSchema, courseQuestionAnswerSchema),
  updatedAt: z.string().datetime(),
});

export type CourseStudyProgress = z.infer<typeof courseStudyProgressSchema>;
