# Flow Trace UI

[![CI](https://github.com/ghiloufibg/flowable-trace-ui/actions/workflows/ci.yml/badge.svg)](https://github.com/ghiloufibg/flowable-trace-ui/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/tag/ghiloufibg/flowable-trace-ui?label=release)](https://github.com/ghiloufibg/flowable-trace-ui/tags)
![Java](https://img.shields.io/badge/Java-21-orange)
![Spring Boot](https://img.shields.io/badge/Spring%20Boot-3.4-brightgreen)
![Flowable](https://img.shields.io/badge/Flowable-7.1-blue)
![Code style](https://img.shields.io/badge/code%20style-google--java--format-blue)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/ghiloufibg/flowable-trace-ui)](https://github.com/ghiloufibg/flowable-trace-ui/commits/main)

A Spring Boot auto-configuration library that adds a Flowable BPM trace/monitoring UI to an
existing Spring Boot application, backed by that application's own `ProcessEngine`. Add the
dependency, and the UI and its supporting REST endpoints appear — no new engine, no new
database configuration.

## Features

- Live BPMN diagram of a process instance, with per-node/edge state, gateway decisions, and
  multi-instance progress
- Token replay controls and a full activity trail per instance
- Variable history with before/after values, not just current state
- Job inspection across timer, async, and dead-letter queues, with exception stack traces and
  retry history
- Deployment and process-definition browsing, including version history and a per-deployment
  activity log
- Zero new infrastructure: reuses the consuming application's existing `ProcessEngine` and
  database — no separate engine, no new datasource config

## Modules

This repository is a Maven multi-module project:

| Module | Artifact | Purpose |
|---|---|---|
| `frontend` | `flow-trace-ui-frontend` | React/TanStack UI, built and embedded into the backend jar |
| `backend` | `flow-trace-ui-backend` | The Spring Boot library consumers depend on |

`backend` is the only module a consuming application adds as a dependency; the frontend build
output ships inside its jar.

## Requirements

- Java 21
- Spring Boot 3.x
- An existing Flowable 7.x `ProcessEngine` bean in the application context (typically via
  `flowable-spring-boot-starter`). This library never creates a `ProcessEngine` of its own — if
  none is found, its auto-configuration is a no-op.

## Getting started

Add the dependency:

```xml
<dependency>
  <groupId>io.ghiloufi.flowable</groupId>
  <artifactId>flow-trace-ui-backend</artifactId>
  <version>0.1.0-SNAPSHOT</version>
</dependency>
```

No further configuration is required. On startup, with a `ProcessEngine` bean present:

- The UI is served at `/flow-trace` (configurable, see below).
- Flowable's own REST API is available at `/process-api/**`, provided transitively via
  `flowable-spring-boot-starter-process-rest`.
- This library's enrichment endpoints are available at `/custom/**` (see below).

## Configuration properties

All properties are under the `flowtrace` prefix; none are required.

| Property | Default | Description |
|---|---|---|
| `flowtrace.enabled` | `true` | Set to `false` to disable the `/custom/**` enrichment endpoints, the audit trail listener, and the default-page-size filter. The embedded UI at `flowtrace.mount-path` is served independently of this property, whenever the frontend assets are present on the classpath and a `ProcessEngine` bean exists. |
| `flowtrace.mount-path` | `/flow-trace` | Where the embedded UI is served. |
| `flowtrace.default-page-size` | *(unset)* | Injects this value as the `size` query parameter on any `/process-api/**` request that doesn't specify one, so list endpoints don't silently fall back to Flowable's own hardcoded default of 10. Leave unset to keep that default unchanged. |

Example:

```yaml
flowtrace:
  mount-path: /flow-trace
  default-page-size: 1000
```

## REST API

| Endpoint | Provided by |
|---|---|
| `/process-api/**` | Flowable's own REST API (`flowable-spring-boot-starter-process-rest`), untouched |
| `GET /custom/instances/{id}` | This library — BPMN diagram, runtime/history state, variables, tasks, activity trail, jobs |
| `GET /custom/deployments/{id}` | This library — resources, deployed process definitions, activity log |
| `GET /custom/definitions/{key}/{version}` | This library — version detail |
| `GET /custom/jobs/{id}` | This library — job detail with attempt history |
| `GET /custom/jobs/health` | This library — aggregate timer/async/dead-letter/locked counts |

Response shapes match the frontend's domain types field-for-field; see
`backend/src/main/java/io/ghiloufi/flowable/rest/dto/`.

## Development

```bash
mvn verify
```

Builds the frontend, embeds it into the backend jar, and runs the full backend test suite
(unit + Spring context tests, no external services required). Code style is enforced via
[Spotless](https://github.com/diffplug/spotless) (Google Java Format), checked on every
`verify`. CI runs the same command on every push and pull request to `main`.

One-time setup per clone, to enable this repo's commit-message hook (see `CLAUDE.md`):

```bash
git config core.hooksPath .githooks
```

### Dependency vulnerability (CVE) scanning

[OWASP dependency-check](https://owasp.org/www-project-dependency-check/) scans every Java
dependency across the reactor against the NVD; `npm audit` covers the frontend. Both run in CI
(the `dependency-check` job) on every push/PR and weekly, failing on CVSS ≥ 7 (Java) or high/
critical (npm). Not bound to `mvn verify` — a full scan is slow — run it explicitly:

```bash
mvn org.owasp:dependency-check-maven:aggregate
```

**One-time setup to enable this in CI**: register a free NVD API key at
[nvd.nist.gov/developers/request-an-api-key](https://nvd.nist.gov/developers/request-an-api-key),
then add it as a repository secret named `NVD_API_KEY` (Settings → Secrets and variables →
Actions → New repository secret). Without it the scan still runs but is much slower and can hit
NVD rate limits — the CI job prints a warning when the secret is missing.

False positives go in `dependency-check-suppressions.xml` at the repo root, not silently ignored.

### Publishing to Maven Central

Pushing a tag matching `v*` triggers CI's `publish` job, which deploys the parent POM and
`flow-trace-ui-backend` (only — `frontend`/`e2e-fixture` are marked `maven.deploy.skip`) via the
`release` Maven profile (GPG-signs everything, attaches source/javadoc jars, uploads through the
Central Portal). The profile is never active outside that job — it won't affect `mvn verify` or
local builds.

**This cannot work yet without manual setup, in this order:**

1. **Verify the `io.ghiloufi.flowable` namespace** at [central.sonatype.com](https://central.sonatype.com).
   This groupId does *not* match the auto-verified `io.github.<username>` convention, so it likely
   needs proof of domain ownership — check this first, since it's the one prerequisite that could
   block everything else regardless of how correct the pipeline is.
2. Generate a **Central Portal user token** (account → Generate User Token) and add its two halves
   as repo secrets `CENTRAL_TOKEN_USERNAME` / `CENTRAL_TOKEN_PASSWORD`.
3. Generate a **GPG key pair**, publish the public key to a keyserver (e.g.
   `gpg --keyserver keyserver.ubuntu.com --send-keys <key-id>` — Central checks it's retrievable),
   and add the exported private key (`gpg --export-secret-keys --armor <key-id>`) as
   `GPG_PRIVATE_KEY`, plus its passphrase as `GPG_PASSPHRASE`.
4. Before tagging, bump the version in every `pom.xml` away from `-SNAPSHOT` — Central's release
   repository rejects snapshot versions.

`autoPublish` is deliberately `false` in the `release` profile: a tagged push uploads and validates
but stops short of going live, so the first several releases can be reviewed in the Central Portal
before finalizing. Flip it to `true` once the pipeline is trusted.

## Contributing

Frontend UI components (`frontend/src/components/`, route components) are maintained through a
separate design workflow and aren't accepted as direct PRs — open an issue to discuss UI changes
first. Everything else — the backend module, the frontend's data-access layer, and
documentation — is open to PRs.

## Further reading

- `claudedocs/backend-library-design.md` — architecture and design decisions, including the
  rationale behind each item in the requirements and configuration sections above.
- `claudedocs/known-limitations.md` — deliberate scope cuts, tracked as backlog.

## Status

Pre-1.0 (`0.1.0-SNAPSHOT`). Functional and covered by unit, integration, and live end-to-end
testing (see `claudedocs/qa-report-*.md`), but the API surface is not yet considered stable.

## License

[MIT](LICENSE)
