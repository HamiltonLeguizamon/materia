import { createHash } from "node:crypto";

import type { SpeechProfile, SpeechProvider } from "@/application/ports";
import { KOKORO_MODELS, kokoroConfigured } from "@/config/runtime-models";
import { getMp3DurationSeconds, joinMp3Chunks } from "@/domain/audio";
import { addSpeechTailGuard, splitNarrationForSpeech } from "@/domain/speech";
import { kokoroLanguageCode, prepareSpeechText, resolveSpeechProfile } from "@/domain/speech-profile";

const KOKORO_MAX_CHARS = 420;

export class KokoroSpeechRuntimeProvider implements SpeechProvider {
  readonly profile: SpeechProfile;
  readonly profileKey: string;

  constructor(profile?: Partial<SpeechProfile>) {
    this.profile = resolveSpeechProfile("kokoro", profile);
    this.profileKey = createHash("sha256").update(JSON.stringify({
      ...this.profile,
      model: KOKORO_MODELS.speech,
      chunking: `sentence-${KOKORO_MAX_CHARS}-v1`,
      ending: "chapter-close-v1",
    })).digest("hex");
  }

  async synthesize(input: { lessonTitle: string; chapterTitle: string; narration: string }) {
    validateConfiguration();
    const chunks = splitNarrationForSpeech(prepareSpeechText(input.narration, this.profile), KOKORO_MAX_CHARS);
    const generated: Uint8Array[] = [];

    for (const [index, narration] of chunks.entries()) {
      const isLast = index === chunks.length - 1;
      const response = await fetch(`${KOKORO_MODELS.baseUrl}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: KOKORO_MODELS.speech,
          input: isLast ? addSpeechTailGuard(narration, true, this.profile.language) : narration,
          voice: this.profile.voice,
          response_format: "mp3",
          speed: this.profile.speed,
          lang_code: kokoroLanguageCode(this.profile.language),
        }),
        signal: AbortSignal.timeout(KOKORO_MODELS.timeoutMs),
      }).catch((error: unknown) => {
        throw new Error(`Could not connect to Kokoro through the configured network: ${error instanceof Error ? error.message : "network error"}.`);
      });

      if (!response.ok) {
        const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 300);
        throw new Error(`Kokoro rejected segment ${index + 1} of ${chunks.length} (HTTP ${response.status})${detail ? `: ${detail}` : "."}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!getMp3DurationSeconds(bytes)) throw new Error(`Kokoro returned invalid MP3 audio for segment ${index + 1}.`);
      generated.push(bytes);
    }

    const bytes = joinMp3Chunks(generated);
    return { kind: "bytes" as const, mimeType: "audio/mpeg" as const, bytes, durationSeconds: getMp3DurationSeconds(bytes), chunkCount: chunks.length };
  }
}

function validateConfiguration(): void {
  if (!kokoroConfigured()) throw new Error("KOKORO_BASE_URL is not configured with a valid HTTP URL in the server process.");
  if (!Number.isFinite(KOKORO_MODELS.speechSpeed) || KOKORO_MODELS.speechSpeed < 0.5 || KOKORO_MODELS.speechSpeed > 2) throw new Error("KOKORO_SPEECH_SPEED must be between 0.5 and 2.");
  if (!Number.isInteger(KOKORO_MODELS.timeoutMs) || KOKORO_MODELS.timeoutMs < 1_000 || KOKORO_MODELS.timeoutMs > 600_000) throw new Error("KOKORO_TIMEOUT_MS must be between 1000 and 600000.");
}
