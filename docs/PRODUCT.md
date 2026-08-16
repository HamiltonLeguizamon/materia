# Product

## Promise

Materia turns source material into a structured learning experience that works for reading and guided listening. Courses preserve source traceability, explain concepts through purposeful semantic blocks, and include retrieval checks and persistent progress. Teaching blocks can also carry typed visual artifacts—code, diagrams, and attributed references to canonical images—without sending those payloads to speech synthesis.

## Audience and operating model

The primary user runs Materia locally and owns their data, credentials, and optional voice infrastructure. This is a reusable open-source project, not a hosted SaaS. It does not require accounts, billing, analytics, or a cloud database.

## Core journey

1. Try a deterministic course without credentials or network access.
2. Create a direct lesson from pasted text with an explicitly configured provider, or ask an agent to research and author a multi-source course through MCP.
3. Review source coverage and validate the draft before publication.
4. Read chapters, answer checks, and preserve progress locally.
5. Optionally estimate and confirm audio generation for a chapter, lesson, or course using OpenAI or an explicitly selected local voice node.

The study library is course-first: all courses are visible by default, while publication and study-progress filters provide focused views for published, validated, draft, active, or completed work. Course-owned lessons are navigated inside their course and never appear as independently deletable library records. Directly generated and demo lessons remain available as standalone lessons.

## Language model

English is the default UI language and Spanish is an explicit alternative. Course language is independent: English (US), English (UK), and Spanish are supported. Narration and speech selection follow course content, never the UI locale. Existing content without language metadata remains Spanish.

## Safety and trust

- Provider keys remain server-side.
- Demo mode never contacts an AI or voice provider.
- Importing or studying content never silently generates billable output.
- Audio generation is estimated and explicitly confirmed.
- Duplicate, interrupted, and ambiguous remote work is represented honestly and recovered conservatively.
- The web runtime is loopback-only by default and includes no authentication for public exposure.

## Current scope

Materia supports local courses and lessons, source references, assessments, progress, durable generation jobs, browser speech, optional OpenAI TTS, local voice nodes, Docker, and an MCP authoring interface. Realtime conversation, microphone transcription, URL crawling, PDF ingestion, RAG, accounts, payments, and hosted multi-user operation are outside the current scope.
