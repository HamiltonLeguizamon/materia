import { DemoSpeechProvider } from "@/adapters/demo/demo-providers";
import { KokoroSpeechRuntimeProvider } from "@/adapters/kokoro/kokoro-runtime-provider";
import { OpenAISpeechRuntimeProvider } from "@/adapters/openai/openai-runtime-providers";
import { QwenSpeechRuntimeProvider } from "@/adapters/qwen/qwen-runtime-provider";
import { VoiceNodeSpeechRuntimeProvider } from "@/adapters/voice-node/voice-node-runtime-provider";
import { discoverVoiceNodes } from "@/application/voice-node-service";
import type { SpeechProfile, SpeechProvider, SpeechProviderId } from "@/application/ports";
import { kokoroConfigured, openAiConfigured, qwenConfigured } from "@/config/runtime-models";

export function createSpeechProvider(provider: SpeechProviderId, profile?: Partial<SpeechProfile>): SpeechProvider {
  if (profile?.nodeId) return new VoiceNodeSpeechRuntimeProvider({ ...profile, provider });
  if (provider === "openai") return new OpenAISpeechRuntimeProvider(profile);
  if (provider === "kokoro") return new KokoroSpeechRuntimeProvider(profile);
  if (provider === "qwen") return new QwenSpeechRuntimeProvider(profile);
  if (provider === "chatterbox") return new VoiceNodeSpeechRuntimeProvider({ ...profile, provider });
  return new DemoSpeechProvider();
}

export async function assertSpeechProviderAvailable(provider: SpeechProviderId, profile?: Partial<SpeechProfile>): Promise<void> {
  if (provider === "demo") return;
  if (profile?.nodeId) {
    const node = (await discoverVoiceNodes()).find((item) => item.node.id === profile.nodeId);
    if (!node?.online) throw new Error(`Voice node ${profile.nodeId} is unavailable.`);
    if (!node.engines.some((engine) => engine.id === provider)) throw new Error(`Voice node ${profile.nodeId} does not provide ${provider}.`);
    return;
  }
  if (provider === "openai" && !openAiConfigured()) throw new Error("OpenAI is not configured in the server process.");
  if (provider === "kokoro" && !kokoroConfigured()) throw new Error("Kokoro is not configured in the server process.");
  if (provider === "qwen" && !qwenConfigured()) throw new Error("Qwen is not configured in the server process.");
  if (provider === "chatterbox") throw new Error("Chatterbox requires an available voice node.");
}
