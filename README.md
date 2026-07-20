# Flow Trace UI

A Spring Boot auto-configuration library that adds a Flowable BPM trace/monitoring UI to an
existing Spring Boot application, backed by that application's own `ProcessEngine`. Add the
dependency, and the UI and its supporting REST endpoints appear — no new engine, no new
database configuration.

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

## Further reading

- `claudedocs/backend-library-design.md` — architecture and design decisions, including the
  rationale behind each item in the requirements and configuration sections above.
- `claudedocs/known-limitations.md` — deliberate scope cuts, tracked as backlog.
- `CLAUDE.md` — contribution rules for this repository (which parts of the codebase are owned by
  which workflow).

## Status

Pre-1.0 (`0.1.0-SNAPSHOT`). Functional and covered by unit, integration, and live end-to-end
testing (see `claudedocs/qa-report-*.md`), but the API surface is not yet considered stable.
