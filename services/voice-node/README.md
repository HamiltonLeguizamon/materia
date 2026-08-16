# Materia Voice Node

`voice-node` exposes the speech engines available on one device without mixing their Python dependencies. The gateway uses only the Python standard library; each engine runs as a persistent process with the interpreter from its own environment.

It can run on the same machine as Materia or on a trusted private network. Tailscale is one possible transport, not a requirement. Do not expose this service directly to the public Internet.

## API contract

- `GET /health`
- `GET /v1/capabilities`
- `POST /v1/audio/speech` — synchronous compatibility endpoint.
- `POST /v1/audio/jobs` — creates an asynchronous job.
- `GET /v1/audio/jobs/{id}`
- `GET /v1/audio/jobs/{id}/content`

Every route requires `Authorization: Bearer <token>` when `node.auth_token_env` is configured and contains a value. Worker paths, tokens, and private voice references never appear in public capabilities.

## Local retention

Completed jobs retain their audio for a bounded download window. By default, a node keeps at most 100 jobs, 2 GiB, and six hours of results. Configure `node.retention_ttl_seconds`, `node.max_retained_jobs`, and `node.max_retained_bytes` in the private TOML file. The first limit reached applies. An active download protects its file until completion; a later request for an expired job returns HTTP `410 Gone`.

Request text and private options are discarded when a worker finishes. The public job view contains only the engine, voice, language, speed, format, status, and sanitized timing metrics. On startup, the gateway removes inaccessible WAV/MP3 job artifacts left by an interrupted process.

## Local development without models

```sh
python3 -m unittest discover -s services/voice-node/tests -v
```

To run a node, create an isolated Python environment and a private configuration based on the integration pattern you use:

- `config/openai-compatible.example.toml` connects the gateway to an already-running OpenAI-compatible speech endpoint.
- `config/local-gpu.example.toml` shows native CUDA workers for Kokoro, Qwen, and Chatterbox. Remove every engine you do not operate.

The templates are platform-neutral and non-operational: replace interpreter paths, model IDs, voices, languages, and upstream addresses with values from your own installation. Copy the selected template to an ignored private file such as `services/voice-node/node.local.toml`, then start the gateway with that file:

```sh
python3 -m venv .voice-node-env
.voice-node-env/bin/python -m pip install -e services/voice-node
export MATERIA_VOICE_NODE_TOKEN='<local-secret>'
.voice-node-env/bin/materia-voice-node --config services/voice-node/node.local.toml
```

PowerShell uses the same private TOML contract:

```powershell
py -3 -m venv .voice-node-env
.voice-node-env\Scripts\python.exe -m pip install -e services/voice-node
$env:MATERIA_VOICE_NODE_TOKEN = '<local-secret>'
.voice-node-env\Scripts\materia-voice-node.exe --config services/voice-node/node.local.toml
```

Do not commit `node.toml`, real voice registries, reference WAV files, models, tokens, or logs. Files under `config/` are non-operational templates; each device operator must create and protect the real configuration.

## Worker protocol

The gateway starts `python -u workers/<worker>.py` and uses JSON Lines over standard input and output. Each request contains an `output_path` created by the gateway. The worker writes PCM WAV audio there and returns only metrics. This keeps audio out of JSON and allows the model to remain loaded.

Worker logs belong on `stderr`; `stdout` is reserved for the protocol.
