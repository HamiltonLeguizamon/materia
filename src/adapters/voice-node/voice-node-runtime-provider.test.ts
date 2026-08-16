import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VoiceNodeSpeechRuntimeProvider } from "@/adapters/voice-node/voice-node-runtime-provider";

function mpeg2Layer3Frames(count: number): Uint8Array {
  const frameLength = 384;
  const bytes = new Uint8Array(frameLength * count);
  for (let index = 0; index < count; index += 1) bytes.set([0xff, 0xf3, 0xc4, 0x00], index * frameLength);
  return bytes;
}

const originalEnvironment = {
  definitions: process.env.MATERIA_VOICE_NODES,
  token: process.env.TEST_VOICE_NODE_TOKEN,
  timeout: process.env.VOICE_NODE_TIMEOUT_MS,
  requestTimeout: process.env.VOICE_NODE_REQUEST_TIMEOUT_MS,
  pollInterval: process.env.VOICE_NODE_POLL_INTERVAL_MS,
};

describe("Voice-node speech provider", () => {
  beforeEach(() => {
    process.env.MATERIA_VOICE_NODES = JSON.stringify([{
      id: "gpu-node",
      label: "Local GPU",
      baseUrl: "http://voice-node.test:8880",
      tokenEnv: "TEST_VOICE_NODE_TOKEN",
    }]);
    process.env.TEST_VOICE_NODE_TOKEN = "private-test-token";
    process.env.VOICE_NODE_TIMEOUT_MS = "10000";
    process.env.VOICE_NODE_REQUEST_TIMEOUT_MS = "1000";
    process.env.VOICE_NODE_POLL_INTERVAL_MS = "1";
  });

  afterEach(() => {
    restoreEnvironment("MATERIA_VOICE_NODES", originalEnvironment.definitions);
    restoreEnvironment("TEST_VOICE_NODE_TOKEN", originalEnvironment.token);
    restoreEnvironment("VOICE_NODE_TIMEOUT_MS", originalEnvironment.timeout);
    restoreEnvironment("VOICE_NODE_REQUEST_TIMEOUT_MS", originalEnvironment.requestTimeout);
    restoreEnvironment("VOICE_NODE_POLL_INTERVAL_MS", originalEnvironment.pollInterval);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates an asynchronous job, waits for completion, and downloads the MP3", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let statusChecks = 0;
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/v1/audio/jobs") && init?.method === "POST") {
        return Response.json({ job: { id: "job-123", state: "queued", error: null } }, { status: 202 });
      }
      if (url.endsWith("/v1/audio/jobs/job-123/content")) {
        return new Response(mpeg2Layer3Frames(10).buffer as ArrayBuffer, {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "X-Materia-Chunk-Count": "2",
            "X-Materia-Queue-Seconds": "0.25",
            "X-Materia-Worker-Seconds": "320.5",
            "X-Materia-Total-Seconds": "321.1",
          },
        });
      }
      if (url.endsWith("/v1/audio/jobs/job-123")) {
        statusChecks += 1;
        return Response.json({ job: { id: "job-123", state: statusChecks === 1 ? "running" : "completed", error: null } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    const result = await provider().synthesize({ lessonTitle: "Curso", chapterTitle: "Capítulo", narration: "Una narración de prueba suficientemente clara." });

    expect(result).toMatchObject({ kind: "bytes", mimeType: "audio/mpeg", chunkCount: 2 });
    expect(result.durationSeconds).toBeCloseTo(0.24, 3);
    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      "/v1/audio/jobs",
      "/v1/audio/jobs/job-123",
      "/v1/audio/jobs/job-123",
      "/v1/audio/jobs/job-123/content",
    ]);
    expect(requests.some(({ url }) => url.endsWith("/v1/audio/speech"))).toBe(false);
    expect(requests.every(({ init }) => new Headers(init?.headers).get("Authorization") === "Bearer private-test-token")).toBe(true);
    const submitted = JSON.parse(String(requests[0]?.init?.body)) as Record<string, unknown>;
    expect(submitted).toMatchObject({ engine: "qwen", voice: "my-voice", language: "es", response_format: "mp3" });
    expect(submitted.input).toContain("Con esto termina el capítulo.");
  });

  it("propagates the final worker failure without downloading content", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/audio/jobs") && init?.method === "POST") {
        return Response.json({ job: { id: "job-failed", state: "queued", error: null } }, { status: 202 });
      }
      return Response.json({ job: { id: "job-failed", state: "failed", error: "CUDA sin memoria" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(provider().synthesize({ lessonTitle: "Curso", chapterTitle: "Capítulo", narration: "Contenido." }))
      .rejects.toThrow(/Local GPU could not synthesize the audio: CUDA sin memoria/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not repeat the POST when creation confirmation is ambiguous", async () => {
    const networkError = new TypeError("fetch failed", { cause: { code: "UND_ERR_HEADERS_TIMEOUT" } });
    const fetchMock = vi.fn(async () => { throw networkError; });
    vi.stubGlobal("fetch", fetchMock);

    await expect(provider().synthesize({ lessonTitle: "Curso", chapterTitle: "Capítulo", narration: "Contenido." }))
      .rejects.toThrow(/UND_ERR_HEADERS_TIMEOUT.*did not resubmit/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resumes polling and download with a persisted ID without repeating the POST", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/v1/audio/jobs/job-resume")) return Response.json({ job: { id: "job-resume", state: "completed", error: null } });
      if (url.endsWith("/v1/audio/jobs/job-resume/content")) return new Response(mpeg2Layer3Frames(10).buffer as ArrayBuffer, { status: 200 });
      throw new Error(`Unexpected request: ${url}`);
    }));

    await provider().synthesize(
      { lessonTitle: "Curso", chapterTitle: "Capítulo", narration: "Contenido." },
      { remoteJobId: "job-resume" },
    );

    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      "/v1/audio/jobs/job-resume",
      "/v1/audio/jobs/job-resume/content",
    ]);
    expect(requests.every(({ init }) => init?.method !== "POST")).toBe(true);
  });
});

function provider(): VoiceNodeSpeechRuntimeProvider {
  return new VoiceNodeSpeechRuntimeProvider({
    provider: "qwen",
    nodeId: "gpu-node",
    voice: "my-voice",
    language: "es",
    speed: 1,
    style: "serious",
    pronunciation: "literal",
  });
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
