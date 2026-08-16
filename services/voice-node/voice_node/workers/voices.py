from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def load_private_voices(environment_name: str) -> dict[str, dict[str, Any]]:
    value = os.environ.get(environment_name, "").strip()
    if not value:
        raise RuntimeError(f"Falta {environment_name} con la ruta al registro privado de voces.")
    path = Path(os.path.expanduser(os.path.expandvars(value))).resolve()
    with path.open("r", encoding="utf-8") as stream:
        raw = json.load(stream)
    if not isinstance(raw, dict) or not raw:
        raise RuntimeError("The private voice registry is invalid.")
    voices: dict[str, dict[str, Any]] = {}
    for voice_id, voice in raw.items():
        if not isinstance(voice_id, str) or not isinstance(voice, dict):
            raise RuntimeError("The private voice registry is invalid.")
        audio = voice.get("referenceAudio")
        if not isinstance(audio, str) or not audio:
            raise RuntimeError(f"Voice {voice_id} does not declare referenceAudio.")
        voice = {**voice, "referenceAudio": str(Path(os.path.expanduser(os.path.expandvars(audio))).resolve())}
        voices[voice_id] = voice
    return voices
