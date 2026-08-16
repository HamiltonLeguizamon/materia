const DEFAULT_MAX_CHARS = 1_800;
export const SPEECH_CONTINUATION_GUARD = "Hacemos una breve pausa y continuamos.";
export const SPEECH_END_GUARD = "Con esto termina el capítulo.";
export const ENGLISH_SPEECH_CONTINUATION_GUARD = "We pause briefly and continue.";
export const ENGLISH_SPEECH_END_GUARD = "This concludes the chapter.";

function splitOversizedSegment(segment: string, maxChars: number): string[] {
  const words = segment.trim().split(/\s+/);
  const chunks: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    if (word.length <= maxChars) current = word;
    else {
      for (let index = 0; index < word.length; index += maxChars) chunks.push(word.slice(index, index + maxChars));
      current = "";
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function splitNarrationForSpeech(narration: string, maxChars = DEFAULT_MAX_CHARS): string[] {
  if (!Number.isInteger(maxChars) || maxChars < 200) throw new Error("The speech chunk limit is invalid.");
  const sentences = narration.trim().split(/(?<=[.!?;:])\s+|\n+/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences.flatMap((item) => splitOversizedSegment(item, maxChars))) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxChars) current = candidate;
    else {
      if (current) chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function addSpeechTailGuard(narration: string, isLastChunk: boolean, language = "es"): string {
  const guard = language === "es"
    ? isLastChunk ? SPEECH_END_GUARD : SPEECH_CONTINUATION_GUARD
    : isLastChunk ? ENGLISH_SPEECH_END_GUARD : ENGLISH_SPEECH_CONTINUATION_GUARD;
  return `${narration.trim()} ${guard}`;
}
