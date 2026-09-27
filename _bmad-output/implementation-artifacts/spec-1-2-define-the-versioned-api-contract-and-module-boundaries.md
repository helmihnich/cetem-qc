---
title: 'Define the versioned API contract and module boundaries'
type: 'feature'
created: '2026-09-27'
status: 'in-review'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/planning-artifacts/architecture/architecture-cetem-qc-2026-09-26/ARCHITECTURE-SPINE.md'
  - '_bmad-output/implementation-artifacts/epic-1-context.md'
  - '_bmad-output/implementation-artifacts/spec-1-1-establish-pnpm-workspace-and-application-skeleton.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Web, mobile, and API lack a shared, versioned contract, server boundary validation pattern, and enforceable module ownership conventions.

**Approach:** Establish an OpenAPI v1 source of truth that generates/maintains shared DTOs, Zod schemas, and a typed client; mount the API under `/api/v1`, validate untrusted request inputs at server boundaries, and document/enforce dependency and public command/query boundaries. Centralize French interface copy in shared language resources while keeping UI rendering owned by each app.

**Boundaries & Constraints**

**Always:** Preserve the Story 1.1 workspace and apps-to-shared dependency direction. Keep internal code/API identifiers English, user-facing strings French, and web/mobile presentation independently rendered. Module calls use public commands/queries; only a module's adapters may implement its persistence ports.

**Never:** Add PostgreSQL entities or migrations, authentication, team/task features, offline synchronization, calculations, reports, AI, or rendered UI sharing between apps.

</frozen-after-approval>

## Code Map

- `_bmad-output/planning-artifacts/epics.md` — authoritative Story 1.2 acceptance criteria; Story 1.3 database work is excluded.
- `_bmad-output/planning-artifacts/architecture/architecture-cetem-qc-2026-09-26/ARCHITECTURE-SPINE.md` — AD-2/3/10 dependency, modular monolith, contract, validation, and French copy rules.
- `packages/types/src/index.ts`, `packages/schemas/src/index.ts`, `packages/api-client/src/index.ts` — empty package entrypoints to establish the contract pipeline.
- `apps/api/src/index.ts` — current Express `/health` endpoint; introduce app factory, `/api/v1` routing and boundary validation without persistence.
- `packages/{types,schemas,api-client,domain,config}/package.json` — shared package ownership; apps already contain no cross-app imports.
- `apps/web`, `apps/mobile` — retain separate rendering and consume only the shared copy resource where appropriate.
- `sprint-status.yaml` — exact key `1-2-define-the-versioned-api-contract-and-module-boundaries`; preserve the pre-existing `last_updated` edit and Story 1.3 backlog.

## Tasks & Acceptance

**Execution:**
- [ ] Add versioned OpenAPI contract and generation/validation scripts; source shared response/request DTOs and Zod schemas from this contract.
- [ ] Add typed API client with validated response parsing and `/api/v1` base path.
- [ ] Mount versioned Express router; validate the health operation's untrusted query input and return a documented typed error on invalid input.
- [ ] Add API module boundary conventions and a small public command/query example with no repository/table cross-module access.
- [ ] Add shared French string resources consumable by both apps; do not share rendered components.
- [ ] Add workspace checks for app/package dependency direction and forbidden cross-module persistence imports.
- [ ] Synchronize Story 1.2 to review; leave Story 1.3 backlog.

**Acceptance Criteria:**
- Given a request or response crossing an app/API boundary, when it is represented in the workspace, then its DTO and validation contract have one versioned source and a typed client is derived or maintained from it.
- Given an untrusted API input, when it reaches a server boundary, then it is validated there and invalid data receives a contract-shaped error without entering application commands.
- Given the workspace and API modules, when dependency and import rules are checked, then apps depend only on shared packages, packages depend on no apps, UI apps do not import each other, and module collaboration uses public commands/queries rather than another module's tables or repositories.
- Given French-only Phase 1 interface copy, when web and mobile need the same wording, then both can consume centralized strings while retaining app-owned rendering.

## Implementation Notes

- Added `packages/types/openapi/cetem-qc-v1.yaml` as the canonical v1 contract and `openapi-typescript` generation into `packages/types/src/generated/api-v1.ts`; OpenAPI defines public path, operation, request, success response and error response shapes.
- Added shared Zod request/response/error schemas. Express mounts `/api/v1`, parses the health query before handling, and emits a French user-facing validation message with a stable English error code. No mutation or persistence path was added.
- Added a typed v1 client using the versioned base path and runtime response parsing; API errors are parsed against the shared error schema.
- Added a public health query module contract, but no feature/business module; module import checks prohibit direct repository/table/adapter access and package/app dependency inversion.
- Added `@cetem-qc/i18n` with French strings consumed by both starter apps; only strings are shared, while rendered UI remains app-owned.
- Updated workspace manifests and root lockfile. Story 1.3 remains backlog; no entities, migrations, database, authentication, feature workflows, synchronization, calculations, reports, or AI were added.
- Validation: `pnpm install`, `pnpm contracts:generate`, recursive workspace typecheck, `pnpm boundaries:check`, API TypeScript build, and `git diff --check` passed. In-process HTTP check returned 200 with `{status:ok,version:v1}` for valid input and 400 with the documented `VALIDATION_ERROR` schema for invalid `verbose` query input.
- Deferred: expand OpenAPI paths, DTOs, module commands/queries, and domain schemas with each owning feature story; add authentication and authorization only in Epic 2; persistence and transactions in Story 1.3.

