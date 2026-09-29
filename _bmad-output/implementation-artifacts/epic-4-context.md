# Epic 4 Context: Graphie Mobile Task Creation and Assignment

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Enable a Responsable to create Graphie Mobile tasks for eligible employees and manage the operational view of work assigned within the Responsable's own team. The API and PostgreSQL remain authoritative for task records, assignments, and access; this epic stops before employee task visibility or field work.

## Stories

- Story 4.1: Create an assigned Graphie Mobile task
- Story 4.2: Review the operational task list
- Story 4.3: Make assigned work visible in-app

## Requirements & Constraints

Task identifiers are stable and unique. A task records its creator and creation timestamp, and has an assignment to an eligible active Employé in the Responsable's own team. The Responsable task list exposes task ID, type, establishment, assignee, state, and last-update date. Every protected API request enforces role and scope on the server; denied requests do not disclose protected data. Graphie Mobile is executable; Graphie fixe is disabled and Scopie cannot be created. Keep French-only user-facing copy. Do not add email delivery, employee field work, offline synchronization, task workflow transitions, or requirements gated on DEP-01/02/03.

## Technical Decisions

Use the modular monolith and existing versioned OpenAPI contract as the source for generated TypeScript, Zod schemas, typed API client, and Express runtime. Task and assignment data are PostgreSQL-authoritative. Use production SQL predicates and existing PostgreSQL transaction/repository conventions; derive the Responsable's team from authenticated server state, never a client-supplied team ID. Preserve the task-to-assignment relationship. The web app uses its existing HttpOnly-cookie session bridge; all cookie-authenticated mutations use the shared same-origin guard. Read-only requests use no-store behavior. Keep clients and API aligned with `contracts:check`.

## UX & Interaction Patterns

Responsable web uses a compact task comparison table with ID, type, establishment, Employé, state, and last update. Follow the shared task-list, status-badge, loading-state, and empty-state patterns, using clear French copy. Keep loading, empty, and fetch-error conditions distinct. Only use lifecycle labels backed by the API. Do not invent filters, sorting, task actions, or assignment behavior. The employee mobile task-list surface belongs to Story 4.3.

## Cross-Story Dependencies

Story 4.2 builds on the task and assignment records created by Story 4.1. Story 4.3 is a separate Employé experience and is not part of this work.
