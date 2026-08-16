import { selectiveAudioService } from "@/server/container";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json() as { operationId?: string; expectedLessonRevision?: number; chapterIds?: string[]; confirmed?: boolean; provider?: "demo" | "openai" | "kokoro" | "qwen" | "chatterbox"; profile?: { nodeId?: string | null; voice?: string; speed?: number; language?: "es" | "en-us" | "en-gb"; style?: "neutral" | "serious" | "warm"; pronunciation?: "literal" | "technical-es" } };
    const provider = body.provider || "openai";
    const job = await selectiveAudioService.start({
      operationId: String(body.operationId || ""), lessonId: (await context.params).id,
      expectedLessonRevision: Number(body.expectedLessonRevision), chapterIds: body.chapterIds || [],
      confirmed: body.confirmed === true, provider, profile: body.profile,
    });
    return Response.json({ job }, { status: job.state === "completed" ? 200 : 202 });
  } catch (error) { return errorResponse(error); }
}
