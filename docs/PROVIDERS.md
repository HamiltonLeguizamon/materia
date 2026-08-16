# Provider setup

Materia works without provider credentials. The deterministic demo and agent/MCP course-authoring path remain available when OpenAI and voice nodes are not configured.

## OpenAI quick setup

OpenAI is the shortest optional path for direct lesson generation and generated narration:

1. Stop Materia.
2. Copy `.env.example` to `.env.local` if the local file does not exist.
3. Set `OPENAI_API_KEY` in `.env.local`.
4. Restart `pnpm run dev`, `pnpm run start`, or Docker Compose.
5. Open **New lesson → Direct with OpenAI**. The provider should appear as configured.

Do not paste the key into the browser, commit `.env.local`, or expose it through a client-side variable. Materia reads the key only in its server process. Direct lesson creation can call the configured OpenAI text model; explicitly confirmed audio generation can call the configured speech model. API use can incur charges from the provider.

Materia does not currently implement microphone capture or speech-to-text transcription. “Narration” and “TTS” in the interface mean converting lesson text into spoken audio.

### Docker

The standard Compose command reads the same local environment file:

```sh
docker compose --env-file .env.local up --build
```

Restart the container after changing provider variables. Do not bake a real key into an image or commit it to Compose configuration.

## Local voice nodes

Kokoro, Qwen, Chatterbox, and OpenAI-compatible speech engines can run behind the optional gateway in `services/voice-node`. This route avoids sending narration to OpenAI when a compatible local engine is selected, but it requires a separate Python service, engine configuration, network reachability, and a shared token.

Start with `services/voice-node/README.md`, copy one neutral example from `services/voice-node/config`, and declare reachable nodes through `MATERIA_VOICE_NODES`. Node URLs, tokens, paths, and private voice data stay server-side. Materia never silently falls back between OpenAI and a local node.

## What each path enables

| Configuration | Direct lesson from pasted text | Agent/MCP courses | Generated narration | Microphone transcription |
| --- | --- | --- | --- | --- |
| No provider | No | Yes | Browser/demo only | No |
| `OPENAI_API_KEY` | Yes | Yes | OpenAI TTS | No |
| Local voice node | No additional text generation | Yes | Configured local engines | No |
