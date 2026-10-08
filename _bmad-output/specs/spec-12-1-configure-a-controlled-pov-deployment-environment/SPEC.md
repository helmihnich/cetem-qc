---
id: SPEC-12-1-configure-a-controlled-pov-deployment-environment
story: 12.1
status: approved
approved: 2026-10-08
baseline_commit: 8aba185
companions: []
sources:
  - .automation/task.md
  - _bmad-output/planning-artifacts/epics.md (Story 12.1)
  - _bmad-output/planning-artifacts/architecture/architecture-cetem-qc-2026-09-26/ARCHITECTURE-SPINE.md (AD-9, AD-11)
  - _bmad-output/implementation-artifacts/deferred-work.md (migration/runtime DB role item)
---

> **Canonical contract.** This SPEC is the complete contract for what to build, test and validate. Nothing is deployed by this story.

# Story 12.1 — Configure a controlled PoV deployment environment

## Why

**Pain.** The code runs only on a developer machine: the API binds to `127.0.0.1`, has no readiness probe, no container image, no runtime-config check, no env templates beyond AI/files, and no deployment or restore documentation. A PoV evaluator cannot stand up a protected environment (AD-11) without guessing.

**Story statement.** As a PoV operator, I want separate development and PoV/test configuration for the agreed application footprint, so that the end-to-end demonstration can run with protected dependencies.

**What this delivers.** Repository artifacts only: container and compose files for a local demo, env templates, a minimal runtime-config layer in the API (bind host, database URL resolution, HTTPS enforcement, readiness), and a French deployment guide for web on Vercel, API on Render, PostgreSQL on Neon. No deployment, no account, no paid service, no vendor lock-in.

**Traceability.** AD-9, AD-11, SEC-005, SEC-009, NFR-007.

## Capabilities

- **CAP-1** — Readiness and health probes
  - **intent:** An orchestrator or operator can tell « process alive » from « able to serve » without credentials.
  - **success:** `GET /api/v1/health` is unchanged (liveness, no database). New `GET /ready` (root path, public, no secrets, not part of the OpenAPI contract, no client consumes it) runs `SELECT 1` on the pool: 200 `{"status":"ready"}` or 503 `{"status":"unavailable"}`; body never carries error text, host, or connection string; a pool/DB failure is logged as event + fixed class only. `/ready` is registered before the session guard and is not subject to HTTPS enforcement.
- **CAP-2** — Runtime configuration for a hosted API
  - **intent:** The same code runs locally and behind a hosting platform, configured only by environment.
  - **success:** (a) `HOST` (default `127.0.0.1`; containers/compose set `0.0.0.0`) and `PORT` (default 3001) drive `listen`. (b) One resolver `resolveDatabaseUrl(env)` returns `DATABASE_URL`, else `NEON_DATABASE_URL`, else throws the existing « must be set » message (no value in message); used by the API pool, the migration pool and the CLI scripts (`bootstrap-responsable`, `reset-responsable-password`). (c) `TRUST_PROXY` (`true`/number, default off) is passed to Express `trust proxy`. (d) `FORCE_HTTPS=true` makes every request except `/ready` and `/api/v1/health` whose effective protocol (`req.protocol`, honoring trust proxy) is not `https` answer 308 redirect to the `https://` URL for GET/HEAD and 403 JSON error `HTTPS_REQUIRED` (French message) for other methods; unset/false changes nothing (local dev, tests). Unknown values of these variables fail at start-up with a message free of values.
