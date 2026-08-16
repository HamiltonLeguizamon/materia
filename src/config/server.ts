import "server-only";

import { KOKORO_MODELS, OPENAI_MODELS, QWEN_MODELS, kokoroConfigured, openAiConfigured, qwenConfigured } from "@/config/runtime-models";

export { OPENAI_MODELS } from "@/config/runtime-models";

export function getProviderStatus() {
  const configured = openAiConfigured();
  const kokoroReady = kokoroConfigured();
  const qwenReady = qwenConfigured();
  return {
    defaultProvider: process.env.MATERIA_PROVIDER === "openai" && configured ? "openai" as const : "demo" as const,
    openai: {
      configured,
      textModel: OPENAI_MODELS.teaching,
      speechModel: OPENAI_MODELS.speech,
      message: configured
        ? "OpenAI is configured in the server process."
        : "OPENAI_API_KEY is not configured. Demo mode remains available.",
    },
    kokoro: {
      configured: kokoroReady,
      speechModel: KOKORO_MODELS.speech,
      voice: KOKORO_MODELS.voice,
      language: KOKORO_MODELS.language,
      message: kokoroReady
        ? "Kokoro is configured as a local speech service."
        : "KOKORO_BASE_URL is not configured. OpenAI and demo mode remain available.",
    },
    qwen: {
      configured: qwenReady,
      speechModel: QWEN_MODELS.speech,
      voice: QWEN_MODELS.voice,
      message: qwenReady
        ? "Qwen is configured as a local speech service with the validated profile C."
        : "Neither QWEN_BASE_URL nor KOKORO_BASE_URL is configured. Local Qwen is unavailable.",
    },
  };
}
