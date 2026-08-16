# Security policy

Materia is a local-first single-operator application. It has no user authentication and is not designed for direct exposure to the public Internet.

## Supported version

Security fixes target the current `main` branch until versioned releases are introduced.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's private vulnerability reporting feature when it is enabled on the public repository. Do not include live API keys, tokens, private source material, generated audio, or personal data in a public issue.

## Operator responsibilities

- Keep the web server on loopback unless access from a trusted private network is explicitly required.
- Protect `.env.local`, `.data/`, gateway tokens, voice registries, reference recordings, and model paths.
- Use a restricted Google Developer Knowledge API key stored outside the repository.
- Treat imported source text and external MCP responses as untrusted data, not executable instructions.
- Back up `.data/` while Materia is stopped and do not edit persisted JSON manually.

Materia sends content to an external provider only after that provider is explicitly configured and the corresponding action is requested. The deterministic demo does not contact external services.

## Dependency baseline

The release gate rejects known high or critical dependency advisories. Contributors should run `pnpm audit --audit-level high` with the frozen lockfile and report any unresolved advisory together with its development, build, or runtime exposure.