- **CAP-3** — Container and compose footprint for a local demo
  - **intent:** One command starts web, API and PostgreSQL (plus optional malware scanner) for the demonstration.
  - **success:** `apps/api/Dockerfile` and `apps/web/Dockerfile` (Node 24.21.0, non-root user, pnpm pinned by `packageManager`, no secrets baked in, `.dockerignore` excludes `.env*`, `.data`, `node_modules`). `docker-compose.yml` at the root defines `postgres` (internal network only, no published port by default, named volume, healthcheck), `migrate` (one-shot `pnpm --filter @cetem-qc/api db:migrate`, API waits on its success), `api` (HOST=0.0.0.0, healthcheck on `/ready`, `FILE_STORAGE=local` on a named volume outside any served directory, `ANTIVIRUS=none`, `AI_PROVIDER` empty → mock), `web` (`CETEM_QC_API_URL=http://api:3001`), and a `clamav` service under profile `scan` (`ANTIVIRUS=clamav`, `CLAMAV_HOST=clamav`). All values come from `${VAR}` with a `deploy/env/compose.env.example` template; the compose file contains no password literal. The mobile app is not containerized: its `EXPO_PUBLIC_API_URL` is documented.
- **CAP-4** — Env templates separate development from PoV/test
  - **intent:** Every variable the code reads is discoverable and no secret is committed (SEC-009).
  - **success:** `.env.example` stays the development template and gains `HOST`, `PORT`, `DATABASE_URL`, `NEON_DATABASE_URL`, `TRUST_PROXY`, `FORCE_HTTPS`, `APP_ENV` documentation lines with empty values. `deploy/env/` holds `api.pov.env.example` (Render), `web.pov.env.example` (Vercel: `CETEM_QC_API_URL`), `mobile.pov.env.example` (`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_OFFLINE_AUTHORIZATION_WINDOW_DAYS`) and `compose.env.example`. In templates every secret-bearing key (`*PASSWORD*`, `*SECRET*`, `*KEY*`, `*TOKEN*`, `*DATABASE_URL*`) has an empty value; non-secret defaults (e.g. `HOST=0.0.0.0`, `FORCE_HTTPS=true`, `ANTIVIRUS=none`) are explicit. The web session cookie remains `secure` when `NODE_ENV=production`.
- **CAP-5** — French deployment guide with recovery
  - **intent:** An operator with no prior knowledge can prepare the PoV targets, migrate, verify, back up, restore and roll back.
  - **success:** `docs/deployment/guide-deploiement-pov.md` (French) covers: footprint and what is explicitly out (no microservices, Kubernetes, HA, multi-region, autoscaling, production without written approval); separate `local` / `pov` environments; Neon (private connection string through `NEON_DATABASE_URL`, server only; TLS `sslmode=require`; separate migration/owner role and least-privilege runtime role, closing the deferred-work item); Render (API web service, build/start/migrate commands, health path `/ready`, `HOST`, `TRUST_PROXY=true`, `FORCE_HTTPS=true`, persistent disk for `FILE_STORAGE_DIR`, secrets in the dashboard only); Vercel (web project, `CETEM_QC_API_URL` server-side only); mobile `EXPO_PUBLIC_API_URL` (HTTPS, no secret); object storage / scanner / AI / document generation as replaceable ports with the current adapters and how to select them (`FILE_STORAGE`, `ANTIVIRUS`, `AI_PROVIDER`), no vendor chosen; first Responsable provisioning through the operator CLI; structured logs (stdout) and correlation (Story 12.2 refines events); backup (Neon point-in-time/branch + scheduled `pg_dump -Fc` plus copy of the file volume), **restore procedure and a restore drill checklist**, migration rollback = restore-then-redeploy (migrations are forward-only); verification checklist (`/ready`, sign-in, one upload). No instruction requires an account to run tests or the compose demo.

## Constraints

