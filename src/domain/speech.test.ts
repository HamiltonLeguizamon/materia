import { describe, expect, it } from "vitest";

import { addSpeechTailGuard, ENGLISH_SPEECH_END_GUARD, SPEECH_CONTINUATION_GUARD, SPEECH_END_GUARD, splitNarrationForSpeech } from "@/domain/speech";

describe("speech narration chunks", () => {
  it("keeps short narration in a single call", () => {
    expect(splitNarrationForSpeech("Primera idea. Segunda idea.", 200)).toEqual(["Primera idea. Segunda idea."]);
  });

  it("splits at natural boundaries without losing content", () => {
    const sentence = "Esta es una explicación suficientemente amplia para comprobar que el fragmentador respeta los límites naturales y conserva íntegramente el contenido de una narración docente.";
    const narration = `${sentence} ${sentence} ${sentence}`;
    const chunks = splitNarrationForSpeech(narration, 200);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 200)).toBe(true);
    expect(chunks.join(" ")).toBe(narration);
  });

  it("protects final content with an instructional closing", () => {
    expect(addSpeechTailGuard("Contenido esencial.", true)).toBe(`Contenido esencial. ${SPEECH_END_GUARD}`);
    expect(addSpeechTailGuard("Contenido esencial.", false)).toBe(`Contenido esencial. ${SPEECH_CONTINUATION_GUARD}`);
    expect(addSpeechTailGuard("Essential content.", true, "en-us")).toBe(`Essential content. ${ENGLISH_SPEECH_END_GUARD}`);
  });
});
