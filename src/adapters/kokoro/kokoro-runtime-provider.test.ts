import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/runtime-models", () => ({
  OPENAI_MODELS: { voice: "coral", speechSpeed: 1 },
  KOKORO_MODELS: {
    baseUrl: "http://kokoro.test:8880",
    speech: "mlx-community/Kokoro-82M-bf16",
    voice: "ef_dora",
    language: "e",
    speechSpeed: 1,
    timeoutMs: 10_000,
  },
  QWEN_MODELS: { voice: "qwen-es-profesor-c", speechSpeed: 1 },
  kokoroConfigured: () => true,
}));

import { KokoroSpeechRuntimeProvider } from "@/adapters/kokoro/kokoro-runtime-provider";
import { getMp3DurationSeconds } from "@/domain/audio";

function mpeg2Layer3Frames(count: number): Uint8Array {
  const frameLength = 384;
  const bytes = new Uint8Array(frameLength * count);
  for (let index = 0; index < count; index += 1) bytes.set([0xff, 0xf3, 0xc4, 0x00], index * frameLength);
  return bytes;
}

describe("Kokoro speech provider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("splits long narration, requests Spanish MP3, and keeps a single final closing", async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(mpeg2Layer3Frames(10).buffer as ArrayBuffer, { status: 200, headers: { "Content-Type": "audio/mpeg" } });
    }));

    const narration = `${"Primera frase explicativa con suficiente detalle. ".repeat(12)} ${"Segunda idea técnica bien delimitada. ".repeat(12)}`;
    const result = await new KokoroSpeechRuntimeProvider().synthesize({ lessonTitle: "Prueba", chapterTitle: "Capítulo", narration });

    expect(result.kind).toBe("bytes");
    if (result.kind !== "bytes") throw new Error("Expected binary audio.");
    expect(requests.length).toBeGreaterThan(1);
    expect(result.chunkCount).toBe(requests.length);
    expect(requests.every((request) => request.response_format === "mp3" && request.lang_code === "e" && request.voice === "ef_dora")).toBe(true);
    expect(requests.slice(0, -1).every((request) => !String(request.input).includes("Con esto termina el capítulo."))).toBe(true);
    expect(String(requests.at(-1)?.input)).toContain("Con esto termina el capítulo.");
    expect(getMp3DurationSeconds(result.bytes)).toBeCloseTo(requests.length * 0.24, 3);
  });

  it("sends the selected voice, speed, and language and changes the cache profile", async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(mpeg2Layer3Frames(10).buffer as ArrayBuffer, { status: 200 });
    }));
    const santa = new KokoroSpeechRuntimeProvider({ voice: "em_santa", language: "es", speed: 0.9, pronunciation: "technical-es" });
    const dora = new KokoroSpeechRuntimeProvider({ voice: "ef_dora", language: "es", speed: 1 });
    await santa.synthesize({ lessonTitle: "Prueba", chapterTitle: "Capítulo", narration: "GitHub gestiona pull requests dentro del repositorio." });
    expect(requests[0]).toMatchObject({ voice: "em_santa", speed: 0.9, lang_code: "e" });
    expect(String(requests[0].input)).toContain("Guít-jab");
    expect(santa.profileKey).not.toBe(dora.profileKey);
  });

  it("returns a clear operational error when the service does not respond", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(new KokoroSpeechRuntimeProvider().synthesize({ lessonTitle: "Test", chapterTitle: "Chapter", narration: "A sufficiently clear narration for the test." })).rejects.toThrow(/Could not connect to Kokoro through the configured network.*fetch failed/);
  });
});
