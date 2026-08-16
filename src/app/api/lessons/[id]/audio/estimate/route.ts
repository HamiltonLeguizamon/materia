import { selectiveAudioService } from "@/server/container";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json() as { chapterIds?: string[]; provider?: "demo" | "openai" | "kokoro" | "qwen" | "chatterbox"; profile?: { nodeId?: string | null; voice?: string; speed?: number; language?: "es" | "en-us" | "en-gb"; style?: "neutral" | "serious" | "warm"; pronunciation?: "literal" | "technical-es" } };
    return Response.json({ estimate: await selectiveAudioService.estimate({ lessonId: (await context.params).id, chapterIds: body.chapterIds || [], provider: body.provider, profile: body.profile }) });
  } catch (error) { return errorResponse(error); }
}
