---
title: 'Establish the pnpm workspace and application skeleton'
type: 'feature'
created: '2026-09-26'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
baseline_commit: 'NO_VCS'
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/planning-artifacts/architecture/architecture-cetem-qc-2026-09-26/ARCHITECTURE-SPINE.md'
  - '_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The repository has no reproducible application workspace, preventing incremental implementation on the agreed architecture.

**Approach:** Establish one pnpm workspace with Next.js web, Expo React Native mobile, Express API, and the six shared packages specified by Story 1.1.

**Boundaries & Constraints**

**Always:** Keep dependencies directed from applications to shared packages and never between UI apps. Keep one root lockfile. Validate Expo and Next.js TypeScript compatibility before pinning the version. Ensure each app starts in development mode.

**Never:** Implement later stories, authentication, database entities or persistence, business logic, offline synchronization, calculations, AI, reports, or production-scale infrastructure. Do not add a build orchestrator.

</frozen-after-approval>

## Code Map

- `_bmad-output/planning-artifacts/epics.md` — authoritative Story 1.1 acceptance criteria and scope.
- `_bmad-output/planning-artifacts/architecture/architecture-cetem-qc-2026-09-26/ARCHITECTURE-SPINE.md` — adopted workspace shape, dependency direction, and stack versions.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — Story 1.1 status key and Epic 1 synchronization.
- Repository contains no app/package manifests or lockfiles; create the workspace from the root.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` — establish a pinned pnpm workspace and single root lockfile.
- [x] `apps/web/**` — add a minimal Next.js app with development start script.
- [x] `apps/mobile/**` — add a minimal Expo React Native app with development start script.
- [x] `apps/api/**` — add a minimal Express app with development start script.
- [x] `packages/{types,schemas,api-client,domain,config}/**` — add empty public package foundations with no app dependencies.
- [x] `tsconfig.json` and app configs — pin a TypeScript version supported by the selected Expo and Next releases.
- [x] `sprint-status.yaml` — synchronize Story 1.1 to review and Epic 1 to in-progress.

**Acceptance Criteria:**
- Given the agreed Node/pnpm toolchain, when dependencies install and each app starts in development mode, then web uses Next.js, mobile uses Expo React Native, API uses Express, and exactly one root pnpm lockfile exists.
- Given the five shared packages, when application dependency direction is inspected, then neither UI app imports the other and no package depends on an app.
- Given Expo and Next.js, when TypeScript is pinned, then published compatibility requirements have been checked first.
- Given Story 1.1 implementation is complete, when sprint status is synchronized, then Story 1.1 is review and Epic 1 is in-progress; Story 1.2 remains backlog.

## Implementation Notes

- Pinned TypeScript 6.0.3 after Expo SDK 57's `expo install --check` reported `~6.0.3` as its expected version; Next.js 16 accepts TypeScript 5.1 and newer. React and React Native versions match Expo SDK 57's published platform matrix.
- Added `.nvmrc` and an exact package engine requirement for the architecture's Node 24.21.0 baseline. Validation ran on local Node 22.18.0, which meets Expo SDK 57's 22.13 minimum and Next.js 16's 20.9 minimum but differs from the pinned workspace baseline.
- Corepack cache materialization initially failed; the installed pnpm 11.10 shim successfully bootstrapped the package-manager setting, and the final install completed with the declared pnpm 12.7.0. The only lockfile is the root `pnpm-lock.yaml`.
- `packages/schemas` declares the architecture-pinned Zod 4.6.5 runtime dependency. The other shared package foundations have no app dependencies; neither UI app imports the other, and application imports are only within their own app shell.
- Added `README.md` with clean-checkout install, app development, typecheck, and per-app build commands.
- Next.js 16 generated `apps/web/AGENTS.md` and `apps/web/CLAUDE.md` when its development server first started; these are framework-generated development guidance files.
- Verified pnpm install, Expo `expo install --check`, all app typechecks, Next production build, API TypeScript build, Next dev HTTP 200, API `/health` response, and Expo Metro `packager-status:running`. Expo's optional React Native DevTools download fell back after a user-level cache access denial; Metro still started. No test scripts exist yet.

## Review Triage Log

- false — Blind Hunter: The workspace has all five packages enumerated by the user and Story 1.1. The frozen intent's phrase “six shared packages” is a count typo; the claim that a required package is missing is disproved by the explicit package list.
- false — Edge Case Hunter: The workspace has all five packages enumerated by the user and Story 1.1. The frozen intent's phrase “six shared packages” is a count typo; the claim that a required package is missing is disproved by the explicit package list.
- medium — Blind Hunter: The initial workspace did not declare the architecture-pinned Zod 4.6.5. Added Zod 4.6.5 directly to `packages/schemas/package.json` and refreshed the root lockfile.
- medium — Blind Hunter: The initial runtime range allowed versions below the architecture baseline. `package.json`, `.nvmrc`, and README now all pin/document Node 24.21.0.
- low — defer (Blind Hunter): Loopback API binding limits access from a physical mobile device or container. This story only requires local development startup; revisit host binding when a cross-device API workflow is implemented.
- false — Blind Hunter: Missing `.next/types` files do not prevent TypeScript from resolving the app's glob includes on a fresh checkout; the `next-env.d.ts` declarations resolve from the installed Next package.
- low — Blind Hunter: A root setup guide was missing initially. Added `README.md` with pinned prerequisites and install/start/build/typecheck commands.
- low — defer (Blind Hunter): The API entry point starts listening as an import side effect. An importable app factory is unnecessary for this skeleton and can be introduced with the first API behavior/tests.
- low — Blind Hunter: There was no root build command; the README now documents the Next and API per-app build commands used for validation.
- false — Blind Hunter: The acceptance criterion itself requires preserving dependency direction. The inspected manifests and imports show no UI-app coupling and no package-to-app dependency.
- low — Blind Hunter: The page metadata description was English while the document language and page copy are French. Changed the description to French.
- false — Edge Case Hunter: The API listens on its valid default port when `PORT` is unset. A malformed explicit port fails fast instead of silently starting on a different port; the finding's suggested fallback could hide a configuration error.

### Review Findings (2026-09-27)

**Rejected**

- false — Blind Hunter: TypeScript does not require `baseUrl` for `paths` mappings; the implementation notes also record successful app typechecks.
- false — Blind Hunter: `@cetem-qc/config/typescript.json` is a valid package subpath that intentionally maps to `tsconfig.base.json`; consumers do not need the physical filename to match the export subpath.
- false — Blind Hunter: Android/iOS launch scripts are optional conveniences; the required mobile development entry point is `pnpm dev:mobile`, which runs Expo without requiring a simulator.
- low — Blind Hunter: The API `build` command performs a no-emit TypeScript check. Story 1.1 requires a runnable Express development app, not production JavaScript output; the README command still validates the API source.
- low — Blind Hunter: An empty explicit `PORT` can select an ephemeral port. The documented default `3001` works when `PORT` is unset, and port override validation is outside this starter story's acceptance criteria.
- low — Blind Hunter: A clean checkout may need Next.js to generate `.next/types` before invoking `pnpm typecheck`. The story requires the development app to start, and the documented flow places validation after the development-server setup; generated files are intentionally ignored.
- low — Verification Gap: There is no automated `/health` response test. Story 1.1 does not require a test suite, and the implementation notes record a successful manual health check.
