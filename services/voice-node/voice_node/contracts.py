from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
import time
from typing import Any

from .config import EngineConfig, NodeConfig


@dataclass
class SpeechRequest:
    engine: str
    input: str
    voice: str
    language: str = "es"
    speed: float = 1.0
    response_format: str = "mp3"
    options: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def parse(cls, raw: Any, config: NodeConfig) -> "SpeechRequest":
        if not isinstance(raw, dict):
            raise ValueError("The body must be a JSON object.")
        engine_id = raw.get("engine")
        engine = config.engines.get(engine_id) if isinstance(engine_id, str) else None
        if engine is None:
            raise ValueError("The requested engine is not available on this node.")
        text = raw.get("input")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("input cannot be empty.")
        text = " ".join(text.split())
        if len(text) > 12_000:
            raise ValueError("input supera los 12.000 caracteres.")
        voice = raw.get("voice")
        if voice not in {item.id for item in engine.voices}:
            raise ValueError("The requested voice does not belong to the selected engine.")
        language = raw.get("language", "es")
        if language not in engine.languages:
            raise ValueError("The requested language does not belong to the selected engine.")
        speed = raw.get("speed", 1.0)
        if not isinstance(speed, (int, float)) or isinstance(speed, bool) or not 0.5 <= float(speed) <= 2:
            raise ValueError("speed must be between 0.5 and 2.")
        response_format = raw.get("response_format", "mp3")
        if response_format not in {"mp3", "wav"}:
            raise ValueError("response_format must be mp3 or wav.")
        options = raw.get("options", {})
        if not isinstance(options, dict):
            raise ValueError("options must be an object.")
        return cls(engine=engine.id, input=text, voice=voice, language=language, speed=float(speed), response_format=response_format, options=options)


@dataclass
class AudioJob:
    id: str
    request: SpeechRequest
    state: str
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    output_path: Path | None = None
    mime_type: str | None = None
    error: str | None = None
    metrics: dict[str, Any] = field(default_factory=dict)

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "state": self.state,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "mime_type": self.mime_type,
            "error": self.error,
            "metrics": dict(self.metrics),
            "request": {
                "engine": self.request.engine,
                "voice": self.request.voice,
                "language": self.request.language,
                "speed": self.request.speed,
                "response_format": self.request.response_format,
            },
        }

    def discard_private_request_data(self) -> None:
        self.request.input = ""
        self.request.options = {}


def public_capabilities(config: NodeConfig, engine_states: dict[str, str]) -> dict[str, Any]:
    def engine_value(engine: EngineConfig) -> dict[str, Any]:
        return {
            "id": engine.id,
            "label": engine.label,
            "quality": engine.quality,
            "languages": list(engine.languages),
            "voices": [asdict(voice) for voice in engine.voices],
            "responseFormats": ["mp3", "wav"],
            "state": engine_states.get(engine.id, "cold"),
        }
    return {
        "schemaVersion": 1,
        "node": {"id": config.id, "label": config.label},
        "engines": [engine_value(engine) for engine in config.engines.values()],
    }
