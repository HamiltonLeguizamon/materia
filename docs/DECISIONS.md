# Durable decisions

## Local-first operation

Materia is a single-operator local application, not a hosted SaaS. It listens on loopback by default, stores state under `.data/`, and has no authentication for public exposure. Remote access is an explicit choice for a trusted private network.

## Deterministic demo and explicit providers

The demo works without credentials or network access. OpenAI and local voice nodes are optional, explicitly selected providers. Materia never silently falls back between paid and local generation.

## Source-grounded course model

Courses preserve sources and block-level references. Agents may research and author through MCP, while Materia validates and persists the structured artifact. Importing content does not itself call a text or speech model.

## Durable files and conservative recovery

JSON records use validation, atomic replacement, bounded journaling, revision checks, idempotent operations, leases, and conservative interrupted/unknown states. Ambiguous remote audio submissions are not automatically repeated.

## Provider isolation

Text and speech providers sit behind application ports. Credentials, node URLs, tokens, filesystem paths, and private voice references remain server-side. Browser responses contain only sanitized capabilities.

## Independent languages

The interface defaults to English and can switch to Spanish. Course content language is stored independently and controls generation, narration, and compatible speech selection.

## Portable production artifact

Production runs from Next.js standalone output on Linux, macOS, and Windows. Builds are audited to exclude local data, environment files, internal configuration, tests, and auxiliary services.

## Licensing

Materia is licensed under Apache License 2.0. `NOTICE` identifies Hamilton Leguizamon as the original copyright holder without adding an extra attribution restriction.

## Initial release version

The first public release is `v0.1.0`. It is a stable, tested release rather than a prerelease, while the pre-1.0 version communicates that public APIs, MCP tools, persisted schemas, and setup conventions may still evolve with documented migrations.
