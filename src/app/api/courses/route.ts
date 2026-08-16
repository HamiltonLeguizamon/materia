import { courseRepository } from "@/server/container";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";

export async function GET() {
  try { return Response.json({ courses: await courseRepository.list() }); }
  catch (error) { return errorResponse(error); }
}
