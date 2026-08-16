import { operationalActivity } from "@/application/audio-generation-status";
import { audioActivityRegistry, lessonGeneration } from "@/server/container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const generation = lessonGeneration.getStatus();
  const audio = audioActivityRegistry.snapshot();
  return Response.json({ activity: operationalActivity(generation, audio), text: generation, audio }, {
    headers: { "Cache-Control": "no-store" },
  });
}
