import { safeDisplayName, validateSourceFile } from "@/domain/source";
import { createLessonInputSchema, lessonAudioMinutes } from "@/domain/teaching";
import { errorResponse } from "@/server/http";
import { lessonGeneration, lessonRepository } from "@/server/container";

export const runtime = "nodejs";

export async function GET() {
  try {
    const lessons = await lessonRepository.list();
    return Response.json({ lessons: lessons.map((lesson) => ({
      id: lesson.id, title: lesson.plan.title, summary: lesson.plan.summary, durationMinutes: lessonAudioMinutes(lesson) || lesson.preferences.durationMinutes,
      chapterCount: lesson.plan.chapters.length, status: lesson.status, origin: lesson.origin,
      completedCount: lesson.progress.completedChapterIds.length, updatedAt: lesson.updatedAt,
    })) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    let raw: Record<string, unknown>;
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      let sourceText = String(form.get("sourceText") || "");
      let sourceName = safeDisplayName(String(form.get("sourceName") || "notas.txt"));
      if (file instanceof File && file.size > 0) {
        validateSourceFile(file.name, file.size);
        sourceName = safeDisplayName(file.name);
        sourceText = await file.text();
      }
      raw = {
        sourceName, sourceText,
        durationMinutes: Number(form.get("durationMinutes")),
        level: form.get("level"), objective: form.get("objective"), provider: form.get("provider") || "demo", contentLanguage: form.get("contentLanguage") || "en-US",
      };
    } else {
      raw = await request.json() as Record<string, unknown>;
    }
    const input = createLessonInputSchema.parse(raw);
    const result = await lessonGeneration.create(input);
    return Response.json(result, { status: result.reused ? 200 : 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
