from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import threading
import time
from typing import Any

from .config import EngineConfig


class WorkerProcess:
    def __init__(self, engine: EngineConfig):
        self.engine = engine
        self._process: subprocess.Popen[str] | None = None
        self._lock = threading.Lock()

    @property
    def state(self) -> str:
        if self._process is None:
            return "cold"
        return "ready" if self._process.poll() is None else "stopped"

    def _start(self) -> subprocess.Popen[str]:
        process = self._process
        if process is not None and process.poll() is None:
            return process
        worker_module = self.engine.worker.replace("-", "_")
        worker_path = Path(__file__).with_name("workers") / f"{worker_module}.py"
        if not worker_path.is_file():
            raise RuntimeError(f"Worker {self.engine.worker} does not exist.")
        environment = os.environ.copy()
        environment.update(self.engine.environment)
        package_root = str(Path(__file__).resolve().parents[1])
        environment["PYTHONPATH"] = os.pathsep.join(filter(None, (package_root, environment.get("PYTHONPATH"))))
        process = subprocess.Popen(
            [self.engine.python, "-u", "-m", "voice_node.workers.bootstrap", self.engine.worker],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=None,
            text=True,
            encoding="utf-8",
            bufsize=1,
            env=environment,
        )
        self._process = process
        return process

    def request(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            was_cold = self.state != "ready"
            started = time.perf_counter()
            process = self._start()
            if process.stdin is None or process.stdout is None:
                raise RuntimeError("The worker has no communication channel.")
            process.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
            process.stdin.flush()
            line = process.stdout.readline()
            if not line:
                code = process.poll()
                self._process = None
                raise RuntimeError(f"The worker exited without a response (code {code}).")
            response = json.loads(line)
            if response.get("id") != payload.get("id"):
                raise RuntimeError("The worker returned an out-of-order response.")
            if response.get("ok") is not True:
                raise RuntimeError(str(response.get("error") or "The worker rejected synthesis."))
            round_trip = round(time.perf_counter() - started, 3)
            metrics = response.get("metrics") if isinstance(response.get("metrics"), dict) else {}
            worker_seconds = metrics.get("workerSeconds")
            startup_overhead = round(max(0.0, round_trip - float(worker_seconds)), 3) if isinstance(worker_seconds, (int, float)) else None
            response["metrics"] = {
                **metrics,
                "workerWasCold": was_cold,
                "workerRoundTripSeconds": round_trip,
                "workerStartupOverheadSeconds": startup_overhead,
            }
            return response

    def close(self) -> None:
        process = self._process
        if process is None:
            return
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        if process.stdin is not None:
            process.stdin.close()
        if process.stdout is not None:
            process.stdout.close()
        self._process = None
