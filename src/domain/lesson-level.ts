import { z } from "zod";

export const lessonLevelSchema = z.enum(["beginner", "intermediate", "advanced"]);

// Read-only compatibility for lesson and course records created before the
// public English contract. New API and MCP inputs only expose the schema above.
const legacyLessonLevelSchema = z.enum(["inicial", "intermedio", "avanzado"]);

export const persistedLessonLevelSchema = z.union([lessonLevelSchema, legacyLessonLevelSchema]).transform((level) => {
  if (level === "inicial") return "beginner" as const;
  if (level === "intermedio") return "intermediate" as const;
  if (level === "avanzado") return "advanced" as const;
  return level;
});

export type LessonLevel = z.infer<typeof lessonLevelSchema>;
