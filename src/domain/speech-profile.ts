import type { SpeechProfile, SpeechProviderId } from "@/application/ports";
import { KOKORO_MODELS, OPENAI_MODELS, QWEN_MODELS } from "@/config/runtime-models";
import { KOKORO_SPEECH_VOICES, OPENAI_SPEECH_VOICES, QWEN_SPEECH_VOICES } from "@/domain/speech-options";

export function resolveSpeechProfile(provider: SpeechProviderId, input?: Partial<SpeechProfile>): SpeechProfile {
  const defaults: Record<SpeechProviderId, SpeechProfile> = {
    demo: { provider: "demo", nodeId: null, voice: "browser-default", speed: 1, language: "es", style: "neutral", pronunciation: "literal" },
    openai: { provider: "openai", nodeId: null, voice: OPENAI_MODELS.voice, speed: OPENAI_MODELS.speechSpeed, language: "es", style: "serious", pronunciation: "literal" },
    kokoro: { provider: "kokoro", nodeId: null, voice: KOKORO_MODELS.voice, speed: KOKORO_MODELS.speechSpeed, language: "es", style: "neutral", pronunciation: "literal" },
    qwen: { provider: "qwen", nodeId: null, voice: QWEN_MODELS.voice, speed: QWEN_MODELS.speechSpeed, language: "es", style: "serious", pronunciation: "literal" },
    chatterbox: { provider: "chatterbox", nodeId: null, voice: "default", speed: 0.9, language: "es", style: "neutral", pronunciation: "literal" },
  };
  const profile = { ...defaults[provider], ...input, provider };
  if (!Number.isFinite(profile.speed) || profile.speed < 0.5 || profile.speed > 2) throw new Error("Speech speed must be between 0.5 and 2.");
  if (!["es", "en-us", "en-gb"].includes(profile.language)) throw new Error("The speech language is not supported.");
  if (!["neutral", "serious", "warm"].includes(profile.style)) throw new Error("The speech style is not supported.");
  if (!["literal", "technical-es"].includes(profile.pronunciation)) throw new Error("The pronunciation profile is not supported.");
  if (profile.nodeId !== null && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(profile.nodeId)) throw new Error("The voice node is invalid.");
  if (profile.nodeId !== null && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile.voice)) throw new Error("The node voice is invalid.");
  if (provider === "openai" && profile.nodeId !== null) throw new Error("OpenAI does not run on a local node.");
  if (provider === "openai" && !(OPENAI_SPEECH_VOICES as readonly string[]).includes(profile.voice)) throw new Error("The OpenAI voice is not supported.");
  if (provider === "kokoro" && profile.nodeId === null && !(KOKORO_SPEECH_VOICES[profile.language] as readonly string[]).includes(profile.voice)) throw new Error("The Kokoro voice does not match the selected language.");
  if (provider === "qwen" && profile.nodeId === null && !(QWEN_SPEECH_VOICES as readonly string[]).includes(profile.voice)) throw new Error("The Qwen profile is not supported.");
  if (provider === "qwen" && profile.nodeId === null && (profile.language !== "es" || profile.speed !== 1 || profile.style !== "serious" || profile.pronunciation !== "literal")) throw new Error("Qwen currently uses fixed profile C: Spanish, speed 1, serious style, and literal pronunciation.");
  if (provider === "chatterbox" && profile.nodeId === null) throw new Error("Chatterbox requires a configured voice node.");
  if (["qwen", "chatterbox"].includes(provider) && profile.language !== "es") throw new Error("The selected local profile requires Spanish.");
  if (provider === "demo" && profile.voice !== "browser-default") throw new Error("Demo mode uses the browser's default voice.");
  return profile;
}

export function kokoroLanguageCode(language: SpeechProfile["language"]): "e" | "a" | "b" {
  return language === "en-us" ? "a" : language === "en-gb" ? "b" : "e";
}

export function prepareSpeechText(text: string, profile: SpeechProfile): string {
  if (profile.language !== "es" || profile.pronunciation !== "technical-es") return text;
  const replacements: Array<[RegExp, string | ((substring: string, ...args: string[]) => string)]> = [
    [/\bGitHub\b/gi, "Guít-jab"],
    [/\bpull requests?\b/gi, (match) => match.toLowerCase().endsWith("s") ? "pul ricuésts" : "pul ricuést"],
    [/\bissues?\b/gi, (match) => match.toLowerCase().endsWith("s") ? "íshus" : "íshu"],
    [/\bworkflows?\b/gi, (match) => match.toLowerCase().endsWith("s") ? "uórkflous" : "uórkflou"],
    [/\bCODEOWNERS\b/g, "coud-óuners"],
  ];
  let prepared = text;
  for (const [pattern, replacement] of replacements) {
    prepared = typeof replacement === "string" ? prepared.replace(pattern, replacement) : prepared.replace(pattern, replacement);
  }
  return prepared;
}
