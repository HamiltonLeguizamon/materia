import { ZodError } from "zod";

export function errorResponse(error: unknown): Response {
  if (error instanceof ZodError) {
    return Response.json({ error: "The input is invalid.", issues: error.issues.map((issue) => issue.message) }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "An unexpected error occurred.";
  const status = /OpenAI generation is already running|revision conflict|still running|audio operation is already active|belongs to a course/i.test(message)
    ? 409
    : /does not exist|no longer exists|not found/i.test(message)
      ? 404
      : /invalid|only supports|limit|not configured|not supported|at least|requires (?:explicit )?confirmation|required before|must be|cannot be empty|does not match/i.test(message)
        ? 400
        : 500;
  return Response.json({ error: message }, { status });
}
