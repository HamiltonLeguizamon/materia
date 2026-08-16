import { courseStudyService } from "@/server/container";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { return Response.json({ progress: await courseStudyService.getProgress((await context.params).id) }); }
  catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json() as { assessmentId?: string; questionId?: string; option?: number; expectedRevision?: number };
    return Response.json(await courseStudyService.answer({ courseId: (await context.params).id, assessmentId: String(body.assessmentId || ""), questionId: String(body.questionId || ""), option: Number(body.option), expectedRevision: Number(body.expectedRevision) }));
  } catch (error) { return errorResponse(error); }
}
