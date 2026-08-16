from __future__ import annotations

from pathlib import Path
import os
from typing import Any

import numpy as np
import soundfile as sf
import torch
from kokoro import KModel, KPipeline

from .runtime import serve


class KokoroWorker:
    def __init__(self) -> None:
        device = os.environ.get("VOICE_NODE_DEVICE", "cuda")
        repo_id = os.environ.get("KOKORO_MODEL", "hexgrad/Kokoro-82M")
        self.model = KModel(repo_id=repo_id).to(device).eval()
        self.pipelines: dict[str, KPipeline] = {}

    def pipeline(self, language: str) -> KPipeline:
        codes = {"es": "e", "en-us": "a", "en-gb": "b"}
        code = codes.get(language)
        if code is None:
            raise ValueError("Kokoro no admite el idioma solicitado.")
        if code not in self.pipelines:
            self.pipelines[code] = KPipeline(lang_code=code, model=self.model)
        return self.pipelines[code]

    def synthesize(self, request: dict[str, Any]) -> dict[str, Any]:
        pipeline = self.pipeline(request["language"])
        parts = [result.audio.numpy() for result in pipeline(request["input"], voice=request["voice"], speed=float(request["speed"])) if result.audio is not None]
        if not parts:
            raise RuntimeError("Kokoro no produjo audio.")
        audio = np.concatenate(parts)
        output = Path(request["output_path"])
        output.parent.mkdir(parents=True, exist_ok=True)
        sf.write(output, audio, 24_000, subtype="PCM_16")
        return {"durationSeconds": round(len(audio) / 24_000, 3), "sampleRate": 24_000, "chunkCount": len(parts), "device": str(self.model.device)}


if __name__ == "__main__":
    worker = KokoroWorker()
    serve(worker.synthesize)
