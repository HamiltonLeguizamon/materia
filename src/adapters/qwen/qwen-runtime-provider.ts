import { createHash } from "node:crypto";

import type { SpeechProfile, SpeechProvider } from "@/application/ports";
import { QWEN_MODELS, qwenConfigured } from "@/config/runtime-models";
import { getMp3DurationSeconds, joinMp3Chunks } from "@/domain/audio";
import { addSpeechTailGuard, splitNarrationForSpeech } from "@/domain/speech";
import { resolveSpeechProfile } from "@/domain/speech-profile";

const QWEN_MAX_CHARS = 480;

export class QwenSpeechRuntimeProvider implements SpeechProvider {
  readonly profile: SpeechProfile;
  readonly profileKey: string;

  constructor(profile?: Partial<SpeechProfile>) {
    this.profile = resolveSpeechProfile("qwen", profile);
    this.profileKey = createHash("sha256").update(JSON.stringify({
      ...this.profile,
      model: QWEN_MODELS.speech,
      instruction: QWEN_MODELS.instruction,
      temperature: QWEN_MODELS.temperature,
      topP: QWEN_MODELS.topP,
      topK: QWEN_MODELS.topK,
      repetitionPenalty: QWEN_MODELS.repetitionPenalty,
      maxTokens: QWEN_MODELS.maxTokens,
      chunking: `sentence-${QWEN_MAX_CHARS}-v1`,
      ending: "chapter-close-v1",
    })).digest("hex");
  }

  async synthesize(input: { lessonTitle: string; chapterTitle: string; narration: string }) {
    validateConfiguration();
    const chunks = splitNarrationForSpeech(input.narration, QWEN_MAX_CHARS);
    const generated: Uint8Array[] = [];

    for (const [index, narration] of chunks.entries()) {
      const response = await fetch(`${QWEN_MODELS.baseUrl}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: QWEN_MODELS.speech,
          input: index === chunks.length - 1 ? addSpeechTailGuard(narration, true) : narration,
          instruct: QWEN_MODELS.instruction,
          lang_code: "Spanish",
          response_format: "mp3",
          speed: QWEN_MODELS.speechSpeed,
          temperature: QWEN_MODELS.temperature,
          top_p: QWEN_MODELS.topP,
          top_k: QWEN_MODELS.topK,
          repetition_penalty: QWEN_MODELS.repetitionPenalty,
          max_tokens: QWEN_MODELS.maxTokens,
        }),
        signal: AbortSignal.timeout(QWEN_MODELS.timeoutMs),
      }).catch((error: unknown) => {
        throw new Error(`Could not connect to Qwen through the configured network: ${error instanceof Error ? error.message : "network error"}.`);
      });

      if (!response.ok) {
        const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 300);
        throw new Error(`Qwen rejected segment ${index + 1} of ${chunks.length} (HTTP ${response.status})${detail ? `: ${detail}` : "."}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!getMp3DurationSeconds(bytes)) throw new Error(`Qwen returned invalid MP3 audio for segment ${index + 1}.`);
      generated.push(bytes);
    }

    const bytes = joinMp3Chunks(generated);
    return { kind: "bytes" as const, mimeType: "audio/mpeg" as const, bytes, durationSeconds: getMp3DurationSeconds(bytes), chunkCount: chunks.length };
  }
}

function validateConfiguration(): void {
  if (!qwenConfigured()) throw new Error("QWEN_BASE_URL or KOKORO_BASE_URL must contain a valid HTTP URL in the server process.");
  if (!Number.isInteger(QWEN_MODELS.timeoutMs) || QWEN_MODELS.timeoutMs < 1_000 || QWEN_MODELS.timeoutMs > 600_000) throw new Error("QWEN_TIMEOUT_MS must be between 1000 and 600000.");
}
