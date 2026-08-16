import { getProviderStatus } from "@/config/server";
import { discoverVoiceNodes } from "@/application/voice-node-service";

export const runtime = "nodejs";

export async function GET() {
  const provider = getProviderStatus();
  const voiceNodes = await discoverVoiceNodes();
  return Response.json({
    status: "ok",
    service: "materia",
    version: 2,
    capabilities: {
      textGeneration: {
        enabled: provider.openai.configured,
        provider: "openai",
        model: provider.openai.textModel,
        message: provider.openai.message,
      },
      voice: {
        mode: "explicit-selection",
        availableNodes: voiceNodes.filter((node) => node.online).map((node) => ({ id: node.node.id, label: node.node.label, engines: node.engines.map((engine) => engine.id) })),
        openaiAvailable: provider.openai.configured,
        legacyLocal: { kokoro: provider.kokoro.configured, qwen: provider.qwen.configured },
      },
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
