import { getVoiceNodeDefinitions, voiceNodeHeaders } from "@/config/voice-nodes";
import { voiceNodeCapabilitiesSchema, type PublicVoiceNode } from "@/domain/voice-node";

export async function discoverVoiceNodes(): Promise<PublicVoiceNode[]> {
  return Promise.all(getVoiceNodeDefinitions().map(async (definition) => {
    try {
      const response = await fetch(`${definition.baseUrl}/v1/capabilities`, {
        headers: voiceNodeHeaders(definition),
        cache: "no-store",
        signal: AbortSignal.timeout(2_500),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const capabilities = voiceNodeCapabilitiesSchema.parse(await response.json());
      if (capabilities.node.id !== definition.id) throw new Error("The announced node ID does not match the configuration.");
      return { ...capabilities, node: { ...capabilities.node, label: definition.label }, online: true, error: null };
    } catch (error) {
      return {
        schemaVersion: 1 as const,
        node: { id: definition.id, label: definition.label },
        engines: [],
        online: false,
        error: error instanceof Error ? error.message : "Unavailable",
      };
    }
  }));
}
