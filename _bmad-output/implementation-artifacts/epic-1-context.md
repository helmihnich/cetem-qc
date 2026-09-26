# Epic 1 Context: CETEM-QC PoV Engineering Foundation

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Establish a reproducible repository foundation so developers can run the web, mobile, and API applications and add features incrementally on the agreed Phase 1 stack. The foundation is a single deployable modular monolith with separate clients and shared contract/domain packages.

## Stories

- Story 1.1: Establish the pnpm workspace and application skeleton
- Story 1.2: Define the versioned API contract and module boundaries
- Story 1.3: Establish PostgreSQL migration and transaction foundations

## Requirements & Constraints

- One pnpm workspace and root lockfile; Next.js web, Expo React Native mobile, Express API.
- Shared packages are limited to types, schemas, API client, pure domain logic, and configuration.
- Applications may depend on shared packages; packages do not depend on applications; web and mobile remain separately rendered and do not import each other.
- Keep an Express modular monolith. Do not add an orchestrator or production-scale infrastructure without measured need.
- PostgreSQL is the authoritative server store when persistence is introduced; add migrations and transaction foundations only within the database story.

## Technical Decisions

- Stack baseline: Node.js 24.21.0 LTS, pnpm 12.7.0, Next.js 16.3.6, React 19.2.x, Expo 57.0.25, React Native 0.86.3, Express 5.2.1, PostgreSQL 18.6, and Zod 4.6.5.
- Pin TypeScript only after checking Expo and Next compatibility. Expo is the mobile default; choose its native-project workflow deliberately when native dependencies are needed.
- Preserve modular monolith boundaries: controllers call application commands; modules own state and expose public ports; adapters implement persistence and providers.
- One versioned API contract is the source for shared DTOs, appropriate Zod schemas, and a typed client. Validate untrusted API inputs at server boundaries.

## Cross-Story Dependencies

- Story 1.2 builds on the workspace and shared package boundaries from Story 1.1.
- Story 1.3 introduces PostgreSQL migrations and transactions; Story 1.1 must not preemptively model database entities.
