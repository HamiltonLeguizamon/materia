import { describe, expect, it } from "vitest";

import { getMp3DurationSeconds, joinMp3Chunks } from "@/domain/audio";

function mpeg2Layer3Frames(count: number): Uint8Array {
  const frameLength = 384;
  const bytes = new Uint8Array(frameLength * count);
  for (let index = 0; index < count; index += 1) {
    const offset = index * frameLength;
    bytes.set([0xff, 0xf3, 0xc4, 0x00], offset);
  }
  return bytes;
}

describe("MP3 metadata", () => {
  it("calculates duration by scanning every frame", () => {
    expect(getMp3DurationSeconds(mpeg2Layer3Frames(100))).toBeCloseTo(2.4, 3);
  });

  it("joins fragments while removing intermediate ID3 tags", () => {
    const first = mpeg2Layer3Frames(2);
    const id3 = Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
    const secondFrames = mpeg2Layer3Frames(3);
    const second = new Uint8Array(id3.length + secondFrames.length);
    second.set(id3);
    second.set(secondFrames, id3.length);
    const joined = joinMp3Chunks([first, second]);
    expect(joined.byteLength).toBe(first.byteLength + secondFrames.byteLength);
    expect(getMp3DurationSeconds(joined)).toBeCloseTo(0.12, 3);
  });
});
