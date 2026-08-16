import { describe, expect, it } from "vitest";

import { audioEstimateMessage } from "@/components/audio-estimate-message";

describe("audioEstimateMessage", () => {
  it("describes a local Qwen provider in the active interface language", () => {
    const providerName = "Local GPU · Qwen";

    expect(audioEstimateMessage({ provider: "qwen", providerName, locale: "en" })).toBe(
      "Local GPU · Qwen runs on your device: it does not use the OpenAI API; it only uses local resources and your configured private network.",
    );
    expect(audioEstimateMessage({ provider: "qwen", providerName, locale: "es" })).toBe(
      "Local GPU · Qwen se ejecuta en tu equipo: no consume la API de OpenAI; solo usa recursos locales y la red privada configurada.",
    );
  });

  it("localizes batch and OpenAI explanations", () => {
    expect(audioEstimateMessage({ provider: "kokoro", providerName: "Local node · Kokoro", locale: "en", batch: true })).toBe(
      "The queue uses Local node · Kokoro on your device without calling OpenAI and processes chapters in order.",
    );
    expect(audioEstimateMessage({ provider: "openai", providerName: "OpenAI TTS", locale: "es" })).toContain("tarifa verificada");
  });
});
