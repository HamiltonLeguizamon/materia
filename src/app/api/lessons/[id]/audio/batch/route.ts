import { audioBatchService } from "@/server/container";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const lessonId = (await context.params).id;
    const body = await request.json() as { action?: "estimate" | "start"; confirmed?: boolean; provider?: "demo" | "openai" | "kokoro" | "qwen" | "chatterbox"; profile?: { nodeId?: string | null; voice?: string; speed?: number; language?: "es" | "en-us" | "en-gb"; style?: "neutral" | "serious" | "warm"; pronunciation?: "literal" | "technical-es" } };
    const input = { provider: body.provider || "openai", profile: body.profile };
    if (body.action === "estimate") return Response.json({ estimate: await audioBatchService.estimateLesson(lessonId, input) });
    if (body.action === "start") return Response.json({ job: await audioBatchService.startLesson({ ...input, lessonId, confirmed: body.confirmed === true }) }, { status: 202 });
    return Response.json({ error: "Invalid audio action." }, { status: 400 });
  } catch (error) { return errorResponse(error); }
}
