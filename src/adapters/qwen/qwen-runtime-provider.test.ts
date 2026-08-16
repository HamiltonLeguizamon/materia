import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/runtime-models", () => ({
  OPENAI_MODELS: { voice: "coral", speechSpeed: 1 },
  KOKORO_MODELS: { voice: "ef_dora", speechSpeed: 1 },
  QWEN_MODELS: {
    baseUrl: "http://qwen.test:8880",
    speech: "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-6bit",
    voice: "qwen-es-profesor-c",
    speechSpeed: 1,
    timeoutMs: 10_000,
    instruction: "Test profile C",
    temperature: 0.7,
    topP: 0.95,
    topK: 50,
    repetitionPenalty: 1.05,
    maxTokens: 1400,
  },
  qwenConfigured: () => true,
}));

import { QwenSpeechRuntimeProvider } from "@/adapters/qwen/qwen-runtime-provider";
import { getMp3DurationSeconds } from "@/domain/audio";

function mpeg2Layer3Frames(count: number): Uint8Array {
  const frameLength = 384;
  const bytes = new Uint8Array(frameLength * count);
  for (let index = 0; index < count; index += 1) bytes.set([0xff, 0xf3, 0xc4, 0x00], index * frameLength);
  return bytes;
}

describe("Qwen speech provider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("splits the chapter and sends the exact profile C parameters", async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(mpeg2Layer3Frames(10).buffer as ArrayBuffer, { status: 200, headers: { "Content-Type": "audio/mpeg" } });
    }));

    const narration = `${"Primera explicación técnica completa y bien delimitada. ".repeat(12)} ${"Segunda decisión del agente con contexto suficiente. ".repeat(12)}`;
    const result = await new QwenSpeechRuntimeProvider().synthesize({ lessonTitle: "Prueba", chapterTitle: "Capítulo", narration });

    expect(result.kind).toBe("bytes");
    if (result.kind !== "bytes") throw new Error("Expected binary audio.");
    expect(requests.length).toBeGreaterThan(1);
    expect(result.chunkCount).toBe(requests.length);
    expect(requests.every((request) => request.model === "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-6bit" && request.instruct === "Test profile C" && request.lang_code === "Spanish" && request.response_format === "mp3" && request.speed === 1 && request.temperature === 0.7 && request.top_p === 0.95 && request.top_k === 50 && request.repetition_penalty === 1.05 && request.max_tokens === 1400)).toBe(true);
    expect(requests.slice(0, -1).every((request) => !String(request.input).includes("Con esto termina el capítulo."))).toBe(true);
    expect(String(requests.at(-1)?.input)).toContain("Con esto termina el capítulo.");
    expect(getMp3DurationSeconds(result.bytes)).toBeCloseTo(requests.length * 0.24, 3);
  });

  it("does not fall back to another provider when Qwen does not respond", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(new QwenSpeechRuntimeProvider().synthesize({ lessonTitle: "Test", chapterTitle: "Chapter", narration: "A sufficiently clear narration for the test." })).rejects.toThrow(/Could not connect to Qwen through the configured network.*fetch failed/);
  });
});
