import { describe, expect, it } from "vitest";

import { prepareSpeechText, resolveSpeechProfile } from "@/domain/speech-profile";

describe("speech profiles", () => {
  it("validates Kokoro voices by language", () => {
    expect(resolveSpeechProfile("kokoro", { voice: "em_santa", language: "es" }).voice).toBe("em_santa");
    expect(() => resolveSpeechProfile("kokoro", { voice: "em_santa", language: "en-gb" })).toThrow(/selected language/);
  });

  it("includes voice and tuning in valid OpenAI profiles", () => {
    expect(resolveSpeechProfile("openai", { voice: "onyx", style: "warm", speed: 0.9 })).toMatchObject({ voice: "onyx", style: "warm", speed: 0.9 });
    expect(() => resolveSpeechProfile("openai", { voice: "inventada" })).toThrow(/OpenAI/);
  });

  it("pins Qwen to the validated profile C", () => {
    expect(resolveSpeechProfile("qwen")).toMatchObject({ voice: "qwen-es-profesor-c", language: "es", speed: 1, style: "serious", pronunciation: "literal" });
    expect(() => resolveSpeechProfile("qwen", { speed: 1.1 })).toThrow(/fixed profile C/);
    expect(() => resolveSpeechProfile("qwen", { language: "en-us" })).toThrow(/fixed profile C/);
  });

  it("accepts voices announced by a node without relaxing cloud providers", () => {
    expect(resolveSpeechProfile("kokoro", { nodeId: "gpu-node", voice: "em_santa" })).toMatchObject({ nodeId: "gpu-node", voice: "em_santa" });
    expect(resolveSpeechProfile("chatterbox", { nodeId: "gpu-node", voice: "my-voice", speed: 0.9 })).toMatchObject({ provider: "chatterbox", nodeId: "gpu-node", speed: 0.9 });
    expect(() => resolveSpeechProfile("chatterbox")).toThrow(/voice node/);
    expect(() => resolveSpeechProfile("openai", { nodeId: "gpu-node" })).toThrow(/OpenAI/);
  });

  it("adapts technical terms only when Spanish pronunciation is requested", () => {
    const profile = resolveSpeechProfile("kokoro", { voice: "em_santa", language: "es", pronunciation: "technical-es" });
    expect(prepareSpeechText("GitHub abre pull requests desde workflows.", profile)).toBe("Guít-jab abre pul ricuésts desde uórkflous.");
    expect(prepareSpeechText("GitHub opens pull requests.", { ...profile, language: "en-us" })).toBe("GitHub opens pull requests.");
  });
});
