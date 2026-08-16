from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os
import re
import tomllib
from typing import Any


IDENTIFIER = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
VOICE_IDENTIFIER = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


@dataclass(frozen=True)
class VoiceConfig:
    id: str
    label: str


@dataclass(frozen=True)
class EngineConfig:
    id: str
    label: str
    quality: str
    python: str
    worker: str
    languages: tuple[str, ...]
    voices: tuple[VoiceConfig, ...]
    environment: dict[str, str]


@dataclass(frozen=True)
class NodeConfig:
    id: str
    label: str
    bind: str
    port: int
    work_dir: Path
    ffmpeg: str
    max_concurrent_jobs: int
    retention_ttl_seconds: int
    max_retained_jobs: int
    max_retained_bytes: int
    auth_token_env: str | None
    engines: dict[str, EngineConfig]

    @property
    def auth_token(self) -> str | None:
        if not self.auth_token_env:
            return None
        return os.environ.get(self.auth_token_env, "").strip() or None


def _identifier(value: Any, field: str) -> str:
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise ValueError(f"{field} must use lowercase letters, numbers, and hyphens.")
    return value


def _voice_identifier(value: Any, field: str) -> str:
    if not isinstance(value, str) or not VOICE_IDENTIFIER.fullmatch(value):
        raise ValueError(f"{field} must use lowercase letters, numbers, hyphens, or underscores.")
    return value


def _non_empty(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} cannot be empty.")
    return value.strip()


def _expanded(value: str) -> str:
    return os.path.expanduser(os.path.expandvars(value))


def load_config(path: str | Path) -> NodeConfig:
    config_path = Path(path).expanduser().resolve()
    with config_path.open("rb") as stream:
        raw = tomllib.load(stream)

    node = raw.get("node")
    if not isinstance(node, dict):
        raise ValueError("The [node] section is missing.")

    node_id = _identifier(node.get("id"), "node.id")
    label = _non_empty(node.get("label"), "node.label")
    bind = _non_empty(node.get("bind", "127.0.0.1"), "node.bind")
    port = node.get("port", 8880)
    if not isinstance(port, int) or not 1 <= port <= 65535:
        raise ValueError("node.port must be between 1 and 65535.")
    max_jobs = node.get("max_concurrent_jobs", 1)
    if not isinstance(max_jobs, int) or not 1 <= max_jobs <= 4:
        raise ValueError("node.max_concurrent_jobs must be between 1 and 4.")
    retention_ttl_seconds = node.get("retention_ttl_seconds", 21_600)
    if not isinstance(retention_ttl_seconds, int) or not 60 <= retention_ttl_seconds <= 604_800:
        raise ValueError("node.retention_ttl_seconds must be between 60 and 604800.")
    max_retained_jobs = node.get("max_retained_jobs", 100)
    if not isinstance(max_retained_jobs, int) or not 1 <= max_retained_jobs <= 10_000:
        raise ValueError("node.max_retained_jobs must be between 1 and 10000.")
    max_retained_bytes = node.get("max_retained_bytes", 2_147_483_648)
    if not isinstance(max_retained_bytes, int) or not 1_048_576 <= max_retained_bytes <= 1_099_511_627_776:
        raise ValueError("node.max_retained_bytes must be between 1048576 and 1099511627776.")

    work_dir_value = _expanded(_non_empty(node.get("work_dir", "~/.local/share/materia-voice-node"), "node.work_dir"))
    ffmpeg = _expanded(_non_empty(node.get("ffmpeg", "ffmpeg"), "node.ffmpeg"))
    auth_token_env = node.get("auth_token_env")
    if auth_token_env is not None:
        auth_token_env = _non_empty(auth_token_env, "node.auth_token_env")

    raw_engines = raw.get("engines")
    if not isinstance(raw_engines, dict) or not raw_engines:
        raise ValueError("Configure at least one engine under [engines.<id>].")

    engines: dict[str, EngineConfig] = {}
    for key, value in raw_engines.items():
        engine_id = _identifier(key, f"engines.{key}")
        if not isinstance(value, dict):
            raise ValueError(f"engines.{engine_id} must be a table.")
        languages = value.get("languages", ["es"])
        if not isinstance(languages, list) or not languages or not all(isinstance(item, str) and item for item in languages):
            raise ValueError(f"engines.{engine_id}.languages must be a non-empty list.")
        raw_voices = value.get("voices")
        if not isinstance(raw_voices, list) or not raw_voices:
            raise ValueError(f"engines.{engine_id}.voices must declare at least one voice.")
        voices: list[VoiceConfig] = []
        for raw_voice in raw_voices:
            if not isinstance(raw_voice, dict):
                raise ValueError(f"Voices for {engine_id} must be tables.")
            voices.append(VoiceConfig(
                id=_voice_identifier(raw_voice.get("id"), f"engines.{engine_id}.voices.id"),
                label=_non_empty(raw_voice.get("label"), f"engines.{engine_id}.voices.label"),
            ))
        environment = value.get("environment", {})
        if not isinstance(environment, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in environment.items()):
            raise ValueError(f"engines.{engine_id}.environment must contain strings.")
        engines[engine_id] = EngineConfig(
            id=engine_id,
            label=_non_empty(value.get("label"), f"engines.{engine_id}.label"),
            quality=_identifier(value.get("quality", "balanced"), f"engines.{engine_id}.quality"),
            python=_expanded(_non_empty(value.get("python"), f"engines.{engine_id}.python")),
            worker=_identifier(value.get("worker", engine_id), f"engines.{engine_id}.worker"),
            languages=tuple(languages),
            voices=tuple(voices),
            environment={key: _expanded(item) for key, item in environment.items()},
        )

    return NodeConfig(
        id=node_id,
        label=label,
        bind=bind,
        port=port,
        work_dir=Path(work_dir_value),
        ffmpeg=ffmpeg,
        max_concurrent_jobs=max_jobs,
        retention_ttl_seconds=retention_ttl_seconds,
        max_retained_jobs=max_retained_jobs,
        max_retained_bytes=max_retained_bytes,
        auth_token_env=auth_token_env,
        engines=engines,
    )
