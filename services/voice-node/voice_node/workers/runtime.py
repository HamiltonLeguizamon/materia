from __future__ import annotations

import contextlib
import json
import sys
import time
import traceback
from typing import Any, Callable


def serve(synthesize: Callable[[dict[str, Any]], dict[str, Any]]) -> None:
    for line in sys.stdin:
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            if request.get("operation") != "synthesize":
                raise ValueError("Unsupported operation.")
            started = time.perf_counter()
            with contextlib.redirect_stdout(sys.stderr):
                metrics = synthesize(request)
            metrics = {**metrics, "workerSeconds": round(time.perf_counter() - started, 3)}
            response = {"id": request_id, "ok": True, "metrics": metrics}
        except Exception as error:  # noqa: BLE001 - worker protocol boundary
            traceback.print_exc(file=sys.stderr)
            response = {"id": request_id, "ok": False, "error": str(error)}
        sys.__stdout__.write(json.dumps(response, ensure_ascii=False) + "\n")
        sys.__stdout__.flush()
