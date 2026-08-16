import { NETWORKING_TEACHING_PLAN } from "@/adapters/demo/demo-providers";
import { chapterContentText, chapterReferenceIds } from "@/domain/teaching";
import { NETWORKING_FIXTURE, NETWORKING_FIXTURE_NAME } from "@/fixtures/networking";

const timestamp = "2026-08-12T12:00:00.000Z";

export const LEGACY_LESSON_V1 = {
  schemaVersion: 1,
  id: "11111111-1111-4111-8111-111111111111",
  status: "ready",
  createdAt: timestamp,
  updatedAt: timestamp,
  source: { name: NETWORKING_FIXTURE_NAME, text: NETWORKING_FIXTURE, characterCount: NETWORKING_FIXTURE.length },
  preferences: {
    durationMinutes: 15,
    level: "intermedio",
    objective: "Comprender cómo viajan los paquetes y poder explicarlo.",
  },
  provider: "demo",
  plan: {
    ...NETWORKING_TEACHING_PLAN,
    chapters: NETWORKING_TEACHING_PLAN.chapters.map(({ blocks, ...chapter }) => ({
      ...chapter,
      narration: chapterContentText({ ...chapter, blocks }),
      referenceIds: chapterReferenceIds({ ...chapter, blocks }),
    })),
  },
  audioByChapter: Object.fromEntries(NETWORKING_TEACHING_PLAN.chapters.map((chapter) => [chapter.id, {
    status: "ready",
    kind: "browser-speech",
    url: null,
    mimeType: "application/x-browser-speech",
    provider: "demo",
    error: null,
    generatedAt: timestamp,
    durationSeconds: null,
  }])),
  progress: {
    activeChapterId: "chapter-1",
    completedChapterIds: [],
    answers: {},
    updatedAt: timestamp,
  },
} as const;
