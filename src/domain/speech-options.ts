export const OPENAI_SPEECH_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer", "verse", "marin", "cedar"] as const;
export const KOKORO_SPEECH_VOICES = {
  es: ["ef_dora", "em_alex", "em_santa"],
  "en-us": ["af_heart", "af_bella", "af_nova", "am_adam", "am_echo"],
  "en-gb": ["bf_alice", "bf_emma", "bm_daniel", "bm_george"],
} as const;
export const QWEN_SPEECH_VOICES = ["qwen-es-profesor-c"] as const;

export const SPEECH_VOICE_LABELS: Record<string, string> = {
  ef_dora: "Dora · female", em_alex: "Alex · male", em_santa: "Santa · deep male",
  af_heart: "Heart · American", af_bella: "Bella · American", af_nova: "Nova · American", am_adam: "Adam · American", am_echo: "Echo · American",
  bf_alice: "Alice · British", bf_emma: "Emma · British", bm_daniel: "Daniel · British", bm_george: "George · British",
  alloy: "Alloy", ash: "Ash", ballad: "Ballad", coral: "Coral", echo: "Echo", fable: "Fable", onyx: "Onyx", nova: "Nova", sage: "Sage", shimmer: "Shimmer", verse: "Verse", marin: "Marin", cedar: "Cedar",
  "qwen-es-profesor-c": "Teacher C · deep male · Spain",
};
