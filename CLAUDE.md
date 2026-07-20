# Project-specific rules for Claude Code

## Project overview

Flow-Trace UI is a Flowable BPM trace/monitoring frontend, currently a single React +
TanStack repo connected to Lovable (see `AGENTS.md`), talking to a mock HTTP server
compatible with the Flowable 7.x REST API plus custom enrichment endpoints.

The approved architecture for the real backend — a Spring Boot 3 / Java 21 / Flowable 7.x
auto-configuration library that embeds this frontend and reuses the consumer application's
existing `ProcessEngine` and database — is documented in
`claudedocs/backend-library-design.md`. That document is the source of truth for backend
design decisions; check it before implementing any backend feature, and treat its
"Open decisions" section as unvalidated until a spike confirms them.

**Current repo state vs. planned state:** today everything still lives at the repo root as
a single npm/Vite project (no Maven modules exist yet). The design plans a restructuring
into `frontend/` + `backend/` Maven modules (root `pom.xml`, frontend content moved under
`frontend/`, new `backend/` module added). Until that restructuring happens, the paths below
refer to today's root-level `src/`; once restructured, the same rules apply under
`frontend/src/`.

**No git remote is currently configured** (intentionally removed to avoid accidentally
pushing to the Lovable-connected repo). Don't add one without the user asking.

## Component code is owned by Lovable

Never modify component/UI code — anything under `src/components/`, `src/routes/*.tsx`
route components, or other JSX/TSX presentational code — unless the user explicitly
validates that specific change first. Component-level changes are expected to flow through
Lovable's workflow, not through Claude Code.

If a task seems to require a component change, stop and ask the user first instead of
making the edit.

## Frontend data-access/contract layer: no large or uncertain refactors

Files in the data-access/contract layer — `src/lib/api/client.ts`,
`src/lib/api/flowable-mappers.ts`, `src/lib/repositories/http-*.ts`, and `src/lib/store.ts` —
can be touched for small, well-understood changes. But if a needed refactor of this layer is:

- large in scope (touches many of these files or restructures the contract significantly), or
- uncertain (the mapping between old and new shapes isn't fully clear), or
- risky (could plausibly break the running application)

then do **not** perform it. Instead:

1. Flag this clearly to the user — explain what needs to change and why it's risky to do
   directly.
2. Explain what should be asked of Lovable instead, concretely enough that the user can
   paste it into Lovable as-is (what files/behavior are involved, what the new contract
   shape should look like, and what to verify afterward).
3. Wait for the user's decision (do it anyway here, or route it through Lovable) before
   proceeding.

This applies to the SSR→SPA conversion and Flowable-envelope rewrite described in
`claudedocs/backend-library-design.md` too — those are exactly the kind of large, contract-
shaping changes this rule exists for; don't do them silently as a side effect of backend
work.

## Backend module: fair game, but follow the approved design

Once the `backend` Maven module exists, its Java code is **not** Lovable's concern — Claude
Code can implement it directly. Follow `claudedocs/backend-library-design.md`'s locked-in
decisions (reuse an existing `ProcessEngine` only, never bootstrap one; pull the `DataSource`
off the existing engine rather than adding new `flowtrace.datasource.*` properties; audit
trail via `FlowableEventDispatcher`, not `ProcessEngineConfigurator`; Google Java Format via
Spotless). If an implementation detail contradicts a locked-in decision, flag it and confirm
with the user rather than silently deviating.
