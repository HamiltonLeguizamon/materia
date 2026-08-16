from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
import re
import subprocess
import threading
import time
from typing import Iterator
from uuid import uuid4

from .config import NodeConfig
from .contracts import AudioJob, SpeechRequest
from .worker_process import WorkerProcess


class JobManager:
    def __init__(self, config: NodeConfig):
        self.config = config
        self.config.work_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._workers = {key: WorkerProcess(value) for key, value in config.engines.items()}
        self._jobs: dict[str, AudioJob] = {}
        self._futures: dict[str, Future[None]] = {}
        self._active_downloads: dict[str, int] = {}
        self._expired: dict[str, float] = {}
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=config.max_concurrent_jobs, thread_name_prefix="voice-job")
        self._remove_orphaned_outputs()

    def engine_states(self) -> dict[str, str]:
        return {key: worker.state for key, worker in self._workers.items()}

    def submit(self, request: SpeechRequest) -> AudioJob:
        job = AudioJob(id=str(uuid4()), request=request, state="queued")
        print(f"[voice-node:{job.id}] queued engine={request.engine} voice={request.voice}", flush=True)
        with self._lock:
            self._cleanup_locked()
            self._jobs[job.id] = job
            self._futures[job.id] = self._executor.submit(self._run, job.id)
        return job

    def get(self, job_id: str) -> AudioJob | None:
        with self._lock:
            self._cleanup_locked()
            return self._jobs.get(job_id)

    def was_expired(self, job_id: str) -> bool:
        with self._lock:
            self._cleanup_expired_markers_locked()
            return job_id in self._expired

    @contextmanager
    def download(self, job_id: str) -> Iterator[AudioJob | None]:
        with self._lock:
            self._cleanup_locked()
            job = self._jobs.get(job_id)
            if job is not None and job.state == "completed" and job.output_path is not None:
                self._active_downloads[job_id] = self._active_downloads.get(job_id, 0) + 1
            else:
                job = None
        try:
            yield job
        finally:
            if job is not None:
                with self._lock:
                    remaining = self._active_downloads.get(job_id, 1) - 1
                    if remaining > 0:
                        self._active_downloads[job_id] = remaining
                    else:
                        self._active_downloads.pop(job_id, None)
                    self._cleanup_locked()

    def cleanup(self) -> None:
        with self._lock:
            self._cleanup_locked()

    def wait(self, job_id: str, timeout: float | None = None) -> AudioJob:
        with self._lock:
            future = self._futures.get(job_id)
        if future is None:
            raise KeyError(job_id)
        future.result(timeout=timeout)
        job = self.get(job_id)
        if job is None:
            raise KeyError(job_id)
        return job

    def _run(self, job_id: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            total_started = time.perf_counter()
            queue_seconds = round(max(0.0, time.time() - job.created_at), 3)
            job.state = "running"
            job.updated_at = time.time()
        print(f"[voice-node:{job.id}] running engine={job.request.engine} queueSeconds={queue_seconds}", flush=True)
        wav_path = self.config.work_dir / f"{job.id}.wav"
        try:
            response = self._workers[job.request.engine].request({
                "id": job.id,
                "operation": "synthesize",
                "output_path": str(wav_path),
                "input": job.request.input,
                "voice": job.request.voice,
                "language": job.request.language,
                "speed": job.request.speed,
                "options": job.request.options,
            })
            if not wav_path.is_file() or wav_path.stat().st_size < 44:
                raise RuntimeError("The worker did not produce valid WAV audio.")
            output_path = wav_path
            mime_type = "audio/wav"
            conversion_seconds = 0.0
            if job.request.response_format == "mp3":
                output_path = self.config.work_dir / f"{job.id}.mp3"
                conversion_started = time.perf_counter()
                conversion = subprocess.run(
                    [self.config.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav_path), "-codec:a", "libmp3lame", "-b:a", "128k", str(output_path)],
                    capture_output=True,
                    text=True,
                    timeout=120,
                    check=False,
                )
                if conversion.returncode != 0 or not output_path.is_file():
                    raise RuntimeError(f"FFmpeg no pudo crear el MP3: {conversion.stderr.strip()[:300]}")
                conversion_seconds = round(time.perf_counter() - conversion_started, 3)
                wav_path.unlink(missing_ok=True)
                mime_type = "audio/mpeg"
            worker_metrics = response.get("metrics") if isinstance(response.get("metrics"), dict) else {}
            with self._lock:
                job.output_path = output_path
                job.mime_type = mime_type
                job.metrics = {
                    **worker_metrics,
                    "queueSeconds": queue_seconds,
                    "conversionSeconds": conversion_seconds,
                    "totalSeconds": round(time.perf_counter() - total_started + queue_seconds, 3),
                }
                job.state = "completed"
            print(
                f"[voice-node:{job.id}] completed engine={job.request.engine} "
                f"cold={job.metrics.get('workerWasCold')} workerSeconds={job.metrics.get('workerSeconds')} "
                f"conversionSeconds={conversion_seconds} totalSeconds={job.metrics.get('totalSeconds')}",
                flush=True,
            )
        except Exception as error:  # noqa: BLE001 - process boundary
            wav_path.unlink(missing_ok=True)
            (self.config.work_dir / f"{job.id}.mp3").unlink(missing_ok=True)
            with self._lock:
                job.state = "failed"
                job.error = "The speech engine could not complete synthesis."
            print(f"[voice-node:{job.id}] failed engine={job.request.engine} error={type(error).__name__}", flush=True)
        finally:
            with self._lock:
                job.updated_at = time.time()
                job.discard_private_request_data()
                self._cleanup_locked()

    def _cleanup_locked(self) -> None:
        now = time.time()
        self._cleanup_expired_markers_locked(now)
        terminal = sorted(
            (job for job in self._jobs.values() if job.state in {"completed", "failed"}),
            key=lambda item: item.updated_at,
        )
        retained_bytes = sum(self._output_size(job) for job in terminal)
        retained_jobs = len(terminal)
        for job in terminal:
            expired_by_age = now - job.updated_at >= self.config.retention_ttl_seconds
            over_job_limit = retained_jobs > self.config.max_retained_jobs
            over_byte_limit = retained_bytes > self.config.max_retained_bytes
            if not (expired_by_age or over_job_limit or over_byte_limit):
                continue
            if self._active_downloads.get(job.id, 0) > 0:
                continue
            size = self._output_size(job)
            self._expire_locked(job, now)
            retained_jobs -= 1
            retained_bytes = max(0, retained_bytes - size)

    def _expire_locked(self, job: AudioJob, now: float) -> None:
        self._jobs.pop(job.id, None)
        self._futures.pop(job.id, None)
        self._active_downloads.pop(job.id, None)
        for suffix in ("wav", "mp3"):
            (self.config.work_dir / f"{job.id}.{suffix}").unlink(missing_ok=True)
        self._expired[job.id] = now
        self._cleanup_expired_markers_locked(now)

    def _cleanup_expired_markers_locked(self, now: float | None = None) -> None:
        current = time.time() if now is None else now
        for job_id, expired_at in list(self._expired.items()):
            if current - expired_at >= self.config.retention_ttl_seconds:
                self._expired.pop(job_id, None)
        while len(self._expired) > self.config.max_retained_jobs:
            oldest = min(self._expired, key=self._expired.get)
            self._expired.pop(oldest, None)

    @staticmethod
    def _output_size(job: AudioJob) -> int:
        try:
            return job.output_path.stat().st_size if job.output_path is not None else 0
        except FileNotFoundError:
            return 0

    def _remove_orphaned_outputs(self) -> None:
        pattern = re.compile(r"^[0-9a-f-]{36}\.(?:wav|mp3)$")
        for candidate in self.config.work_dir.iterdir():
            if candidate.is_file() and pattern.fullmatch(candidate.name):
                candidate.unlink(missing_ok=True)

    def close(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)
        for worker in self._workers.values():
            worker.close()
