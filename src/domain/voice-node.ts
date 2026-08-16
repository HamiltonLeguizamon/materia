import { z } from "zod";

export const voiceNodeEngineSchema = z.object({
  id: z.enum(["kokoro", "qwen", "chatterbox"]),
  label: z.string().min(1),
  quality: z.string().min(1),
  languages: z.array(z.enum(["es", "en-us", "en-gb"])).min(1),
  voices: z.array(z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/), label: z.string().min(1) })).min(1),
  responseFormats: z.array(z.enum(["mp3", "wav"])).min(1),
  state: z.enum(["cold", "ready", "stopped"]),
});

export const voiceNodeCapabilitiesSchema = z.object({
  schemaVersion: z.literal(1),
  node: z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/), label: z.string().min(1) }),
  engines: z.array(voiceNodeEngineSchema),
});

export type VoiceNodeEngine = z.infer<typeof voiceNodeEngineSchema>;
export type VoiceNodeCapabilities = z.infer<typeof voiceNodeCapabilitiesSchema>;
export type PublicVoiceNode = VoiceNodeCapabilities & { online: boolean; error: string | null };