- No deployment, account creation, credentials or paid service; all vendor names appear only in the guide as examples of targets already named by the Product Owner (Vercel, Render, Neon). Object storage, scanning, AI and document generation stay behind existing ports; **no new adapter or vendor SDK**.
- No change to OpenAPI, generated types, typed client or any contract (`/ready` is outside the contract); `contracts:check` passes. No database migration; no change to business behavior; defaults keep every existing test and local run unchanged (`HOST` 127.0.0.1, HTTPS enforcement off).
- Secrets only from environment at runtime; never in images, compose literals, templates or logs. Errors from config validation never print values or paths.
- `FORCE_HTTPS` is the application-level backstop for SEC-005; TLS termination itself belongs to the platform (Render/Vercel/Neon provide it). The guide states this and forbids exposing the API over plain HTTP.
- Boundaries: new code lives in `apps/api/src/config/` (env resolution) and the app wiring in `index.ts`; modules do not import it except the DB pool/migrate/scripts; `boundaries:check` passes. No gate script edited; no test deleted, skipped or weakened.
- All user-visible text French (error message of `HTTPS_REQUIRED` in `packages/i18n` or the API's existing French error style); documentation French; code identifiers English.

## Non-goals

- Actually deploying, creating Vercel/Render/Neon accounts or projects, DNS, certificates, or CI/CD pipelines.
- A concrete S3/Blob storage adapter, a hosted scanner, new AI or document providers.
- Kubernetes, Helm, HA, multi-region, autoscaling, a queue or worker; production environment.
- Structured diagnostic events and correlation IDs beyond what exists (Story 12.2); performance measurement (Story 12.9).
- Containerizing or building the mobile app; native build pipelines.
- Rotating, storing or generating secrets; a secrets manager.

## Success signal

Automated tests (no Docker or network required) prove: `resolveDatabaseUrl` precedence and failure without leaking values; `HOST`/`PORT`/`TRUST_PROXY`/`FORCE_HTTPS` parsing incl. start-up failure on invalid values; `/ready` returns 200 with a healthy pool stub and 503 with a failing one, with no error text in the body; `/api/v1/health` and `/ready` stay reachable over plain HTTP when `FORCE_HTTPS=true`; with `FORCE_HTTPS=true` a plaintext GET is redirected 308 to `https://`, a plaintext POST gets 403 `HTTPS_REQUIRED`, a request with `X-Forwarded-Proto: https` and trust proxy on passes, and the same request without trust proxy is still treated as plaintext; with the flag unset behavior is unchanged. A static test over the repository files proves: every `process.env.*` name read by `apps/api/src` (non-test) and the web app's `CETEM_QC_API_URL` is listed in `.env.example` or a `deploy/env` template; every secret-bearing key in every template has an empty value; `docker-compose.yml` contains no inline password/key literal, no published PostgreSQL port by default, a `migrate` service and `/ready` healthcheck; Dockerfiles run as non-root and copy no `.env*`; the guide exists and contains the headings for restore, rollback, backup, provisioning, and « hors périmètre » (no HA / Kubernetes / autoscaling / production sans approbation). Manual compose bring-up is documented but not part of the gates (no Docker in the pipeline).

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` and `git diff --check` pass.

## Confirmed decisions

Follow from the AC, AD-9/AD-11, the code and Product Owner rules; none is a CETEM business rule.

- **`/ready` outside the OpenAPI contract.** Operational probe, no client use; avoids regenerating contracts. Existing `/api/v1/health` stays the liveness probe.
- **`NEON_DATABASE_URL` is an alias read server-side** (PO rule), resolved in one place; `DATABASE_URL` wins so local Docker/test setups are unchanged.
- **TLS = platform termination + app-level `FORCE_HTTPS` backstop**, because SEC-005 requires plaintext be refused or redirected and the app cannot terminate TLS itself on the chosen hosts.
- **Object storage on Render = local adapter on a persistent disk for the PoV**; it is a replaceable port and no vendor is selected here (AC). Documented as a PoV limitation, not a production design.
- **Backups = provider point-in-time recovery + documented `pg_dump`/`pg_restore` drill**; migrations are forward-only, so rollback means restore then redeploy the previous build. No automatic backup job is built.
- **Database roles**: guide prescribes an owner role for `db:migrate` and a runtime role without DDL/TRIGGER/TRUNCATE rights (deferred-work item). The code needs no change because the migration command and API already take separate environment values.
- **Mobile is configured, not deployed**: `EXPO_PUBLIC_API_URL` only; no secrets (public by design).
- **Malware scanning in compose** is optional (`scan` profile); default `ANTIVIRUS=none` records « analyse antivirus non effectuée (PoV) » as per the PO rule; tests use `none`.

## Open Questions

None blocking. Device/browser matrix, scenarios and acceptance owner for performance targets remain Story 12.9.
