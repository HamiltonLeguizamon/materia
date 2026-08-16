from __future__ import annotations

import argparse

from .config import load_config
from .gateway import VoiceNodeServer


def main() -> None:
    parser = argparse.ArgumentParser(description="Materia federated voice-node gateway")
    parser.add_argument("--config", required=True, help="Path to the node's local TOML file")
    args = parser.parse_args()
    config = load_config(args.config)
    server = VoiceNodeServer(config)
    print(f"Materia voice node {config.id} listening on http://{config.bind}:{config.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
