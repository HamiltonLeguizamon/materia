# Contributing to Materia

Thank you for improving Materia. Keep changes focused, local-first, and safe to run without credentials.

## Development

Use Node.js 22–24 and pnpm 11. Install dependencies without lifecycle scripts unless you have reviewed and explicitly approved a package that needs them:

```sh
pnpm install --frozen-lockfile --ignore-scripts
cp .env.example .env.local
pnpm run dev
```

For development from another trusted device, use `pnpm run dev:remote` and list only the permitted host names or addresses in the comma-separated `MATERIA_ALLOWED_DEV_ORIGINS` variable. Materia has no authentication, so never expose the development server directly to the public Internet.

Before proposing a change, run:

```sh
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
pnpm run smoke
pnpm audit --audit-level high
python3 -m unittest discover -s services/voice-node/tests -v
```

## Project boundaries

- Keep the deterministic demo usable without network access or credentials.
- Keep provider keys, node URLs, tokens, paths, and reference audio on the server.
- Put provider-specific behavior behind the existing application ports.
- Preserve revision checks, idempotency, explicit confirmation, and conservative recovery.
- Do not commit `.env*`, `.data/`, generated audio, real node configurations, voice registries, models, or credentials.
- Document public behavior in English; the Spanish guide and interface translations should remain aligned.

Small, reviewable pull requests with tests are preferred. By contributing, you agree that your contribution is licensed under Apache License 2.0.
