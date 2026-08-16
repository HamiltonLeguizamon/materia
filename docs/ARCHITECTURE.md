# Architecture

## Shape

Materia is a modular Next.js monolith with server-rendered React UI, route handlers, domain/application services, JSON file repositories, provider adapters, and a local STDIO MCP adapter. Docker packages the same application; it is not a separate architecture.

```text
Browser UI ─┐
            ├─ validated application services ─ domain model ─ durable local repositories
MCP STDIO ──┘                         │
                                      ├─ deterministic demo
                                      ├─ OpenAI text/speech adapters
                                      └─ local/federated voice-node adapters
```

## Boundaries

- `src/domain`: validated course, lesson, teaching, source, audio, and voice-node contracts.
- `src/application`: use cases, concurrency admission, idempotency, queues, and recovery behavior.
- `src/adapters`: persistence and provider-specific implementations.
- `src/app` and `src/components`: web delivery and localized presentation.
- `src/mcp`: thin STDIO adapter over application services.
- `services/voice-node`: portable Python gateway that exposes explicitly configured local engines.

Provider-specific behavior stays behind text-generation and speech-generation ports. API keys, node URLs, tokens, and filesystem paths never enter client bundles. Browser responses receive only public capabilities.

## Persistence and recovery

Data lives under `.data/` by default. JSON records are schema-validated and written atomically. Course/lesson mutations that span files use a bounded durable journal. Claims and locks carry an owner PID, runtime identity, lease, and conservative recovery rules.

Local queued or running jobs from a previous process become `interrupted`. A remote job resumes polling only when a validated remote job identifier was persisted; an ambiguously accepted request becomes `unknown` and is never automatically submitted again. Audio files are reconciled with current validated lesson artifacts.

## Concurrency

Identical requests reuse an idempotent operation. Conflicting generation on the same scope is rejected while active. Course audio runs sequentially to avoid competing inference loads. Revision checks make concurrent progress or editorial writes visible instead of silently overwriting them.

## Language

The server reads a non-sensitive `materia-locale` cookie for English or Spanish UI rendering. Course content stores `en-US`, `en-GB`, or `es-ES` independently. Generation prompts and narration use content language. Existing lesson records default to Spanish during schema migration; new creation requests default to English.

## Runtime

Native development uses `127.0.0.1:3210`; `dev:remote` deliberately binds `0.0.0.0` for a trusted private network. Production uses the verified Next.js standalone launcher. Docker binds loopback by default and persists `.data` in the `materia-data` volume. Operators can select another existing volume explicitly with `MATERIA_DATA_VOLUME`.

The MCP server uses STDIO and opens no additional network port. Development origins beyond loopback are opt-in through `MATERIA_ALLOWED_DEV_ORIGINS`.

## Compatibility contracts

Lesson schema v4 adds a required `artifacts` collection to each teaching block. Schema-v3 lessons migrate with empty collections. Artifact payloads are discriminated as `code`, `diagram`, or `image-reference`, validate their source links, and remain outside narration projection v3 so existing audio stays current.

Code is inert text. Diagrams use validated nodes and edges instead of executable diagram markup. Image references are HTTPS links with alternative text and attribution; Materia does not proxy or hotlink their binary content.

MCP tools, environment variables, voice-node headers, package/executable names, Docker resources, health metadata, and operator contracts use Materia exclusively. Persisted `.data` paths and schemas are neutral and unchanged.
