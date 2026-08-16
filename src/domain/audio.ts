const BITRATES = {
  mpeg1Layer3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  mpeg2Layer3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
} as const;
const SAMPLE_RATES = [44_100, 48_000, 32_000] as const;

type Mp3Frame = { byteLength: number; durationSeconds: number };

function id3ByteLength(bytes: Uint8Array): number {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  return 10 + size + ((bytes[5] & 0x10) !== 0 ? 10 : 0);
}

function parseFrame(bytes: Uint8Array, offset: number): Mp3Frame | null {
  if (offset + 4 > bytes.length || bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) return null;
  const versionBits = (bytes[offset + 1] >> 3) & 0x03;
  const layerBits = (bytes[offset + 1] >> 1) & 0x03;
  const bitrateIndex = (bytes[offset + 2] >> 4) & 0x0f;
  const sampleRateIndex = (bytes[offset + 2] >> 2) & 0x03;
  if (versionBits === 1 || layerBits !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null;

  const isMpeg1 = versionBits === 3;
  const divisor = isMpeg1 ? 1 : versionBits === 2 ? 2 : 4;
  const sampleRate = SAMPLE_RATES[sampleRateIndex] / divisor;
  const bitrate = (isMpeg1 ? BITRATES.mpeg1Layer3 : BITRATES.mpeg2Layer3)[bitrateIndex] * 1000;
  const padding = (bytes[offset + 2] >> 1) & 0x01;
  const byteLength = Math.floor((isMpeg1 ? 144 : 72) * bitrate / sampleRate) + padding;
  if (byteLength <= 4 || offset + byteLength > bytes.length) return null;
  return { byteLength, durationSeconds: (isMpeg1 ? 1152 : 576) / sampleRate };
}

export function getMp3DurationSeconds(bytes: Uint8Array): number | null {
  let offset = id3ByteLength(bytes);
  let duration = 0;
  let frames = 0;
  while (offset + 4 <= bytes.length) {
    const frame = parseFrame(bytes, offset);
    if (!frame) {
      if (frames > 0) break;
      offset += 1;
      continue;
    }
    duration += frame.durationSeconds;
    frames += 1;
    offset += frame.byteLength;
  }
  return frames > 0 ? duration : null;
}

export function joinMp3Chunks(chunks: Uint8Array[]): Uint8Array {
  const normalized = chunks.map((chunk, index) => index === 0 ? chunk : chunk.subarray(id3ByteLength(chunk)));
  const result = new Uint8Array(normalized.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of normalized) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
