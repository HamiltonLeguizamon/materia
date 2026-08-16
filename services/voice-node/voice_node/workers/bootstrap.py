from __future__ import annotations

import contextlib
import re
import runpy
import sys


WORKER_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


def module_name(worker_name: str) -> str:
    if not WORKER_NAME.fullmatch(worker_name):
        raise ValueError("The worker name is invalid.")
    return f"voice_node.workers.{worker_name.replace('-', '_')}"


def run(worker_name: str) -> None:
    with contextlib.redirect_stdout(sys.stderr):
        runpy.run_module(module_name(worker_name), run_name="__main__", alter_sys=True)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Uso: bootstrap <worker>.")
    run(sys.argv[1])
