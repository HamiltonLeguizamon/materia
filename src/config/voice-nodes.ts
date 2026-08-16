import { z } from "zod";

const definitionSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  label: z.string().min(1).max(80),
  baseUrl: z.string().url(),
  tokenEnv: z.string().min(1).optional(),
});

export type VoiceNodeDefinition = z.infer<typeof definitionSchema>;

let cachedSource: string | undefined;
let cachedDefinitions: VoiceNodeDefinition[] = [];

export function getVoiceNodeDefinitions(): VoiceNodeDefinition[] {
  const source = process.env.MATERIA_VOICE_NODES?.trim() || "[]";
  if (source === cachedSource) return cachedDefinitions;
  const parsed = z.array(definitionSchema).parse(JSON.parse(source)).map((definition) => {
    const url = new URL(definition.baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(`Voice-node URL ${definition.id} is invalid.`);
    return { ...definition, baseUrl: definition.baseUrl.replace(/\/$/, "") };
  });
  if (new Set(parsed.map((item) => item.id)).size !== parsed.length) throw new Error("MATERIA_VOICE_NODES contains duplicate identifiers.");
  cachedSource = source;
  cachedDefinitions = parsed;
  return parsed;
}

export function getVoiceNodeDefinition(id: string): VoiceNodeDefinition {
  const definition = getVoiceNodeDefinitions().find((item) => item.id === id);
  if (!definition) throw new Error(`Voice node ${id} is not configured.`);
  return definition;
}

export function voiceNodeHeaders(definition: VoiceNodeDefinition): HeadersInit {
  if (!definition.tokenEnv) return {};
  const token = process.env[definition.tokenEnv]?.trim();
  if (!token) throw new Error(`${definition.tokenEnv} is required to connect to ${definition.label}.`);
  return { Authorization: `Bearer ${token}` };
}
