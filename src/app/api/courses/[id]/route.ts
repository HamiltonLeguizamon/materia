import { courseService } from "@/server/container";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const course = await courseService.getCourse((await context.params).id);
    return course ? Response.json({ course }) : Response.json({ error: "The course does not exist." }, { status: 404 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const courseId = (await context.params).id;
    const body = await request.json() as { action?: string; operationId?: string; expectedRevision?: number; confirmed?: boolean };
    const input = { operationId: String(body.operationId || ""), courseId, expectedRevision: Number(body.expectedRevision) };
    if (body.action === "validate") return Response.json(await courseService.markValidated(input));
    if (body.action === "publish") return Response.json(await courseService.publish({ ...input, confirmed: body.confirmed === true }));
    return Response.json({ error: "Invalid editorial action." }, { status: 400 });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json() as { expectedRevision?: number; confirmed?: boolean };
    return Response.json(await courseService.deleteCourse({ courseId: (await context.params).id, expectedRevision: Number(body.expectedRevision), confirmed: body.confirmed === true }));
  } catch (error) { return errorResponse(error); }
}
