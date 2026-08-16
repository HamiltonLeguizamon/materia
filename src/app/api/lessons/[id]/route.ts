import { errorResponse } from "@/server/http";
import { courseService, lessonRepository } from "@/server/container";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const lesson = await lessonRepository.get(id);
    if (!lesson) return Response.json({ error: "The lesson does not exist." }, { status: 404 });
    return Response.json({ lesson });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const deleted = await courseService.deleteStandaloneLesson(id);
    return deleted ? new Response(null, { status: 204 }) : Response.json({ error: "The lesson does not exist." }, { status: 404 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const lesson = await lessonRepository.get(id);
    if (!lesson) return Response.json({ error: "The lesson does not exist." }, { status: 404 });
    const body = await request.json() as { expectedRevision: number; activeChapterId?: string; completedChapterIds?: string[]; questionId?: string; answer?: number };
    const updated = await (await import("@/server/container")).lessonStudyService.updateProgress(id, body);
    return Response.json({ lesson: updated });
  } catch (error) { return errorResponse(error); }
}
