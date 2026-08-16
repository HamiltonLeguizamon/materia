from __future__ import annotations

from pathlib import Path
import math
import struct
from typing import Any
import wave

from .runtime import serve


def synthesize(request: dict[str, Any]) -> dict[str, Any]:
    sample_rate = 24_000
    duration = 0.25
    output = Path(request["output_path"])
    output.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output), "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(sample_rate)
        frames = bytearray()
        for index in range(int(sample_rate * duration)):
            value = int(0.08 * 32767 * math.sin(2 * math.pi * 440 * index / sample_rate))
            frames.extend(struct.pack("<h", value))
        stream.writeframes(frames)
    return {"durationSeconds": duration, "sampleRate": sample_rate, "chunkCount": 1, "fake": True}


if __name__ == "__main__":
    serve(synthesize)
