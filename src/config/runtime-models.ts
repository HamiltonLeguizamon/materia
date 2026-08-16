export const OPENAI_MODELS = {
  teaching: process.env.OPENAI_TEXT_MODEL || "gpt-5.6-luna",
  speech: process.env.OPENAI_SPEECH_MODEL || "gpt-4o-mini-tts-2025-12-15",
  voice: process.env.OPENAI_SPEECH_VOICE || "coral",
  speechSpeed: Number(process.env.OPENAI_SPEECH_SPEED || "1"),
  speechInstructions: process.env.OPENAI_SPEECH_INSTRUCTIONS || "Read the complete text literally, including the final sentence. Do not omit, summarize, or rephrase words. Preserve the requested language and pronunciation. Use a clear, measured, engaging instructor tone with consistent pace, volume, and energy. Avoid sudden emphasis, dramatization, and advertising delivery. Use brief, consistent pauses between ideas and pronounce technical terms clearly.",
} as const;

export const KOKORO_MODELS = {
  baseUrl: process.env.KOKORO_BASE_URL?.trim().replace(/\/$/, "") || "",
  speech: process.env.KOKORO_SPEECH_MODEL || "mlx-community/Kokoro-82M-bf16",
  voice: process.env.KOKORO_SPEECH_VOICE || "ef_dora",
  language: process.env.KOKORO_LANGUAGE || "e",
  speechSpeed: Number(process.env.KOKORO_SPEECH_SPEED || "1"),
  timeoutMs: Number(process.env.KOKORO_TIMEOUT_MS || "120000"),
} as const;

export const QWEN_MODELS = {
  baseUrl: process.env.QWEN_BASE_URL?.trim().replace(/\/$/, "") || process.env.KOKORO_BASE_URL?.trim().replace(/\/$/, "") || "",
  speech: process.env.QWEN_SPEECH_MODEL || "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-6bit",
  voice: "qwen-es-profesor-c",
  speechSpeed: 1,
  timeoutMs: Number(process.env.QWEN_TIMEOUT_MS || "180000"),
  instruction: "Speak exclusively as a native adult male from Spain. Use an unmistakable Peninsular Spanish accent, a low and stable voice, and a serious, measured, engaging technical-instructor tone. Never sound sensual, theatrical, or promotional. Keep a medium, deliberate pace, consistent energy, precise diction, and restrained intonation. Preserve exactly the same vocal identity throughout the narration. Pronounce English technical terms naturally while retaining Peninsular Spanish for the surrounding speech.",
  temperature: 0.7,
  topP: 0.95,
  topK: 50,
  repetitionPenalty: 1.05,
  maxTokens: 1400,
} as const;

export function openAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function kokoroConfigured(): boolean {
  if (!KOKORO_MODELS.baseUrl) return false;
  try {
    const url = new URL(KOKORO_MODELS.baseUrl);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function qwenConfigured(): boolean {
  if (!QWEN_MODELS.baseUrl) return false;
  try {
    const url = new URL(QWEN_MODELS.baseUrl);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}
