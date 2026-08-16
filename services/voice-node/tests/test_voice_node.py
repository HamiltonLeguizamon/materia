from __future__ import annotations

import contextlib
import io
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from voice_node.config import EngineConfig, load_config  # noqa: E402
from voice_node.contracts import SpeechRequest  # noqa: E402
from voice_node.gateway import VoiceNodeServer  # noqa: E402
from voice_node.worker_process import WorkerProcess  # noqa: E402
from voice_node.workers import bootstrap  # noqa: E402
from voice_node.workers import runtime  # noqa: E402


class ConfigExampleTest(unittest.TestCase):
    def test_public_examples_are_valid_and_platform_neutral(self) -> None:
        examples = ROOT / "config"
        compatible = load_config(examples / "openai-compatible.example.toml")
        local_gpu = load_config(examples / "local-gpu.example.toml")

        self.assertEqual(compatible.id, "compatible-node")
        self.assertEqual(compatible.engines["kokoro"].worker, "openai-compatible")
        self.assertEqual(local_gpu.id, "local-gpu-node")
        self.assertEqual(set(local_gpu.engines), {"kokoro", "qwen", "chatterbox"})


class VoiceNodeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        self.config_path = root / "node.toml"
        self.config_path.write_text(f'''
[node]
id = "test-node"
label = "Test Node"
bind = "127.0.0.1"
port = {port}
work_dir = "{root / 'work'}"
ffmpeg = "ffmpeg"
max_concurrent_jobs = 1
auth_token_env = "VOICE_NODE_TEST_TOKEN"

[engines.fake]
label = "Fake Engine"
quality = "test"
python = "{sys.executable}"
worker = "fake"
languages = ["es"]
voices = [{{ id = "test_voice", label = "Test Voice" }}]
''', encoding="utf-8")
        os.environ["VOICE_NODE_TEST_TOKEN"] = "test-secret"
        self.server = VoiceNodeServer(load_config(self.config_path))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        os.environ.pop("VOICE_NODE_TEST_TOKEN", None)
        self.temp.cleanup()

    def request(self, path: str, *, method: str = "GET", body: dict | None = None, token: str = "test-secret"):
        data = json.dumps(body).encode() if body is not None else None
        request = Request(
            self.base_url + path,
            method=method,
            data=data,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        return urlopen(request, timeout=10)

    def test_health_requires_token(self) -> None:
        with self.assertRaises(HTTPError) as context:
            self.request("/health", token="incorrect")
        self.assertEqual(context.exception.code, 401)
        context.exception.close()
        with self.request("/health") as response:
            self.assertEqual(json.load(response)["nodeId"], "test-node")

    def test_capabilities_hide_commands_and_paths(self) -> None:
        with self.request("/v1/capabilities") as response:
            payload = json.load(response)
        self.assertEqual(payload["engines"][0]["id"], "fake")
        serialized = json.dumps(payload)
        self.assertNotIn(sys.executable, serialized)
        self.assertNotIn("work_dir", serialized)

    def test_synchronous_speech_returns_audio(self) -> None:
        with self.request("/v1/audio/speech", method="POST", body={
            "engine": "fake",
            "input": "Una prueba suficientemente clara.",
            "voice": "test_voice",
            "language": "es",
            "response_format": "wav",
        }) as response:
            content = response.read()
            self.assertEqual(response.headers["Content-Type"], "audio/wav")
            self.assertIsNotNone(response.headers["X-Materia-Worker-Seconds"])
            self.assertIsNotNone(response.headers["X-Materia-Total-Seconds"])
            self.assertEqual(response.headers["X-Materia-Worker-Cold"], "true")
        self.assertEqual(content[:4], b"RIFF")

    def test_async_job_exposes_no_input_or_path(self) -> None:
        with self.request("/v1/audio/jobs", method="POST", body={
            "engine": "fake",
            "input": "Contenido privado de la lección.",
            "voice": "test_voice",
            "language": "es",
            "response_format": "wav",
        }) as response:
            job = json.load(response)["job"]
        self.assertNotIn("input", job["request"])
        for _ in range(100):
            with self.request(f"/v1/audio/jobs/{job['id']}") as response:
                job = json.load(response)["job"]
            if job["state"] in {"completed", "failed"}:
                break
            time.sleep(0.02)
        self.assertEqual(job["state"], "completed")
        self.assertIn("queueSeconds", job["metrics"])
        self.assertIn("workerRoundTripSeconds", job["metrics"])
        serialized = json.dumps(job)
        self.assertNotIn("Contenido privado", serialized)
        self.assertNotIn("options", job["request"])
        retained = self.server.jobs.get(job["id"])
        self.assertIsNotNone(retained)
        self.assertEqual(retained.request.input, "")
        self.assertEqual(retained.request.options, {})
        with self.request(f"/v1/audio/jobs/{job['id']}/content") as response:
            self.assertEqual(response.read(4), b"RIFF")

    def test_expired_job_returns_gone_and_removes_its_output(self) -> None:
        job = self.server.jobs.submit(SpeechRequest(
            engine="fake",
            input="Contenido que debe expirar.",
            voice="test_voice",
            response_format="wav",
        ))
        completed = self.server.jobs.wait(job.id, timeout=10)
        self.assertIsNotNone(completed.output_path)
        output_path = completed.output_path
        completed.updated_at = time.time() - self.server.config.retention_ttl_seconds - 1

        self.server.jobs.cleanup()

        self.assertFalse(output_path.exists())
        with self.assertRaises(HTTPError) as context:
            self.request(f"/v1/audio/jobs/{job.id}")
        self.assertEqual(context.exception.code, 410)
        self.assertIn("expired", context.exception.read().decode("utf-8"))
        context.exception.close()

    def test_retention_limits_completed_jobs(self) -> None:
        self.server.jobs.config = self.server.config.__class__(
            **{**self.server.config.__dict__, "max_retained_jobs": 1},
        )
        first = self.server.jobs.submit(SpeechRequest(engine="fake", input="Primero.", voice="test_voice", response_format="wav"))
        self.server.jobs.wait(first.id, timeout=10)
        second = self.server.jobs.submit(SpeechRequest(engine="fake", input="Segundo.", voice="test_voice", response_format="wav"))
        self.server.jobs.wait(second.id, timeout=10)

        self.assertIsNone(self.server.jobs.get(first.id))
        self.assertTrue(self.server.jobs.was_expired(first.id))
        self.assertIsNotNone(self.server.jobs.get(second.id))

    def test_active_download_defers_expiry_until_reader_finishes(self) -> None:
        job = self.server.jobs.submit(SpeechRequest(engine="fake", input="Descarga protegida.", voice="test_voice", response_format="wav"))
        completed = self.server.jobs.wait(job.id, timeout=10)
        self.assertIsNotNone(completed.output_path)
        output_path = completed.output_path

        with self.server.jobs.download(job.id) as downloadable:
            self.assertIsNotNone(downloadable)
            completed.updated_at = time.time() - self.server.config.retention_ttl_seconds - 1
            self.server.jobs.cleanup()
            self.assertTrue(output_path.exists())
            self.assertIsNotNone(self.server.jobs.get(job.id))

        self.assertFalse(output_path.exists())
        self.assertTrue(self.server.jobs.was_expired(job.id))


class WorkerProtocolTest(unittest.TestCase):
    def test_worker_process_launches_module_to_avoid_package_shadowing(self) -> None:
        engine = EngineConfig(
            id="fake",
            label="Fake Engine",
            quality="test",
            python=sys.executable,
            worker="fake",
            languages=("es",),
            voices=(),
            environment={},
        )
        process = MagicMock()
        worker = WorkerProcess(engine)
        with patch("voice_node.worker_process.subprocess.Popen", return_value=process) as launch:
            self.assertIs(worker._start(), process)

        command = launch.call_args.args[0]
        self.assertEqual(command, [
            sys.executable,
            "-u",
            "-m",
            "voice_node.workers.bootstrap",
            "fake",
        ])
        python_path = launch.call_args.kwargs["env"]["PYTHONPATH"].split(os.pathsep)
        self.assertIn(str(ROOT), python_path)

    def test_bootstrap_redirects_import_time_stdout(self) -> None:
        stdout = io.StringIO()
        stderr = io.StringIO()

        def noisy_import(*args, **kwargs):
            print("model import noise")

        with patch.object(bootstrap.runpy, "run_module", side_effect=noisy_import):
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                bootstrap.run("fake")

        self.assertEqual(stdout.getvalue(), "")
        self.assertIn("model import noise", stderr.getvalue())

    def test_hyphenated_worker_maps_to_python_module(self) -> None:
        self.assertEqual(
            bootstrap.module_name("openai-compatible"),
            "voice_node.workers.openai_compatible",
        )
        engine = EngineConfig(
            id="kokoro",
            label="Kokoro MLX",
            quality="test",
            python=sys.executable,
            worker="openai-compatible",
            languages=("es",),
            voices=(),
            environment={},
        )
        process = MagicMock()
        worker = WorkerProcess(engine)
        with patch("voice_node.worker_process.subprocess.Popen", return_value=process):
            self.assertIs(worker._start(), process)

    def test_runtime_keeps_model_stdout_out_of_json_protocol(self) -> None:
        protocol = io.StringIO()
        redirected_stdout = io.StringIO()
        stderr = io.StringIO()
        request = io.StringIO('{"id":"test-id","operation":"synthesize"}\n')

        def noisy_synthesis(payload: dict) -> dict:
            print("model generation noise")
            return {"durationSeconds": 1.0}

        with patch.object(sys, "stdin", request), patch.object(sys, "__stdout__", protocol):
            with contextlib.redirect_stdout(redirected_stdout), contextlib.redirect_stderr(stderr):
                runtime.serve(noisy_synthesis)

        response = json.loads(protocol.getvalue())
        self.assertEqual(response["id"], "test-id")
        self.assertTrue(response["ok"])
        self.assertEqual(redirected_stdout.getvalue(), "")
        self.assertIn("model generation noise", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