### Review Findings (2026-09-27)

- [x] [Review][Patch] OpenAPI and runtime schemas disagree on the health contract [packages/types/openapi/cetem-qc-v1.yaml:19,37] — OpenAPI now specifies string enum values `"true" | "false"` and requires both response fields; Zod is statically constrained by generated operation/component types.
- [x] [Review][Patch] Workspace boundary validation omits peer and optional dependency edges [scripts/check-boundaries.ts:18] — all four dependency fields are included and covered by focused tests.
- [x] [Review][Patch] Boundary validation does not inspect cross-imports between web and mobile source files [scripts/check-boundaries.ts:129] — workspace source scanning detects direct app-source paths and aliases; regression tests cover both directions.
- [x] [Review][Patch] Health endpoint bypasses the public health query [apps/api/src/index.ts:26] — Express validates the query and passes it to `getHealth`.

### Review Triage Log

- medium — patch — OpenAPI's query type and runtime parser disagreed, allowing generated clients and server validation to describe different wire values; response `version` requiredness likewise differed. Resolved with string enum values, required response fields, generated type-linked Zod schema types, and tests covering OpenAPI representation, generated types, and runtime rejection cases.
- medium — patch — package/app coupling could enter through peer or optional dependencies and evade the dependency check. Dependency aggregation now covers all four dependency fields; focused regression test passes.
- medium — patch — apps could bypass manifest checks with direct web/mobile source imports. Checker now scans app source files and resolves relative app paths and package source aliases; bidirectional regression test passes.
- medium — patch — the health route returned a literal response without calling the module query. It now calls `getHealth` after boundary validation.

**Review fix verification (2026-09-27):** OpenAPI generation passed; focused schema tests 2/2; boundary tests 7/7; boundary checker passed; recursive workspace typechecks passed; API build passed; `git diff --check` passed. No findings deferred. Story remains `review` pending code review.

**Rejected**

- low — Verification Gap: Automated API route/client regression tests are absent. Story 1.2's explicit focused-test requirement concerns dependency and module boundaries; those tests pass, and the implementation notes record a successful in-process HTTP check. Adding route/client suites is not required to resolve the reviewed blockers.

### Review Findings (2026-09-27)

- [ ] [Review][Patch] Generated contract drift is not verified [packages/types/package.json:7] � The focused schema tests compile against checked-in generated types but do not prove those types match the OpenAPI source. A stale generated `verbose?: boolean` type would still compile; YAML regex checks and runtime parser tests could also pass. Add a check that regenerates and compares the generated artifact with the checked-in file.
- [ ] [Review][Patch] API error runtime schema is not constrained by the generated contract [packages/schemas/src/api/v1.ts:19] � `apiErrorSchema` is independently authored and is neither typed against `apiV1Components["schemas"]["ApiError"]` nor exercised by contract drift tests. OpenAPI error requiredness/properties can change while client error parsing remains stale.
- [ ] [Review][Patch] Mobile root entry imports bypass the web/mobile source boundary check [scripts/check-boundaries.ts:92] � Source scanning recognizes only `apps/mobile/src/`, while this workspace's mobile entry is `apps/mobile/App.tsx`. A direct import of web app source from that root entry is not examined.

#### Rejected

- [x] [Review] The typed health client cannot send `verbose` � Story 1.2 requires a typed client for the contract; the stated AC does not require every operation parameter to be exposed through a client convenience method, and no current caller requires verbose health checks.
- [x] [Review] The route does not validate its own health response � `getHealth` returns a statically typed literal response with no untrusted data or mutation; the existing shared client validates received responses.
- [x] [Review] JSON parse errors and duplicate `/api/v1` base paths are possible � These are caller input/transport usage edge cases outside the identified blocking criteria; there is no evidence of a current caller supplying a versioned URL or non-JSON response.
- [x] [Review] Boundary scanner omits `require()`, unresolved imports and unknown package edges in shared manifests � The current apps/package sources use ES imports and the checker covers all declared app/shared edges needed by the story; no bypass is present in the reviewed implementation.
- [x] [Review] Regex assertions do not parse every OpenAPI field � Broader schema-parsing coverage would be useful, but the user-requested verbose semantics, required health response fields, static generated-type linkage, and runtime rejection cases are covered; the concrete stale generated-artifact issue is separately recorded above.
