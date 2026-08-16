from __future__ import annotations

from pathlib import Path
import os
from typing import Any

import librosa
import numpy as np
import soundfile as sf
import torch
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
from chatterbox.models.s3gen import S3Gen

from .runtime import serve
from .text import split_sentences
from .voices import load_private_voices


def load_model(model_dir: str, device: str) -> ChatterboxMultilingualTTS:
    original = S3Gen.load_state_dict

    def compatible(self: S3Gen, state_dict: Any, strict: bool = True, assign: bool = False):
        result = original(self, state_dict, strict=False, assign=assign)
        allowed = {"tokenizer._mel_filters", "tokenizer.window"}
        missing = set(result.missing_keys) - allowed
        if missing or result.unexpected_keys:
            raise RuntimeError(f"Checkpoint Chatterbox incompatible: missing={sorted(missing)} unexpected={sorted(result.unexpected_keys)}")
        return result

    S3Gen.load_state_dict = compatible
    try:
        return ChatterboxMultilingualTTS.from_local(
            ckpt_dir=model_dir,
            device=device,
            t3_model=os.environ.get("CHATTERBOX_T3_MODEL", "t3_es_es.safetensors"),
        )
    finally:
        S3Gen.load_state_dict = original


class ChatterboxWorker:
    def __init__(self) -> None:
        model_dir = os.environ.get("CHATTERBOX_MODEL_DIR", "").strip()
        if not model_dir:
            raise RuntimeError("Falta CHATTERBOX_MODEL_DIR.")
        self.device = os.environ.get("VOICE_NODE_DEVICE", "cuda")
        self.model = load_model(model_dir, self.device)
        self.voices = load_private_voices("CHATTERBOX_VOICES_FILE")
        self.conditionals: dict[tuple[str, float], Any] = {}

    def use_voice(self, voice_id: str, exaggeration: float) -> None:
        voice = self.voices.get(voice_id)
        if voice is None:
            raise ValueError("The requested Chatterbox voice does not exist.")
        key = (voice_id, exaggeration)
        if key not in self.conditionals:
            self.model.prepare_conditionals(voice["referenceAudio"], exaggeration=exaggeration)
            self.conditionals[key] = self.model.conds
        self.model.conds = self.conditionals[key]

    def synthesize(self, request: dict[str, Any]) -> dict[str, Any]:
        options = request.get("options", {})
        exaggeration = float(options.get("exaggeration", 0.5))
        self.use_voice(request["voice"], exaggeration)
        chunks = split_sentences(request["input"], int(options.get("maxChars", 520)))
        generated: list[np.ndarray] = []
        for chunk in chunks:
            wav = self.model.generate(
                text=chunk,
                language_id="es" if request["language"] == "es" else "en",
                exaggeration=exaggeration,
                cfg_weight=float(options.get("cfgWeight", 0.5)),
                temperature=float(options.get("temperature", 0.8)),
                repetition_penalty=float(options.get("repetitionPenalty", 1.2)),
                min_p=float(options.get("minP", 0.05)),
                top_p=float(options.get("topP", 1.0)),
            ).squeeze(0).cpu().numpy()
            speed = float(request.get("speed", 0.9))
            if speed != 1:
                wav = librosa.effects.time_stretch(y=wav, rate=speed)
            generated.append(wav)
        pause = np.zeros(int(self.model.sr * 0.2), dtype=np.float32)
        audio = np.concatenate([part for index, wav in enumerate(generated) for part in ((pause, wav) if index else (wav,))])
        output = Path(request["output_path"])
        output.parent.mkdir(parents=True, exist_ok=True)
        sf.write(output, audio, self.model.sr, subtype="PCM_16")
        return {"durationSeconds": round(len(audio) / self.model.sr, 3), "sampleRate": self.model.sr, "chunkCount": len(chunks), "device": self.device}


if __name__ == "__main__":
    worker = ChatterboxWorker()
    serve(worker.synthesize)
