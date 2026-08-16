from __future__ import annotations

from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .config import NodeConfig
from .contracts import SpeechRequest, public_capabilities
from .job_manager import JobManager


MAX_BODY_BYTES = 64 * 1024


class VoiceNodeServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, config: NodeConfig):
        self.config = config
        self.jobs = JobManager(config)
        super().__init__((config.bind, config.port), VoiceNodeHandler)

    def server_close(self) -> None:
        self.jobs.close()
        super().server_close()


class VoiceNodeHandler(BaseHTTPRequestHandler):
    server: VoiceNodeServer

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[voice-node] {self.address_string()} {format % args}")

    def _authorized(self) -> bool:
        token = self.server.config.auth_token
        if token is None:
            return True
        return self.headers.get("Authorization") == f"Bearer {token}"

    def _json(self, status: int, payload: Any) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def _body(self) -> Any:
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            raise ValueError("Falta Content-Length.")
        length = int(raw_length)
        if length < 1 or length > MAX_BODY_BYTES:
            raise ValueError("The request body exceeds the allowed limit.")
        return json.loads(self.rfile.read(length))

    def _audio(self, path: Path, mime_type: str, metrics: dict[str, Any] | None = None) -> None:
        size = path.stat().st_size
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", "private, no-store")
        if metrics:
            chunk_count = metrics.get("chunkCount")
            duration = metrics.get("durationSeconds")
            if isinstance(chunk_count, int) and chunk_count > 0:
                self._materia_header("Chunk-Count", str(chunk_count))
            if isinstance(duration, (int, float)) and duration > 0:
                self._materia_header("Duration-Seconds", str(duration))
            metric_headers = {
                "workerSeconds": "Worker-Seconds",
                "workerRoundTripSeconds": "Worker-Roundtrip-Seconds",
                "workerStartupOverheadSeconds": "Worker-Startup-Seconds",
                "queueSeconds": "Queue-Seconds",
                "conversionSeconds": "Conversion-Seconds",
                "totalSeconds": "Total-Seconds",
            }
            for metric, suffix in metric_headers.items():
                value = metrics.get(metric)
                if isinstance(value, (int, float)) and value >= 0:
                    self._materia_header(suffix, str(value))
            if isinstance(metrics.get("workerWasCold"), bool):
                self._materia_header("Worker-Cold", "true" if metrics["workerWasCold"] else "false")
        self.end_headers()
        with path.open("rb") as stream:
            while chunk := stream.read(64 * 1024):
                self.wfile.write(chunk)

    def _materia_header(self, suffix: str, value: str) -> None:
        self.send_header(f"X-Materia-{suffix}", value)

    def _error(self, status: int, error: Exception | str) -> None:
        self._json(status, {"error": str(error)})

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler contract
        if not self._authorized():
            self._error(HTTPStatus.UNAUTHORIZED, "Invalid authorization.")
            return
        path = urlparse(self.path).path
        if path == "/health":
            self._json(HTTPStatus.OK, {"status": "ok", "service": "materia-voice-node", "nodeId": self.server.config.id})
            return
        if path == "/v1/capabilities":
            self._json(HTTPStatus.OK, public_capabilities(self.server.config, self.server.jobs.engine_states()))
            return
        parts = path.strip("/").split("/")
        if len(parts) in {4, 5} and parts[:3] == ["v1", "audio", "jobs"]:
            if len(parts) == 5 and parts[4] == "content":
                with self.server.jobs.download(parts[3]) as downloadable:
                    if downloadable is None or downloadable.output_path is None or downloadable.mime_type is None:
                        job = self.server.jobs.get(parts[3])
                        if job is None:
                            status = HTTPStatus.GONE if self.server.jobs.was_expired(parts[3]) else HTTPStatus.NOT_FOUND
                            self._error(status, "The job has expired." if status == HTTPStatus.GONE else "The job does not exist.")
                        else:
                            self._error(HTTPStatus.CONFLICT, "The audio is not available yet.")
                        return
                    self._audio(downloadable.output_path, downloadable.mime_type, downloadable.metrics)
                return
            if len(parts) == 4:
                job = self.server.jobs.get(parts[3])
                if job is None:
                    status = HTTPStatus.GONE if self.server.jobs.was_expired(parts[3]) else HTTPStatus.NOT_FOUND
                    self._error(status, "The job has expired." if status == HTTPStatus.GONE else "The job does not exist.")
                    return
                self._json(HTTPStatus.OK, {"job": job.public()})
                return
        self._error(HTTPStatus.NOT_FOUND, "Ruta no encontrada.")

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler contract
        if not self._authorized():
            self._error(HTTPStatus.UNAUTHORIZED, "Invalid authorization.")
            return
        path = urlparse(self.path).path
        try:
            request = SpeechRequest.parse(self._body(), self.server.config)
        except (ValueError, json.JSONDecodeError) as error:
            self._error(HTTPStatus.BAD_REQUEST, error)
            return
        if path == "/v1/audio/jobs":
            job = self.server.jobs.submit(request)
            self._json(HTTPStatus.ACCEPTED, {"job": job.public()})
            return
        if path == "/v1/audio/speech":
            job = self.server.jobs.submit(request)
            try:
                job = self.server.jobs.wait(job.id, timeout=900)
            except TimeoutError:
                self._error(HTTPStatus.GATEWAY_TIMEOUT, "Synthesis exceeded the time limit.")
                return
            if job.state != "completed" or job.output_path is None or job.mime_type is None:
                self._error(HTTPStatus.BAD_GATEWAY, job.error or "Synthesis failed.")
                return
            with self.server.jobs.download(job.id) as downloadable:
                if downloadable is None or downloadable.output_path is None or downloadable.mime_type is None:
                    self._error(HTTPStatus.GONE, "The job has expired.")
                    return
                self._audio(downloadable.output_path, downloadable.mime_type, downloadable.metrics)
            return
        self._error(HTTPStatus.NOT_FOUND, "Ruta no encontrada.")
