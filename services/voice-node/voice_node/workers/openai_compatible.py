from __future__ import annotations

import json
from pathlib import Path
import os
from typing import Any
from urllib.request import Request, urlopen

from .runtime import serve


def synthesize(request: dict[str, Any]) -> dict[str, Any]:
    base_url = os.environ.get("UPSTREAM_BASE_URL", "").rstrip("/")
    model = os.environ.get("UPSTREAM_MODEL", "")
    if not base_url or not model:
        raise RuntimeError("Faltan UPSTREAM_BASE_URL y UPSTREAM_MODEL.")
    language_codes = {"es": "e", "en-us": "a", "en-gb": "b"}
    body = json.dumps({
        "model": model,
        "input": request["input"],
        "voice": request["voice"],
        "response_format": "wav",
        "speed": request["speed"],
        "lang_code": language_codes.get(request["language"], request["language"]),
    }).encode("utf-8")
    upstream = Request(f"{base_url}/v1/audio/speech", data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(upstream, timeout=float(os.environ.get("UPSTREAM_TIMEOUT_SECONDS", "300"))) as response:
        audio = response.read()
    if len(audio) < 44 or audio[:4] != b"RIFF":
        raise RuntimeError("The MLX service did not return valid WAV audio.")
    output = Path(request["output_path"])
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(audio)
    return {"chunkCount": 1, "upstream": "openai-compatible"}


if __name__ == "__main__":
    serve(synthesize)
