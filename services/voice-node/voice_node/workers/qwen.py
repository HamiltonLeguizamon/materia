from __future__ import annotations

from pathlib import Path
import os
from typing import Any

import numpy as np
import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

from .runtime import serve
from .text import split_sentences
from .voices import load_private_voices


class QwenWorker:
    def __init__(self) -> None:
        model_name = os.environ.get("QWEN_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-Base")
        device = os.environ.get("VOICE_NODE_DEVICE", "cuda:0")
        self.model = Qwen3TTSModel.from_pretrained(
            model_name,
            device_map=device,
            dtype=torch.bfloat16,
            attn_implementation=os.environ.get("QWEN_ATTENTION", "sdpa"),
        )
        self.voices = load_private_voices("QWEN_VOICES_FILE")
        self.prompts: dict[str, Any] = {}

    def prompt(self, voice_id: str) -> Any:
        if voice_id not in self.voices:
            raise ValueError("The requested Qwen voice does not exist.")
        if voice_id not in self.prompts:
            voice = self.voices[voice_id]
            transcript = voice.get("referenceText")
            if not isinstance(transcript, str) or not transcript.strip():
                raise RuntimeError(f"Voice {voice_id} requires literal referenceText.")
            self.prompts[voice_id] = self.model.create_voice_clone_prompt(
                ref_audio=voice["referenceAudio"],
                ref_text=" ".join(transcript.split()),
                x_vector_only_mode=False,
            )
        return self.prompts[voice_id]

    def synthesize(self, request: dict[str, Any]) -> dict[str, Any]:
        options = request.get("options", {})
        chunks = split_sentences(request["input"], int(options.get("maxChars", 2400)))
        prompt = self.prompt(request["voice"])
        generated: list[np.ndarray] = []
        sample_rate = 24_000
        seed = int(options.get("seed", 20260813))
        for chunk in chunks:
            torch.manual_seed(seed)
            torch.cuda.manual_seed_all(seed)
            wavs, sample_rate = self.model.generate_voice_clone(
                text=chunk,
                language="Spanish" if request["language"] == "es" else "English",
                voice_clone_prompt=prompt,
                do_sample=True,
                temperature=float(options.get("temperature", 0.7)),
                top_p=float(options.get("topP", 0.95)),
                top_k=int(options.get("topK", 50)),
                repetition_penalty=float(options.get("repetitionPenalty", 1.05)),
                max_new_tokens=int(options.get("maxNewTokens", 2400)),
            )
            generated.append(wavs[0])
        pause = np.zeros(int(sample_rate * 0.22), dtype=np.float32)
        audio = np.concatenate([part for index, wav in enumerate(generated) for part in ((pause, wav) if index else (wav,))])
        output = Path(request["output_path"])
        output.parent.mkdir(parents=True, exist_ok=True)
        sf.write(output, audio, sample_rate, subtype="PCM_16")
        return {"durationSeconds": round(len(audio) / sample_rate, 3), "sampleRate": sample_rate, "chunkCount": len(chunks), "device": "cuda" if torch.cuda.is_available() else "cpu"}


if __name__ == "__main__":
    worker = QwenWorker()
    serve(worker.synthesize)
