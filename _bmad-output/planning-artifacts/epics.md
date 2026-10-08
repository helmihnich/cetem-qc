---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-cetem-qc-2026-09-24/prd.md
  - _bmad-output/planning-artifacts/ux-designs/ux-cetem-qc-2026-09-25/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-cetem-qc-2026-09-25/EXPERIENCE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-cetem-qc-2026-09-25/DECISIONS.md
  - _bmad-output/planning-artifacts/architecture/architecture-cetem-qc-2026-09-26/ARCHITECTURE-SPINE.md
  - docs/product/graphie-calculation-rules-source-extraction.md
  - docs/product/
---

# CETEM-QC - Epic Breakdown

## Overview

Phase 1 Graphie Mobile PoV. This inventory and story breakdown derive from the finalized planning artifacts named above. It preserves open dependencies and does not authorize undocumented CETEM-BH rules.

## Requirements Inventory

### Functional Requirements

- FR-001: Responsable and Employé authenticate with role-appropriate access; deactivated accounts cannot log in.
- FR-002: Responsable sees own-team employee names, email and active state only.
- FR-003: Responsable creates an employee with first name, surname and unique valid email.
- FR-004: Temporary credential permits activation only; first login requires password replacement before task access.
- FR-005: Responsable activates/deactivates employees; deactivation prevents new login, assignment and authorized server work without deleting tasks/history.
- FR-006: Assignment choices are active employees in the Responsable's team, excluding the Responsable.
- FR-007: Responsable creates uniquely identified tasks with creator, creation date and initial draft state; employees cannot initiate unassigned work.
- FR-008: Graphie Mobile is executable; Graphie fixe is disabled and Scopie unavailable.
- FR-009: Establishment and service are free text; establishment is required; other mandatory-field rules require explicit decision or stronger source.
- FR-010: A task requires assignment to an active same-team employee and prohibits self-assignment.
- FR-011: Responsable task list shows ID, type, establishment, assignee, state and last update.
- FR-012: Responsable opens own-team tasks/results; accepted evidence, measurements, comments and calculations are read-only.
- FR-013: Responsable review of submitted evidence is logged and does not create an employee-work approval/rejection step.
- FR-014: Official report designation completes the software workflow; completed control/report are read-only for either conformity outcome; handwritten signing is not a gate.
- FR-015: Assigned tasks are visible in-app; real email notifications are out of Phase 1.
- FR-016: Employé sees only own assigned tasks and may have multiple active tasks.
- FR-017: Fixed, touch-adapted Graphie Mobile form follows the versioned project-defined PoV catalogue; paper layout need not be copied literally. Catalogue structure is resolved for PoV by Product Owner decision, not CETEM approval.
- FR-018: Capture catalogue-defined intervention/equipment/instrument metadata, qualitative checks, measurements and comments with source-supported or explicitly decided units/formats. Catalogue entries retain provenance; guidance does not establish business validation rules.
- FR-019: Employé saves/resumes/edits pre-submission drafts; explicit confirmed deletion; saved work survives normal restart.
- FR-020: All field sections of a synchronized task remain fillable/saveable offline; offline authentication follows OD-01.
- FR-021: Synchronize saved drafts and queued submissions after reconnect with per-item status; retry preserves data; pending submission is not submitted.
- FR-022: Conflict preserves local data, warns and pauses synchronization pending explicit reload/reconciliation; no silent overwrite or automatic field merge.
- FR-023: Server accepts only after blocking validation; records submitting actor/date and exposes accepted result to Responsable; preserve local data until acceptance.
- FR-024: Server acceptance makes measurements/comments immutable. Material correction uses a new independently recorded and linked audit; preserve original.
- FR-025: Calculate only explicitly defined CETEM formulas, preserving workbook dependencies, signed deviations and fixed divisors; no inferred inputs/rounding.
- FR-026: Individual tolerance verdict requires approved formula, threshold, boundary and comparison rule; no inferred verdict or automatic overall conformity.
- FR-027: Show measurements and only authorized calculated values/tolerances/verdicts understandably to both roles.
- FR-028: After submission, propose only factual deterministic insights from explicitly defined rules; retain source; same input/rule version yields same proposals.
- FR-029: Responsable selects/discards proposals, with actor/date/audit-version trace; zero retained insights is valid.
- FR-030: Responsable may add manual insight before summary generation, retaining text, author/date and optional justification; no general evidence attachments.
- FR-031: Responsable manages insights/summary before confirmation while accepted measurements/comments remain immutable; no employee-work approval.
- FR-032: AI drafts summary on Responsable request using authorized audit data and retained insights only; retain requester/date, actual input and model provenance. AI failure permits retry/manual entry.
- FR-033: Responsable edits and explicitly confirms summary; preserve AI draft if present and final text; manual-only summary follows same gate without fabricated AI provenance.
- FR-034: After confirmed summary and human machine decision, Responsable can upload manual PDF only; retain origin/metadata. Size and exact required fields are OD-04/DEP-03.
- FR-035: Generate Word or upload manual PDF; designate exactly one official report; no completion before summary confirmation, human decision and designation.
- FR-036: Authorized roles download correct official report from history, linked to task/audit.
- FR-038: After summary confirmation, Responsable explicitly decides Machine conforme or Machine non conforme; separate from individual verdict and summary confirmation.
- FR-040: Authorized read-only history shows completed evidence, insights, confirmed summary, human decision and report; preserve original on replacement.
- FR-041: Generated Word is printable with approved handwritten-signature zones; no electronic signature or required signed-scan upload; exact specification DEP-03.
- FR-042: Offline entry later synchronizes without loss/duplication; authorized calculations/individual feedback remain available offline; no offline AI or employee insight review.

### NonFunctional Requirements

- NFR-001: Saved offline drafts survive normal application closure/restart without network.
- NFR-002: Interrupted transfers resume/retry without duplication; acceptance produces one coherent submitted version.
- NFR-003: Server-backed interactions target <=3 seconds p95 (architecture PoV target); acceptance conditions remain OD-05/06.
- NFR-004: Local save/autosave targets <=1 second p95; device/scenario/measurement conditions remain OD-05/06.
- NFR-005: Word generation targets <=30 seconds p95; failure is recoverable; dataset/conditions remain OD-05/06.
- NFR-006: Browser/device compatibility acceptance remains subject to OD-05/06.
- NFR-007: Diagnose server/sync/report failures with correlation IDs; do not log passwords or sensitive payloads.
- NFR-008: Mobile form inputs/validation are readable and touch-operable without mandatory zoom; verification matrix is OD-05.

### Additional Requirements

**Derived data and traceability:** DR-001 stable unique IDs and valid links, including independent replacement identity; DR-002 associate approved formula/unit/tolerance/rounding rules and validate against approved cases; DR-003 preserve calculation precision; DR-004 validate invalid type/unit/range/required input against approved rules; DR-005 retain actor/date for submission, summary confirmation, conformity decision and official designation; DR-006 preserve tasks/submissions/reports after deactivation; DR-007/008 preserve insight provenance, proposals, selection/discard and summary inputs; DR-009 preserve AI draft (if any), confirmed summary, authors/dates, report origin/metadata and associations.

**Security:** SEC-001 named accounts/action attribution; SEC-002 server-side role checks; SEC-003 own-team/own-assignment authorization and no cross-scope disclosure; SEC-004 adaptive salted password hashing; SEC-005 TLS; SEC-006 deactivation/session expiry cannot authorize server work (OD-01 governs offline duration); SEC-007 secure local data and no silent deletion on logout/expiry; SEC-008 independent server validation/authorization with no mutation on rejection; SEC-009 secrets excluded from source/client; SEC-010 PDF safe handling/scanning gated by OD-04; SEC-011 security event logging without secrets; SEC-012 temporary credential invalidated after mandatory replacement. AI-control SEC-011: only authorized data/retained insights feed AI; preserve actual inputs, draft, final and model metadata; human confirmation/decision required.

**Architecture decisions (AD):** AD-1 pnpm workspace, root lockfile, apps/web Next.js, apps/mobile Expo React Native, apps/api Express, packages/types, schemas, api-client, domain, config; no build orchestrator without measured need. AD-2 dependency direction and module/port boundaries. AD-3 modular monolith; controlled first-Responsable provisioning; server authorization. AD-4 server-authoritative transitions; pending immutable local snapshot/outbox; idempotency and optimistic concurrency; no last-write-wins; typed lineage distinguishes rejected-submission correction, sync-conflict revision and Responsable-only replacement. AD-5 transactional encrypted mobile DB + durable outbox, preserve through failures/logout/expiry/upgrades; bounded retries/background opportunistic only. AD-6 PostgreSQL authoritative normalized workflow data, migrations/transactions; validated versioned JSONB only for evolving measurement payloads. AD-7 source-derived calculations and version provenance; unresolved rule-evaluation unavailable until approved. AD-8 summary/conformity/report ordered gates, versions/freshness bindings and invalidation on summary reopen. AD-9 private object storage, PDF validation/scanning, provider ports for AI/storage/scanner/document generation. AD-10 one versioned API contract, boundary validation and centralized French UX strings. AD-11 one PoV deployment footprint with TLS, secret injection, least privilege, health/readiness, backups/restore, correlation logging; no production-scale topology.

**Resolved UX decisions carried forward:** OD-01 configurable PoV offline access (up to 7 days since successful server authentication; logout ends access; preserve inaccessible local work and reauthorize before use/sync); OD-02a pending submission is locked, retryable and not accepted, with explicit correction drafts for validation rejection; OD-02b conflict has two explicit resolution paths and no merge/overwrite; OD-03 typed replacement is Responsable-only after acceptance and deactivation handling is state-specific without automatic reassignment; OD-04 PDF-only, configurable 20 MB limit, structural validation and malware scan before Ready; OD-05 responsive Android/iOS phone/tablet support; OD-06 PoV performance targets are fixed; OD-07 email deferred; OD-08 controlled bootstrap; OD-09 one-time temporary credential display/manual handover; OD-10 summary reopening before designation invalidates current conformity and dependent report candidates, requiring fresh confirmation/decision and current report. Preserve these; do not reopen absent direct contradiction.

**Remaining validation/implementation details:** exact supported OS/device/browser matrix, performance test conditions and formal acceptance owner remain to be confirmed for acceptance; they do not alter the resolved product workflow. PDF baseline and maximum are resolved in UX/architecture even though the older PRD OD-04 row is stale. The finalized UX decision register and architecture spine carry the later resolution.

**External gates:** DEP-01 form structure is resolved for Story 5.4 by the 2026-10-01 Product Owner decision; the versioned project-defined catalogue is not CETEM-approved. DEP-01R retains unresolved business rules and edge semantics; DEP-02 retains CETEM-approved expected calculation/verdict fixtures; DEP-03 retains approved Word/report content, provenance and signature fields. Workbook extraction is formula evidence, not CETEM approval. Keep source-derived regression fixtures separate from approved acceptance fixtures. Never invent thresholds, rounding, N.A., missing-value behavior, insight rules or report fields.

**Implementation/platform:** French-only user-facing copy. Employé app supports Android/iOS phones and tablets; platform presentation/navigation/storage stays platform-owned. Server-side authorization is mandatory. Provider interfaces remain replaceable for AI, private object storage, malware scanning and document generation. PoV only: no microservices/Kubernetes/multi-region/HA/autoscaling without direct Phase 1 requirement.

### UX Design Requirements

- UX-DR1: Implement DESIGN.md palette, typography, spacing/radius tokens and calm operational visual system in shared tokens, without asserting unverified contrast/accessibility compliance.
- UX-DR2: Implement the 19 named component patterns consistently: app-shell, primary/secondary/destructive buttons, form-field, task-list, status-badge, sync-status, audit-sections, measurement-result, insight-item, summary-editor, conformity-decision, report-panel, history-record, alert-message, confirmation-dialog, loading-state and empty-state.
- UX-DR3: Keep Responsable web and Employé React Native experiences separately rendered; mobile layouts cover Android/iOS phones and tablets with representative validation across phone/tablet form factors.
- UX-DR4: Centralize French-only Phase 1 interface copy and approved lifecycle labels; include distinct local save, offline, draft sync, submission pending, server accepted, acceptance blocked, conflict and retry states.
- UX-DR5: Pending submission becomes locally read-only on explicit request and remains distinct from server acceptance; non-conflict validation rejection creates a linked correction draft; sync conflict uses explicit resolution and never merges/overwrites automatically.
- UX-DR6: Show only authorized measurements/calculations/verdicts and provenance; keep source-derived regression evidence distinct from CETEM-approved verdict fixtures; never imply unapproved tolerances or overall automatic conformity.
- UX-DR7: Show Responsable insight proposal provenance and allow zero retained insights; separate manual insight authorship from AI summary assistance.
- UX-DR8: Provide AI/manual summary editing and explicit confirmation; AI failure supports manual completion; resolved OD-10 reopening makes summary unconfirmed, invalidates current conformity and marks dependent report candidates outdated.
- UX-DR9: Keep human Machine conforme / Machine non conforme choice explicit and separate, available only after summary confirmation; both outcomes can complete.
- UX-DR10: Report UI separates Word generation and PDF upload, shows validation/scanning/readiness, permits candidate replacement only before designation, and requires explicit official designation with current-input freshness checks. Exact content remains DEP-03.
- UX-DR11: History is authorized/read-only and shows traceable task/audit, report and typed replacement relationships; only Responsable can initiate post-acceptance replacement.
- UX-DR12: Meet readable touch input and visible labels; color never carries state alone; actionable errors have persistent/inline text, keyboard/focus behavior validated per platform; do not claim overall WCAG conformance without evidence.
- UX-DR13: Implement loading/busy/error/empty states, retry affordances and safe confirmations; never imply success before durable save, server acceptance, scan completion or official designation.
- UX-DR14: Use the four approved mockup scopes only; exact breakpoints, pale semantic fills, dimensions and platform sizing remain design validation details, not new approved requirements.

### FR Coverage Map

This map reflects the user-approved epic structure.

| Requirement | Epic | Scope note |
|---|---|---|
| FR-001, FR-004 | Epic 2 | Authentication, activation credential and first-login password change |
| FR-002, FR-003, FR-005 | Epic 3 | Employé account creation/credential handover, own-team listing and resolved deactivation behavior |
| FR-006–FR-011, FR-015 | Epic 4 | Eligible assignment, task creation/list and in-app visibility |
| FR-016–FR-020, FR-042 | Epic 5 | Mobile access, approved form capture, saved/offline field work |
| FR-025, FR-026, FR-027 | Epic 6 | Formula calculations, permitted individual verdicts and presentation; DEP-01R/02 gates apply |
| FR-021, FR-023, FR-024 | Epic 7 | Durable sync, server acceptance, immutable evidence and traceability |
| FR-022, FR-024, FR-005 | Epic 8 | Conflict/correction/replacement/deactivation recovery; distinct typed flows |
| FR-012, FR-013, FR-027–FR-031 | Epic 9 | Responsable evidence review and deterministic/manual insight handling |
| FR-032, FR-033, FR-038 | Epic 10 | AI/manual summary, explicit confirmation, human conformity decision and reopening |
| FR-014, FR-034–FR-036, FR-040, FR-041 | Epic 11 | Word/PDF paths, official designation and authorized history; DEP-03 content gate |
| No additional FR | Epic 1 and Epic 12 | Foundation and PoV readiness; security, observability and traceability are implemented within relevant feature stories and verified cross-cutting here |

FR-037 and FR-039 are absent from the authoritative PRD and intentionally remain unused. Every listed FR is mapped; FR-024 and FR-005 appear in more than one epic only where the distinct immutable-evidence/recovery outcomes are delivered.

## Epic List

Twelve epics group the requested implementation sequence into complete user outcomes. Technical constraints (security, traceability, French copy, platform support and provider boundaries) are carried by the feature stories and foundation/readiness stories rather than isolated into architecture-layer epics.

### Epic 1: CETEM-QC PoV Engineering Foundation
Developers can work in a reproducible repository and run the first integrated PoV slice on the approved stack. Establish pnpm workspace, Next.js, Expo, Express modular monolith, shared contracts and PostgreSQL migrations without production-scale infrastructure. **Requirements:** AD-1–AD-3, AD-6, AD-10; baseline NFRs and SEC constraints.

### Epic 2: Secure Access and Initial Responsable Provisioning
The PoV starts with a controlled bootstrap of the first Responsable; users authenticate safely and receive role-appropriate session/access behavior. Temporary credentials used for account activation follow the mandatory first-login password-change lifecycle. **FRs:** FR-001, FR-004. **Ownership:** controlled bootstrap of the first Responsable; authentication; temporary credential authentication lifecycle; mandatory first-login password change; session/access behavior. **Excludes:** creation of Employé accounts and their one-time credential handover (Epic 3). **Dependencies:** OD-08/09 resolved; bootstrap remains controlled operations, not an app admin surface.

### Epic 3: Responsable Team and Employé Account Management
Responsable can create and list Employé accounts in the Responsable's team, hand over each generated one-time temporary credential manually, and activate/deactivate employees while preserving their existing work and history. **FRs:** FR-002, FR-003, FR-005. **Ownership:** Employé account creation under FR-003; generation/display of the Employé one-time temporary credential for manual handover under OD-09; employee listing; activation/deactivation and team management. **Excludes:** controlled bootstrap of the first Responsable and shared authentication/session behavior (Epic 2). Employé account creation is owned here only; it is not duplicated in Epic 2.

### Epic 4: Graphie Mobile Task Creation and Assignment
Responsable can create a uniquely identified Graphie Mobile task and assign it only to an eligible active employee in the same team; employees can see assigned work in-app. **FRs:** FR-006–FR-011, FR-015.

### Epic 5: Employé Mobile Field Work
Employé can open authorized assignments on Android/iOS phones and tablets, capture the approved Graphie Mobile form, save/resume drafts securely, and continue authorized work offline. **FRs:** FR-016–FR-020, FR-042. **Dependency:** Story 5.4 form structure is no longer blocked by the missing CETEM catalogue (Product Owner decision 2026-10-01); DEP-01R still gates unresolved business rules where applicable.

### Epic 6: Traceable Calculations and Individual Results
Employé and Responsable can see source-faithful calculations and only those individual tolerance results backed by approved CETEM rules. **FRs:** FR-025–FR-027. **Dependencies:** DEP-01R blocks unresolved rules; DEP-02 blocks CETEM acceptance of calculation/verdict behavior. Source-derived regression fixtures remain separately labeled from approved acceptance fixtures.

### Epic 7: Reliable Synchronization and Server-Accepted Submission
Saved drafts and explicit submission requests survive interruption and reach one authoritative accepted version; local save, synchronized draft, pending submission and server acceptance remain distinct. **FRs:** FR-021, FR-023, FR-024. **Dependencies:** confirmed OD-01/02 policies; rule-dependent submission validation remains partially blocked by DEP-01/02.

### Epic 8: Conflict, Correction and Replacement Recovery
Employé resolves sync conflicts or non-conflict validation rejection through their distinct flows; Responsable creates post-acceptance replacements and handles deactivated-employee tasks without losing attribution or history. **FRs:** FR-005, FR-022, FR-024, with history linkage under FR-040. **Dependencies:** OD-02/03 resolved; recovery must use distinct lineage types and never mutate accepted evidence.

### Epic 9: Responsable Audit Review and Insights
Responsable reviews accepted evidence read-only, sees authorized results and manages deterministic proposals/manual insights with provenance; zero retained insights remains valid. **FRs:** FR-012, FR-013, FR-027–FR-031. **Dependency:** deterministic rule proposals are blocked until the applicable DEP-01R insight rules are decided.

### Epic 10: Confirmed Summary and Human Conformity Decision
Responsable completes an AI-assisted or manual summary, explicitly confirms it, then makes a separate human Machine conforme / Machine non conforme decision. AI failure never blocks completion; reopening follows resolved OD-10 invalidation rules. **FRs:** FR-032, FR-033, FR-038.

### Epic 11: Official Reports and Authorized History
Responsable generates/inspects Word or uploads/inspects a manual PDF, explicitly designates exactly one current report official, and authorized users can view/download completed history. **FRs:** FR-014, FR-034–FR-036, FR-040, FR-041. **Dependency:** DEP-03 blocks final template/content/signature/provenance acceptance; resolved PDF validation baseline applies.

### Epic 12: PoV Environment, Verification and Acceptance Readiness
The team can deploy and operate the controlled PoV environment, diagnose failures, verify cross-cutting requirements, and support end-to-end acceptance demonstrations. This epic verifies that security, observability and traceability implemented in the relevant feature stories work together; it does not defer their implementation. **Requirements:** NFR-001–NFR-008, SEC-001–SEC-012, DR-001–DR-009, UX-DR1–UX-DR14 and AD-11, with feature-specific FRs verified in their end-to-end journeys. No production availability or scale commitments are added. Acceptance claims requiring DEP-01/02/03 or the remaining device/test matrix stay explicitly blocked.

## Epic 1: CETEM-QC PoV Engineering Foundation

### Story 1.1: Establish the pnpm workspace and application skeleton

As a developer,
I want a reproducible workspace containing the web, mobile and API applications,
So that Phase 1 features can be delivered incrementally on the agreed architecture.

**Acceptance Criteria:**

**Given** a clean checkout and the agreed Node/pnpm toolchain
**When** the workspace is installed and each app is started in its development mode
**Then** `apps/web` uses Next.js, `apps/mobile` uses Expo React Native, `apps/api` uses Express, and the workspace has one root lockfile
**And** shared packages are limited to types, schemas, API client, pure domain logic and config; neither UI app imports the other
**And** the selected TypeScript version is pinned only after Expo/Next compatibility is checked; no Nx/Turborepo/Bazel or production-scale infrastructure is introduced.

**Traceability:** AD-1, AD-2.

### Story 1.2: Define the versioned API contract and module boundaries

As a developer,
I want web, mobile and API commands to consume one validated contract,
So that clients remain compatible while modules retain clear ownership.

**Acceptance Criteria:**

**Given** a client request or response crosses an app/API boundary
**When** it is represented in the workspace
**Then** its DTO and validation contract have one versioned source and a typed client is derived or maintained from it
**And** untrusted API inputs are validated at server boundaries; apps depend on shared packages, packages do not depend on apps, and modules use public commands/queries rather than another module's tables or repositories
**And** French user-facing strings can be centralized without sharing rendered web/mobile UI.

**Traceability:** AD-2, AD-3, AD-10, UX-DR3, UX-DR4.

### Story 1.3: Establish PostgreSQL migration and transaction foundations

As a developer,
I want database changes to be explicit and transactional,
So that authoritative workflow data remains consistent as features arrive.

**Acceptance Criteria:**

**Given** a feature needs persistent server state
**When** its first entity is introduced
**Then** it adds only the migration and schema needed by that feature, using PostgreSQL as the authoritative store
**And** workflow relationships use normalized relational ownership; evolving measurement payloads use validated, versioned JSONB rather than an unvalidated catch-all
**And** multi-record authoritative commands can use transactions, explicit revision tokens and foreign-key integrity; deployed environments do not perform runtime schema auto-sync.

**Traceability:** AD-6; DR-001–DR-004.

## Epic 2: Secure Access and Initial Responsable Provisioning

### Story 2.1: Bootstrap the first Responsable through a controlled process

As a PoV operator,
I want the first Responsable provisioned through a controlled deployment process,
So that the demonstration can start without public registration or an administration surface.

**Acceptance Criteria:**

**Given** a fresh PoV environment
**When** an authorized operator provisions the first Responsable
**Then** the account is created through a controlled out-of-band process with a temporary credential and forced first-login password change
**And** no public signup, bootstrap API endpoint, application Administrator role, role selector or general Responsable-management UI is available
**And** the credential is not committed to source control or written to application logs.

**Traceability:** AD-3, AD-11, SEC-001, SEC-009, SEC-012, OD-08.

### Story 2.2: Authenticate users and enforce role access on the server

As a Responsable or Employé,
I want to sign in with my named account and reach only my role space,
So that my work and team information remain protected.

**Acceptance Criteria:**

**Given** valid, invalid, or deactivated account credentials
**When** a user attempts authentication
**Then** valid active credentials establish the user's role and invalid credentials fail without identifying which credential was wrong; deactivated accounts cannot sign in
**And** every protected server operation enforces role, own-team and own-assignment authorization regardless of client UI, and denied cross-scope requests disclose no protected resource data
**And** authenticated traffic uses TLS; password storage uses recognized adaptive salted hashing and never stores/logs plaintext or recoverable passwords
**And** all user-facing authentication, validation and session copy is French.

**Traceability:** FR-001, SEC-001–SEC-005, SEC-011 (security events), AD-3, AD-10, UX-DR4.

### Story 2.3: Enforce temporary-credential activation and session policy

As a newly provisioned user,
I want to replace my temporary credential before using tasks,
So that temporary access cannot become a reusable operational password.

**Acceptance Criteria:**

**Given** an account whose temporary credential has been authenticated
**When** the user has not yet set a new password
**Then** only the password-change action is available and task access is denied
**And** successful password replacement invalidates the temporary credential and records the activation outcome without logging the secret
**And** server session expiry or known deactivation cannot authorize future server operations; offline access enforcement follows the resolved OD-01 mobile policy and does not silently delete local drafts.

**Traceability:** FR-004, SEC-006, SEC-007, SEC-012, OD-01.

### Story 2.4: Reset a forgotten password through the Responsable (no email)

As a Responsable, and as a PoV operator,
I want to reset a forgotten password of an Employé in my team, or of a Responsable from the server,
So that a locked-out user regains access through a one-time temporary credential without any email server.

**Acceptance Criteria:**

**Given** an active Employé of the Responsable's own team, before or after activation
**When** the Responsable selects « Réinitialiser le mot de passe » and confirms
**Then** a new temporary credential is shown once through the Story 3.2 hand-over dialog, the password change is forced at next login (Story 2.3 flow), and all of the Employé's sessions are revoked
**And** the server refuses an Employé caller, an activation-only session, another team's or unknown account (404, no disclosure) and a deactivated Employé (409), with no mutation
**And** an operator-only CLI (`pnpm --filter @cetem-qc/api reset:responsable-password`) does the same for a Responsable account and is documented
**And** the web login shows « Mot de passe oublié ? Contactez votre administrateur. », the mobile login « Mot de passe oublié ? Contactez votre Responsable. »
**And** every reset is audited (who, whom, channel, when) and logged without ever containing the credential.

**Traceability:** spec `_bmad-output/specs/spec-2-4-reset-forgotten-password-through-responsable/SPEC.md`; FR-004, SEC-001, SEC-002, SEC-003, SEC-004, SEC-011, SEC-012, OD-07, OD-08, OD-09.

## Epic 3: Responsable Team and Employé Account Management

### Story 3.1: View own-team employees

As a Responsable,
I want to see employees in my team and their account status,
So that I can manage eligible staff without exposing another team's roster.

**Acceptance Criteria:**

**Given** employees belong to this or another Responsable's team
**When** the Responsable opens the team list
**Then** only own-team employees are shown with first name, surname, email and active/inactive status
**And** the server enforces the same scope for direct API requests and returns no other-team employee data
**And** the web surface uses French labels and the approved calm visual tokens.

**Traceability:** FR-002, SEC-002, SEC-003, UX-DR1, UX-DR2 (app-shell, form-field, button patterns), UX-DR4.

### Story 3.2: Create an Employé account and hand over a one-time credential

As a Responsable,
I want to create an Employé account and receive its temporary credential once,
So that I can hand it over manually and the employee can activate the account.

**Acceptance Criteria:**

**Given** the Responsable is authorized for the team and submits first name, surname and a valid email
**When** the email is unique and the account is created
**Then** the employee is linked to that team and the temporary credential is displayed on a dedicated one-time screen with copy and saved/shared acknowledgement
**And** the credential is never shown again in profile/history/logs; a lost pre-activation credential can be explicitly regenerated, invalidating the previous one and repeating the one-time display
**And** handover is manual/out of band; no email/SMS delivery or tracking is implemented, and Epic 2 owns authentication/password-change enforcement rather than account creation.

**Traceability:** FR-003, FR-004, SEC-001, SEC-004, SEC-009, SEC-012, OD-09, UX-DR2 (button-secondary, alert-message), UX-DR4.

### Story 3.3: Activate or deactivate an Employé without deleting history

As a Responsable,
I want to change an employee's active status,
So that access and new assignments reflect current team membership while existing records remain preserved.

**Acceptance Criteria:**

**Given** an employee in the Responsable's team
**When** the Responsable deactivates the account
**Then** future login, assignment and authorized server operations/synchronization by that employee are denied
**And** tasks, audits, submissions and reports remain stored and visible to authorized Responsable users; deactivation does not automatically reassign unfinished work
**And** activation restores eligibility only after server-side status is active; protected changes are attributed and security events are logged without secrets.

**Traceability:** FR-005, DR-006, SEC-002, SEC-003, SEC-006, SEC-011 (security events), OD-03, UX-DR2 (status-badge, alert-message).

## Epic 4: Graphie Mobile Task Creation and Assignment

### Story 4.1: Create an assigned Graphie Mobile task

As a Responsable,
I want to create Graphie Mobile work for an eligible employee,
So that field control begins from an authorized assignment.

**Acceptance Criteria:**

**Given** an active employee in the Responsable's own team
**When** the Responsable creates a task with required establishment, free-text service, Graphie Mobile type and assignee
**Then** the server creates one uniquely identified task with creator, creation timestamp and initial draft state
**And** assignment to an inactive, other-team or self account is refused server-side without mutation; establishment is required, while other field requiredness waits for DEP-01
**And** Graphie fixe is visible but disabled and Scopie cannot be created.

**Traceability:** FR-006–FR-010, DR-001, SEC-002, SEC-003, SEC-008, AD-3.

### Story 4.2: Review the operational task list

As a Responsable,
I want to see the tasks owned by my team,
So that I can identify assignee, type and current work state.

**Acceptance Criteria:**

**Given** tasks exist for this and other teams
**When** the Responsable opens the task list
**Then** only authorized own-team tasks appear with task ID, type, establishment, assignee, state and last-update date
**And** task rows and empty states use the approved French language and component patterns
**And** service requests for another team's tasks are denied without disclosing those tasks.

**Traceability:** FR-011, SEC-002, SEC-003, UX-DR2 (task-list, status-badge, empty-state), UX-DR4, UX-DR13.

### Story 4.3: Make assigned work visible in-app

As an Employé,
I want to see tasks assigned to me in the mobile app,
So that I can begin authorized work without relying on email.

**Acceptance Criteria:**

**Given** tasks assigned to this employee and tasks assigned to others
**When** the employee opens Mes tâches
**Then** only their authorized assignments are listed in French and multiple active tasks can be opened
**And** a task appears through in-app visibility without claiming that an email was sent
**And** the API enforces assignment scope for direct task access.

**Traceability:** FR-015, FR-016, SEC-002, SEC-003, UX-DR2 (app-shell, task-list, empty-state), UX-DR3, UX-DR4.

## Epic 5: Employé Mobile Field Work

### Story 5.1: Open assigned work across supported phone and tablet form factors

As an Employé,
I want to open my assigned task on an Android or iOS phone or tablet,
So that I can work on the field device available to me.

**Acceptance Criteria:**

**Given** an authenticated employee with one or more assigned tasks
**When** they open a task on Android/iOS phone or tablet layouts
**Then** the responsive Expo experience preserves the same task behavior and authorization across platforms
**And** phone content reflows vertically and tablet space can present useful grouped context without requiring hover, mouse or rotation
**And** representative Android phone/tablet and iPhone/iPad form factors are included in validation; exact OS/device versions remain an acceptance-matrix item.

**Traceability:** FR-016, UX-DR2 (app-shell), UX-DR3, UX-DR12, OD-05.

### Story 5.2: Protect local drafts and apply the resolved offline access window

As an Employé,
I want locally stored work protected and accessible only while my offline authorization is valid,
So that interruptions do not expose or destroy field evidence.

**Acceptance Criteria:**

**Given** the user has successfully authenticated online and a draft is stored on the device
**When** the device is offline within seven days of that authentication
**Then** the user can access authorized local work using platform secure storage/encryption mechanisms
**And** explicit logout or expiry blocks local access until successful online re-authentication; app/device restart and transient network loss do not reset the window
**And** expiry, logout or known deactivation preserves encrypted local data without exposing it to other apps or silently deleting it; data remains inaccessible until authorization/recovery permits access.

**Traceability:** FR-020, SEC-006, SEC-007, AD-5, OD-01.

### Story 5.3: Save, resume and explicitly delete a local draft

As an Employé,
I want edits saved locally and drafts resumable after restart,
So that I can continue field work without losing confirmed local changes.

**Acceptance Criteria:**

**Given** an editable pre-submission draft and a working local datastore
**When** meaningful changes occur, the user navigates sections or selects Enregistrer
**Then** autosave and explicit save persist transactionally and acknowledge only after durable local commit
**And** latest saved work survives normal app/device process restart without network; a failed save retains the last successful version and clearly reports that newer edits are not saved
**And** explicit draft deletion requires confirmation; pending submission snapshots cannot be deleted through the draft-delete action.

**Traceability:** FR-019, NFR-001, NFR-004, AD-5, UX-DR2 (button-primary, button-destructive, confirmation-dialog, loading-state), UX-DR4, UX-DR13.

### Story 5.4: Capture the project-defined PoV Graphie Mobile form structure

As an Employé,
I want a fixed control form organized into understandable test sections,
So that I can enter the field evidence in a consistent order.

**Acceptance Criteria:**

**Given** the approved PoV Graphie Mobile catalogue (versioned and configuration-driven) is available
**When** the employee opens the Graphie Mobile form
**Then** the form captures the project-defined intervention, equipment, measuring-instrument, qualitative-check, measurement and comment fields grouped by the versioned PoV catalogue
**And** fields derived from the CETEM workbook preserve their documented source meaning and do not imply CETEM approval of the source extraction
**And** externally derived generic QC fields are explicitly treated as project-defined PoV catalogue items rather than CETEM-approved requirements
**And** labels, units, formats and validation behavior match the versioned PoV catalogue, with each field/rule's source or decision provenance traceable as `CETEM_WORKBOOK`, `IAEA_GUIDANCE`, `AAPM_GUIDANCE` or `PROJECT_POV_DECISION`
**And** unsupported tolerance, rounding, N.A., blank/zero, mandatory, range or conformity rules are not invented
**And** all user-facing labels, section names, help and validation messages are French; controls remain touch-operable and state is never conveyed by color alone
**And** entered data uses Story 5.3's durable local draft lifecycle.

**Traceability:** FR-017, FR-018, DR-002, DR-004, UX-DR2 (form-field, audit-sections), UX-DR4, UX-DR6, UX-DR12. **Dependency:** DEP-01 form-structure portion resolved for PoV by Product Owner decision (2026-10-01); unresolved business rules remain separately tracked and do not block catalogue-driven form structure.

### Story 5.5: Continue editing a synchronized task offline

As an Employé,
I want to enter and save field data when connectivity is unavailable,
So that a network interruption does not stop the control.

**Acceptance Criteria:**

**Given** an authorized task was previously synchronized and the device is offline
**When** the employee edits any supported form section
**Then** local entry, save, resume and navigation remain available without a network request
**And** connectivity, local persistence and server synchronization are shown as separate French statuses; no local state is presented as server accepted
**And** only calculations or individual feedback allowed by the confirmed rules are shown; offline AI and employee insight review are not introduced.

**Traceability:** FR-020, FR-042, NFR-001, UX-DR3–UX-DR6.

### Story 5.6: Align the Graphie Mobile form with the official CETEM paper form

As an Employé,
I want the Graphie Mobile form to follow the official CETEM paper form section by section,
So that I enter the same raw readings I record on paper and later calculations have real inputs.

**Acceptance Criteria:**

**Given** the paper form « Rapport de Contrôle de Qualité d'un Appareil Mobile de Radiographie »
**When** the employee opens the Graphie Mobile form
**Then** the form captures the header, equipment and control-instrument identification, N.A/Oui/Non visual and mechanical checks, raw-reading tables for voltage accuracy, voltage repeatability (Kerma entered once), output linearity and light-field correspondence, per-test and general comments, and « Contrôle effectué par »
**And** catalogue `2.0.0` / schema `3` replaces `1.0.0` / `2`; v1 drafts are not migrated and keep failing safely with the existing compatibility notice
**And** values stay strings; no calculation, tolerance, « concluant » verdict, conclusion or approval field is added.

**Traceability:** spec `_bmad-output/specs/spec-5-6-align-graphie-mobile-form-with-cetem-paper-form/SPEC.md`; paper form photos `docs/product/source/formulaire-cetem/`. **Unblocks:** Story 6.3 (together with the calculation rule-set v2 story).

## Epic 6: Traceable Calculations and Individual Results

### Story 6.1: Implement explicitly defined source-workbook calculations

As an Employé,
I want derived numerical values calculated from the confirmed workbook relationships,
So that the field form reproduces CETEM BH's supplied calculation evidence.

**Acceptance Criteria:**

**Given** the inputs required by an explicitly defined source formula are present
**When** the calculation engine evaluates them
**Then** it preserves signed percentage deviations, fixed divisors, referenced readings and the distinction between normalized Kerma/mAs reproducibility and raw-Kerma repeatability
**And** it preserves the explicit 0.49 linearity factor and formula wrapper, and does not infer MIN/MAX extrema, mAs, kVmax, K2, baseline values, rounding or special-value handling
**And** missing/zero/invalid inputs whose behavior is undefined by CETEM remain unavailable/blocked rather than mapped to zero, N.A. or a pass.

**Traceability:** FR-025, DR-002, DR-003, AD-7. **Dependency:** DEP-01R for unspecified rules; source extraction authorizes only documented formulas.

### Story 6.2: Share versioned calculation logic between mobile and server

As a Responsable,
I want submitted calculations reproducible by the authoritative server,
So that offline results and accepted results use the same rule version.

**Acceptance Criteria:**

**Given** a mobile draft contains formula inputs and rule/schema version metadata
**When** a calculation is shown offline and later checked by the server
**Then** both invoke the same pure versioned calculation implementation for all enabled formulas
**And** formula provenance, input precision and version are retained with results; display-rounded values are not reused as calculation inputs unless an approved rule requires it
**And** server acceptance does not silently substitute a different rule version or last-write-wins value.

**Traceability:** FR-025, FR-042, DR-002, DR-003, AD-2, AD-6, AD-7.

### Story 6.3: Display authorized calculation results in the Employé form

As an Employé,
I want measured and derived values presented with their rule status in the field form,
So that I can distinguish a number from a validated conformity result while working.

**Acceptance Criteria:**

**Given** a measurement has a source-backed formula but no approved tolerance rule
**When** the result is displayed in the mobile form
**Then** the numerical calculation may be shown with its provenance while tolerance/verdict is identified as unavailable pending rule approval
**And** an individual pass/fail appears only when its threshold, boundary and comparison rule are approved; no automatic overall conformity is computed
**And** state uses text and appropriate semantic cues, never color alone or a fabricated pass/fail; unresolved values are not rendered as zero, N.A. or passing.

**Traceability:** spec `_bmad-output/specs/spec-6-3-display-calculation-results-in-employe-form/SPEC.md`; FR-026, FR-027, UX-DR2 (measurement-result), UX-DR6, UX-DR12. **Dependency:** DEP-01R; Stories 5.6 and 6.6 (done).

### Story 6.4: Display authorized calculation results in Responsable review

As a Responsable,
I want accepted measurements and permitted calculation results shown with provenance,
So that review does not confuse numerical evidence with an unapproved verdict.

**Acceptance Criteria:**

**Given** an accepted audit contains source-backed calculations and possibly unresolved tolerance rules
**When** the Responsable opens its calculation results
**Then** measured values, units, formula provenance and approved rule results are readable in the web review surface
**And** unavailable thresholds/verdicts are clearly identified as unavailable; no automatic overall conformity or fabricated pass/fail appears
**And** accepted values remain read-only and status is conveyed by text as well as visual semantics.

**Traceability:** spec `_bmad-output/specs/spec-6-4-display-calculation-results-in-responsable-review/SPEC.md`; FR-012, FR-026, FR-027, SEC-002, SEC-003, UX-DR2 (measurement-result), UX-DR6, UX-DR12. **Dependency:** DEP-01R; Stories 6.3 and 6.6 (done). Delivers the read-only web view and shared code; Story 9.1 renders it in W4 with the accepted snapshot (Epic 7).

### Story 6.5: Separate formula regression fixtures from approved acceptance fixtures

As a developer,
I want source-derived formula cases and CETEM-approved acceptance cases identified separately,
So that reproducing workbook evidence is not mistaken for business approval.

**Acceptance Criteria:**

**Given** the supplied workbook examples and any later CETEM-approved reference dataset
**When** calculation fixtures are stored and executed by the implementation pipeline
**Then** workbook-derived cases are labeled source-regression evidence and approved reference cases are stored in a separate category with approval provenance
**And** no workbook example is represented as an approved acceptance verdict unless CETEM explicitly approves it
**And** calculation/verdict acceptance remains marked blocked until the approved dataset includes relevant normal, abnormal, invalid and boundary cases.

**Traceability:** spec `_bmad-output/specs/spec-6-5-separate-regression-and-acceptance-fixtures/SPEC.md`; FR-025, FR-026, DR-002, AD-7. **Dependency:** DEP-02 (the approved dataset ships empty; acceptance stays blocked until CETEM supplies it).

### Story 6.6: Align calculation rules with the official CETEM paper form

As an Employé,
I want the shared calculations and tolerances to match the official CETEM paper form,
So that the results and suggested verdicts I see are the ones the signed report uses.

**Acceptance Criteria:**

**Given** the paper form « Rapport de Contrôle de Qualité d'un Appareil Mobile de Radiographie » replaces the workbook as the rule reference
**When** the shared domain calculates voltage accuracy, voltage repeatability, output reproducibility/repeatability, linearity (with DFC) and light-field correspondence
**Then** it applies the paper formulas and the printed tolerances (≤ 10 %, ≤ 5 %, < 10 %, < 15 %), returns a suggested per-test verdict, and returns « indisponible » for light field (no printed tolerance)
**And** rule `cetem-paper-form` / `2.0.0` replaces `cetem-workbook-explicit-formulas` / `1.0.0`; drafts with the old rule are refused safely and are not migrated
**And** workbook-only rules (3-row reproducibility, initial linearity, fixed 0.49) are removed, and no overall conformity is computed.

**Traceability:** spec `_bmad-output/specs/spec-6-6-align-calculation-rules-with-cetem-paper-form/SPEC.md`; paper form photos `docs/product/source/formulaire-cetem/`; FR-025, FR-026, AD-2, AD-7. **Blocks:** Story 6.3.

### Story 6.7: Harden the test harness and recover unreadable local drafts

As the delivery team and as an Employé,
I want every test and package checked by the gates, and a way to discard a local draft the app can no longer read,
So that later stories are verified for real and no task stays blocked on a device.

**Acceptance Criteria:**

**Given** the local Docker PostgreSQL in `DATABASE_URL`
**When** `pnpm -r test` and `pnpm -r typecheck` run
**Then** every test file under `apps/*` and `packages/*` runs with no skipped PostgreSQL test, PostgreSQL tests migrate an isolated local test database/schema, clean up and refuse non-local hosts, and every TypeScript package under `packages/*` is type-checked including its tests
**And** the mobile draft-compatibility notice offers a confirmed « Supprimer le brouillon local » that deletes the unparseable draft for that employee and task, after which (and after any explicit delete) the form shows fresh paper-form defaults
**And** the Epic 6 context places tolerance ownership as in Story 6.6, and the open sprint action items are implemented and closed or left open with a note.

**Traceability:** spec `_bmad-output/specs/spec-6-7-harden-test-harness-and-recover-unreadable-drafts/SPEC.md`; deferred-work entries from Stories 5.6 and 6.6; Epic 4/5 retrospective action items.

## Epic 7: Reliable Synchronization and Server-Accepted Submission

### Story 7.1: Queue durable synchronization operations

As an Employé,
I want local changes and requested operations preserved in a durable outbox,
So that reconnecting or retrying cannot lose or duplicate my work.

**Acceptance Criteria:**

**Given** a locally saved draft or explicit submission request exists
**When** the mobile app records the operation
**Then** the audit snapshot and outbox operation are committed in one local transaction with an operation ID, idempotency key and base revision
**And** an outbox item remains until a definitive server outcome is durably recorded locally; retry is bounded and background execution is opportunistic, not required for correctness
**And** app restart, logout, expiry, upgrade and transient transfer failure do not silently delete the item or its payload.

**Traceability:** FR-019, FR-021, FR-042, NFR-001, NFR-002, SEC-007, AD-4, AD-5.

### Story 7.2: Show synchronization and submission state distinctly

As an Employé,
I want to see whether work is saved, synchronized, pending submission or server accepted,
So that I know which copy is authoritative.

**Acceptance Criteria:**

**Given** a saved draft, pending operation, transfer failure or accepted result
**When** the task state is rendered
**Then** local save, offline connectivity, draft synchronization, submission pending and server acceptance have distinct French text states
**And** retryable transfer failures preserve the draft and expose a retry action; transport success alone never changes the audit to Submitted
**And** a pending submission remains visibly pending and locally read-only until a definitive server outcome.

**Traceability:** spec `_bmad-output/specs/spec-7-2-show-synchronization-and-submission-state-distinctly/SPEC.md`; FR-021, FR-042, UX-DR2 (status-badge, sync-status, alert-message, loading-state), UX-DR4, UX-DR5, UX-DR13. **Dependency:** Story 7.1 (done).

### Story 7.3: Accept submissions transactionally and idempotently

As a Responsable,
I want each valid employee submission accepted exactly once by the server,
So that submitted evidence has one authoritative version.

**Acceptance Criteria:**

**Given** a submission command includes an operation ID, idempotency key, base revision, actor and versioned payload
**When** the server validates and processes it
**Then** it enforces authorization and approved blocking validations, and transactionally records one accepted submission with actor/date and coherent revision
**And** a retry with the same idempotency key returns the stored outcome without creating a duplicate; a stale base revision returns conflict metadata without overwriting current data
**And** validations whose definitions are unresolved by DEP-01/02 are not invented; affected acceptance claims remain blocked while already confirmed validation rules can be enforced.

**Traceability:** spec `_bmad-output/specs/spec-7-3-accept-submissions-transactionally-and-idempotently/SPEC.md` (also places the server draft-sync command, the HTTP transport and the automatic sync triggers); FR-021, FR-023, NFR-002, SEC-002, SEC-003, SEC-008, DR-001, DR-004, DR-005, AD-3, AD-4, AD-6. **Dependency:** Stories 7.1 and 7.2 (done); DEP-01/02 for affected validation behavior.

### Story 7.4: Freeze accepted measurements and comments

As a Responsable,
I want server-accepted evidence to remain immutable,
So that later review and reporting refer to the actual submitted snapshot.

**Acceptance Criteria:**

**Given** a server transaction has accepted an audit submission
**When** either role attempts to mutate its accepted measurements or comments
**Then** the server rejects the mutation without changing accepted evidence
**And** the accepted snapshot, submitting actor/date, schema/rule versions and linked task remain available to authorized review
**And** correction or replacement creates a distinct linked record rather than altering the accepted audit in place.

**Traceability:** spec `_bmad-output/specs/spec-7-4-freeze-accepted-measurements-and-comments/SPEC.md` (database freeze of submitted audits, authorized review query; the review route stays in 9.1); FR-023, FR-024, DR-001, DR-005, AD-4, AD-6, SEC-008. **Dependency:** Story 7.3 (done).

## Epic 8: Conflict, Correction and Replacement Recovery

### Story 8.1: Resolve a synchronization conflict explicitly

As an Employé,
I want to compare the current server version with my preserved local version,
So that I can resolve a conflict without silent data loss.

**Acceptance Criteria:**

**Given** the server rejects a stale base revision and returns current version metadata
**When** the conflict UI is presented
**Then** synchronization and submission retry pause, local and server context are identified, and the local version remains preserved
**And** stale local data never directly overwrites the current server version; through the explicit keep-local action it may initialize a new editable revision/draft with `sync-conflict-revision` lineage and the current server revision as its base, before a separately authorized sync attempt
**And** alternatively, after confirmation, the employee may discard the local working version and reload the current server version; the original pending snapshot remains traceable until resolution is persisted
**And** the implementation performs no field-level merge or last-write-wins and does not treat conflict as validation rejection or accepted-audit replacement.

**Traceability:** spec `_bmad-output/specs/spec-8-1-resolve-a-synchronization-conflict-explicitly/SPEC.md` (also places the employee current-version endpoint, the `audit_lineage_links` table and the extraction of the mobile sync wiring, epic-7 retro item 21); FR-022, UX-DR2 (confirmation-dialog, alert-message), UX-DR5, UX-DR13, AD-4, AD-5, AD-6, OD-02b. **Dependency:** Stories 7.1–7.4 (done).

### Story 8.2: Create a correction draft after validation rejection

As an Employé,
I want to correct a rejected pending submission in a new linked draft,
So that the original attempt remains intact while valid data can be resubmitted.

**Acceptance Criteria:**

**Given** the server returns a non-conflict blocking validation outcome
**When** the employee chooses Créer un brouillon de correction
**Then** a new editable draft is initialized from the rejected snapshot and linked with `rejected-submission-correction`
**And** the original submission attempt remains preserved read-only and is not labeled a synchronization conflict or server-accepted submission
**And** the correction uses the normal save/submission flow and reports unresolved DEP-01R/02-dependent fields as gated rather than inventing rules.

**Traceability:** spec `_bmad-output/specs/spec-8-2-create-a-correction-draft-after-validation-rejection/SPEC.md` (also places the `correctionOfOperationId` envelope field, the `rejected-submission-correction` lineage link, and the shared device/server structural validator from epic-7 retro item 20); FR-023, FR-024, UX-DR5, AD-4, AD-5, AD-6. **Dependency:** Stories 7.1–7.4 and 8.1 (done); DEP-01/02 for unresolved validations (gated, not invented).

### Story 8.3: Create a Responsable-only replacement after acceptance

As a Responsable,
I want to create a new control linked to an accepted audit,
So that a material submitted error can be corrected without altering original evidence.

**Acceptance Criteria:**

**Given** an accepted audit in the Responsable's own team
**When** the Responsable explicitly creates a replacement and assigns it through normal task creation
**Then** the command creates a new task/audit with independent measurements, timestamps, calculations and lifecycle, linked as `replacement-control` to the original
**And** only Responsable is authorized to invoke it; Employé cannot see or call a post-acceptance replacement action
**And** the original task, accepted measurements/comments, reports and history remain unchanged and show reciprocal replacement lineage.

**Traceability:** spec `_bmad-output/specs/spec-8-3-create-a-responsable-only-replacement-after-acceptance/SPEC.md` (also places the `audit_replacement_links` table, the `POST /tasks/{taskId}/replacements` route, and the accepted state and reciprocal lineage on the Responsable task list); FR-024, FR-040, DR-001, DR-006, SEC-002, SEC-003, AD-3, AD-4, AD-6, UX-DR11, OD-03. **Dependency:** Stories 7.1–7.4, 8.1 and 8.2 (done).

### Story 8.4: Handle unfinished tasks after employee deactivation

As a Responsable,
I want explicit state-specific recovery choices for deactivated employees' unfinished tasks,
So that work can continue without transferring authorship or losing local evidence.

**Acceptance Criteria:**

**Given** a deactivated employee owns an unfinished task
**When** the Responsable reviews the flagged task
**Then** a task with no work started may be reassigned to an active employee; synchronized editable work retains its original employee attribution and authorship of prior measurements is never transferred
**And** if another employee continues synchronized editable work, the approved Responsable recovery path creates separately attributable working audit/draft state without relabeling prior measurements
**And** pending/immutable snapshots are never reassigned, modified or deleted automatically; work existing only on the deactivated employee's device is not claimed as server-received or synchronized under that account
**And** unresolved tablet-only administrative recovery is surfaced as requiring authorized recovery outside the ordinary employee sync path; all original tasks and history remain visible.

**Traceability:** FR-005, DR-006, SEC-002, SEC-003, AD-4, AD-5, AD-6, UX-DR11, OD-01, OD-03.

## Epic 9: Responsable Audit Review and Insights

### Story 9.1: Review accepted audit evidence read-only

As a Responsable,
I want to inspect accepted measurements, comments and calculation evidence,
So that I can review the control without changing the employee's submission.

**Acceptance Criteria:**

**Given** an accepted audit belongs to the Responsable's team
**When** the Responsable opens the submitted evidence
**Then** measurements/comments and accepted calculation snapshot are read-only and review access is logged with actor/date
**And** the interface does not show an employee-work approve/reject action or introduce an approval state
**And** unauthorized team access is denied server-side without disclosing the audit.

**Traceability:** spec `_bmad-output/specs/spec-9-1-review-accepted-audit-evidence-read-only/SPEC.md`; FR-012, FR-013, SEC-002, SEC-003, SEC-011 (security events), DR-005, UX-DR6. **Dependency:** Stories 6.4, 7.3, 7.4 and 8.3 (done).

### Story 9.2: Generate deterministic insight proposals from approved rules

As a Responsable,
I want factual insight proposals derived from accepted audit evidence,
So that review highlights only observations CETEM BH has explicitly defined.

**Acceptance Criteria:**

**Given** an accepted audit and CETEM-approved deterministic insight rules are available
**When** rule evaluation runs for a versioned audit input
**Then** proposals are deterministic for the same input/rule version and include source/rule provenance
**And** AI does not author deterministic or authoritative insights; no threshold or proposal rule is inferred from workbook formulas alone
**And** until DEP-01R defines the applicable proposal rule, the feature is marked blocked/unavailable and no fabricated proposal appears.

**Traceability:** spec `_bmad-output/specs/spec-9-2-generate-deterministic-insight-proposals-from-approved-rules/SPEC.md`; FR-028, DR-002, DR-007, DR-008, AD-7. **Dependency:** DEP-01R (no approved rule yet: the registry ships empty and the feature reports « indisponible »).

### Story 9.3: Retain or discard proposed insights with provenance

As a Responsable,
I want to select or discard each proposed insight,
So that the retained set accurately reflects my review.

**Acceptance Criteria:**

**Given** deterministic proposals are available for an accepted audit
**When** the Responsable selects or discards proposals
**Then** each decision records actor, date and audit/rule version
**And** an all-normal audit may retain zero insights without blocking summary completion
**And** discarded proposal content is not passed as retained insight content into summary generation.

**Traceability:** spec `_bmad-output/specs/spec-9-3-retain-or-discard-proposed-insights-with-provenance/SPEC.md`; FR-029, FR-031, DR-007, DR-008, UX-DR2 (insight-item), UX-DR7. **Dependency:** proposal availability is gated by DEP-01 (registry empty: production shows no proposal or control; mechanism proven with synthetic registries). Stories 9.1, 9.2 (done).

### Story 9.4: Add a manual insight

As a Responsable,
I want to add a factual manual insight before summary generation,
So that relevant observations not represented by deterministic rules can be retained with attribution.

**Acceptance Criteria:**

**Given** the Responsable is reviewing an accepted audit before summary confirmation
**When** they add an insight and optional justification
**Then** text, author, date and source type are retained and linked to that audit
**And** insight management does not modify accepted measurements/comments or create a general evidence attachment feature
**And** zero retained insights remains a valid review result.

**Traceability:** spec `_bmad-output/specs/spec-9-4-add-a-manual-insight/SPEC.md`; FR-030, FR-031, DR-007, DR-008, UX-DR2 (insight-item), UX-DR7. **Dependency:** Stories 9.1, 9.2, 9.3 (done); works with the empty production registry.

## Epic 10: Confirmed Summary and Human Conformity Decision

### Story 10.1: Request an AI-assisted summary draft

As a Responsable,
I want to request a summary draft grounded in authorized audit data and retained insights,
So that writing assistance is useful without becoming an authority over the result.

**Acceptance Criteria:**

**Given** an accepted audit has a current retained insight set, including possibly zero insights
**When** the Responsable requests AI assistance
**Then** the provider receives only authorized audit data and retained/manual insights; requester, date, exact input-set identity and provider/model provenance are recorded
**And** generated text is an editable draft, not a confirmed summary or conformity decision; failures allow retry or manual entry
**And** secrets, unnecessary sensitive payloads and duplicated prompt content are excluded from logs; if AI is unavailable, manual completion remains possible.

**Traceability:** spec `_bmad-output/specs/spec-10-1-request-an-ai-assisted-summary-draft/SPEC.md`; FR-032, SEC-011 (AI control), DR-008, DR-009, AD-8, AD-9, UX-DR2 (loading-state, alert-message), UX-DR7, UX-DR8. **Dependency:** Stories 9.1–9.4 (done); mock provider by default, Gemini optional.

### Story 10.2: Write, edit and explicitly confirm a summary

As a Responsable,
I want to edit an AI draft or write a manual summary and explicitly confirm it,
So that the report sequence proceeds only from my approved text.

**Acceptance Criteria:**

**Given** an AI draft exists or the Responsable chooses manual entry
**When** the Responsable saves edits and confirms the summary
**Then** the system preserves the initial AI draft when present, final confirmed text, actor/date and actual summary input set
**And** a manual-only summary follows the same confirmation gate without fictitious model metadata; zero retained insights does not block confirmation
**And** until explicit confirmation, conformity decision and report designation remain unavailable; failed save never claims confirmation.

**Traceability:** spec `_bmad-output/specs/spec-10-2-write-edit-and-explicitly-confirm-a-summary/SPEC.md`; FR-031–FR-033, DR-005, DR-008, DR-009, SEC-011 (AI control), UX-DR2 (summary-editor, button-primary), UX-DR8. **Dependency:** Stories 9.1–9.4, 10.1 (done); after confirmation, manual insights, insight decisions and draft requests are refused (409).

### Story 10.3: Reopen a confirmed summary before official designation

As a Responsable,
I want to reopen a confirmed summary before report finalization,
So that corrections preserve history and invalidate decisions/reports based on old text.

**Acceptance Criteria:**

**Given** a summary is confirmed and no official report has been designated
**When** the Responsable explicitly reopens it
**Then** a new editable/unconfirmed summary version is created while prior text and confirmation actor/date remain historical
**And** the previous conformity decision becomes historical rather than current, and dependent report candidates are marked outdated/superseded and cannot be designated
**And** the revised summary must be confirmed again, a new human conformity decision recorded, and current report candidates generated before designation; after official designation reopening is unavailable.
**And** summaries, conformity and reports exchange the reopen/invalidation outcome through their public module contracts; none reaches into another module's tables or repositories.

**Traceability:** spec `_bmad-output/specs/spec-10-3-reopen-a-confirmed-summary-before-official-designation/SPEC.md`; FR-033, FR-035, FR-038, DR-005, DR-009, AD-8, UX-DR8, UX-DR10, OD-10. **Dependency:** Stories 10.1, 10.2 (done); conformity (10.4) and reports (11.x) plug in through the public reopen-participant contract, none exists yet.

### Story 10.4: Record the explicit human machine-conformity decision

As a Responsable,
I want to choose Machine conforme or Machine non conforme after summary confirmation,
So that overall conformity remains an accountable human decision.

**Acceptance Criteria:**

**Given** the current summary is confirmed
**When** the Responsable explicitly records either supported outcome
**Then** the choice, actor and date are stored as a separate conformity decision with no default/preselected value
**And** individual tolerance results, calculations, insights or AI text do not set or infer this decision
**And** either outcome remains eligible for report completion; a reopened summary makes the prior decision historical and requires a fresh decision.

**Traceability:** spec `_bmad-output/specs/spec-10-4-record-the-explicit-human-machine-conformity-decision/SPEC.md`; FR-026, FR-038, DR-005, AD-8, UX-DR2 (conformity-decision), UX-DR9, OD-10. **Dependency:** Stories 10.1–10.3 (done); registers its reopen participant into the 10.3 contract; reports (11.x) bind to the decision `id`.

## Epic 11: Official Reports and Authorized History

### Story 11.1: Generate an inspectable Word report candidate

As a Responsable,
I want to generate a Word report candidate from current audit workflow inputs,
So that I can inspect the proposed printable document before official designation.

**Acceptance Criteria:**

**Given** the audit, confirmed summary and current human decision are eligible for reporting
**When** the Responsable requests Word generation
**Then** a provider-backed document-generation operation creates a private, versioned candidate bound to audit revision, summary version, conformity decision and attempt ID
**And** the candidate is inspectable but not official; generation failure is recoverable and does not complete the control
**And** template fields, labels, calculations, provenance and handwritten-signature zones are accepted only against DEP-03; no missing report field is invented.

**Traceability:** spec `_bmad-output/specs/spec-11-1-generate-an-inspectable-word-report-candidate/SPEC.md`; FR-035, FR-041, NFR-005, DR-009, AD-8, AD-9, UX-DR2 (report-panel, loading-state), UX-DR10. **Dependency:** Stories 10.1–10.4 (done); DEP-03 for final document acceptance.

### Story 11.2: Validate, scan and store a manual PDF file

As a Responsable,
I want to upload a manually prepared PDF and see its validation/scan status,
So that an unsafe or incomplete file cannot become official.

**Acceptance Criteria:**

**Given** a report-eligible audit and a selected file
**When** the Responsable uploads it
**Then** only PDF up to the resolved 20 MB limit is accepted for processing; corrupt, unreadable, truncated, structurally invalid, password-protected/encrypted or unsafe files are rejected or quarantined
**And** no page-count limit is introduced by Phase 1
**And** the `files` capability stores the binary in private object storage and metadata/references in PostgreSQL, performs server-side type/structure/size validation and coordinates malware scanning
**And** failed/unavailable/incomplete scanning never counts as clean; this story reports validated/scanned file outcomes through a files-owned contract and does not create report business state.

**Traceability:** spec `_bmad-output/specs/spec-11-2-validate-scan-and-store-a-manual-pdf-file/SPEC.md`; SEC-008, SEC-010, AD-9, UX-DR2 (report-panel, alert-message, loading-state), UX-DR10, OD-04. **Dependency:** none for the resolved file security baseline (reuses the 11.1 `files` storage port).

### Story 11.3: Create a report candidate from a ready PDF

As a Responsable,
I want a validated, scanned PDF represented as a report candidate,
So that report lifecycle rules can use a safe file without taking ownership of file storage.

**Acceptance Criteria:**

**Given** the files capability reports a PDF as validated and scan-clean
**When** the Responsable attaches it to an eligible report workflow
**Then** the `reports` capability creates a candidate with origin, audit/task association and immutable input bindings
**And** a file that is still uploading, invalid, quarantined, scan-pending or scan-failed cannot become Ready or eligible for designation
**And** report metadata and official status remain owned by reports while file binary operations remain behind the files interface.

**Traceability:** spec `_bmad-output/specs/spec-11-3-create-a-report-candidate-from-a-ready-pdf/SPEC.md`; FR-034, FR-035, AD-8, AD-9, UX-DR2 (report-panel), UX-DR10. **Dependency:** Stories 11.1–11.2 (done); DEP-03 for report-content acceptance.

### Story 11.4: Designate exactly one current report official

As a Responsable,
I want to inspect and explicitly designate one current report candidate,
So that finalization is tied to the confirmed summary and human decision.

**Acceptance Criteria:**

**Given** one or more Word/PDF candidates are Ready and bound to the current audit, summary and conformity decision
**When** the Responsable inspects a candidate and designates it official
**Then** the server rechecks eligibility and freshness transactionally and records exactly one official report with origin, actor/date and task/audit linkage
**And** candidates based on stale summary/decision/audit versions are Outdated/Superseded and cannot be designated; pre-designation candidate replacement preserves history
**And** official designation locks the completed workflow/report and no later in-place replacement or mutation is allowed; both human conformity outcomes can complete.

**Traceability:** spec `_bmad-output/specs/spec-11-4-designate-exactly-one-current-report-official/SPEC.md`; FR-014, FR-035, DR-005, DR-009, AD-8, AD-9, UX-DR10. **Dependency:** Stories 10.1–10.4, 11.1–11.3 (done); registers the real reopen participant (Epic 10 retro F5); DEP-03 blocks final report-content acceptance; lifecycle and freshness behavior can be implemented against the defined bindings.

### Story 11.5: View and download authorized completed history

As an authorized Responsable or Employé,
I want to view completed control history and download its official report,
So that I can consult the correct evidence and report later.

**Acceptance Criteria:**

**Given** completed controls belong to the user's authorized team or assignments
**When** the user opens history and selects a record
**Then** read-only evidence, insights, confirmed summary, human decision, official report and task/audit links are shown as authorized
**And** download returns only the linked official file through an authorized endpoint or short-lived access path; cross-team/unassigned requests disclose no report data
**And** replacement lineage is shown without changing the original record's state or measurements.

**Traceability:** spec `_bmad-output/specs/spec-11-5-view-and-download-authorized-completed-history/SPEC.md`; FR-036, FR-040, DR-001, DR-006, DR-009, SEC-002, SEC-003, AD-3, AD-6, AD-9, UX-DR2 (history-record), UX-DR11. **Dependency:** Stories 9.1, 8.3–8.4, 10.1–10.4 and 11.1–11.4 (done); Employé access is delivered at API/typed-client level, the mobile screen is deferred.

### Story 11.6: Keep report candidates current through asynchronous processing

As a Responsable,
I want completed generation and scan operations checked against current workflow versions,
So that delayed work cannot make an obsolete report designatable.

**Acceptance Criteria:**

**Given** report generation or scanning is still running when summary, decision or audit revision changes
**When** the asynchronous operation completes
**Then** its immutable attempt and binary/scan evidence are retained, but the candidate remains outdated/non-designatable if its bound inputs are no longer current
**And** only a result whose audit revision, summary version and conformity decision are still current can become Ready/designatable
**And** file-scan completion is consumed through the files contract/event; reports owns candidate freshness and eligibility and does not reach into file repositories.

**Traceability:** FR-035, AD-8, AD-9, UX-DR10, UX-DR13.

## Epic 12: PoV Environment, Verification and Acceptance Readiness

### Story 12.1: Configure a controlled PoV deployment environment

As a PoV operator,
I want separate development and PoV/test configuration for the agreed application footprint,
So that the end-to-end demonstration can run with protected dependencies.

**Acceptance Criteria:**

**Given** a deployment target is selected for the PoV
**When** the operator configures the environment
**Then** it runs the web app, mobile app, one Express API and PostgreSQL, with provider-backed private object storage, malware scanning capability, AI assistance, document generation and structured logging
**And** secrets are injected at runtime, data services are private where supported, API traffic uses TLS, and health/readiness plus migrations are available
**And** object storage, malware scanning, AI assistance and document generation remain behind replaceable provider interfaces; no concrete vendor is selected by this story
**And** backups have documented restore capability; production is not created without approval and no microservices, Kubernetes, HA, multi-region or autoscaling are added without a direct need.

**Traceability:** AD-9, AD-11, SEC-005, SEC-009, NFR-007.

### Story 12.2: Emit useful security and workflow diagnostics

As an operator,
I want correlated logs for failures and sensitive state changes without secrets or unnecessary payloads,
So that PoV issues can be diagnosed safely.

**Acceptance Criteria:**

**Given** login failures, authorization refusals, deactivation, synchronization, report generation or other defined sensitive operations occur
**When** the system emits diagnostic events
**Then** structured events carry correlation ID, event kind, timestamp, available actor and outcome
**And** passwords, tokens, temporary credentials and unnecessary sensitive audit/prompt payloads are excluded
**And** traceability remains available for submission, summary confirmation, conformity decision, report designation and security events.

**Traceability:** NFR-007, SEC-001, SEC-011, DR-005, DR-009, AD-11.

### Story 12.3: Demonstrate account provisioning through assigned mobile work

As a PoV evaluator,
I want to demonstrate a Responsable creating an Employé and assigning Graphie Mobile work,
So that the controlled account-to-task path is visible end to end.

**Acceptance Criteria:**

**Given** the first Responsable is controlled-provisioned and an Employé can be created
**When** the Responsable hands over the one-time credential and creates/assigns a Graphie Mobile task
**Then** the Employé can activate the account, enter the new password and see only their assigned task in-app
**And** evidence shows server-enforced team/assignment access, task attribution, in-app visibility and no email-delivery claim
**And** any missing field-catalogue behavior is excluded from this scenario and reported under DEP-01R.
**And** design handoff stays within the four approved mockup scopes; supporting surfaces use the component/behavior specifications without added high-fidelity mockup scope.

**Traceability:** Stories 2.1–4.3; FR-001–FR-016 as applicable; SEC-001–SEC-005, SEC-012, DR-001, AD-3, UX-DR14.

### Story 12.4: Demonstrate offline persistence through server acceptance

As a PoV evaluator,
I want to observe field work saved offline and accepted after reconnection,
So that local durability and authoritative submission are visibly distinct.

**Acceptance Criteria:**

**Given** an assigned task is synchronized to a supported mobile device
**When** the employee saves offline, restarts the app, requests submission and later reconnects
**Then** the local draft survives restart, shows pending submission until server acceptance, and is not reported Submitted on transport success alone
**And** an interrupted/retried transfer does not lose data or create a duplicate accepted version; measurements/comments become immutable only after server acceptance
**And** results dependent on unspecified DEP-01/02 rules are called blocked and are not replaced by invented expected values.

**Traceability:** Stories 5.2–5.5, 6.1–6.5, 7.1–7.4; FR-019–FR-027, FR-042; NFR-001, NFR-002; SEC-007; AD-4–AD-7; DEP-01/02.

### Story 12.5: Demonstrate conflict and validation-correction recovery

As a PoV evaluator,
I want to see conflict and validation rejection handled as different outcomes,
So that neither recovery path overwrites or unlocks the preserved original.

**Acceptance Criteria:**

**Given** one stale-revision conflict and one non-conflict validation rejection are available as distinct scenarios
**When** the Employé resolves each scenario
**Then** the conflict path offers explicit keep-local-as-new-revision or discard-and-reload choices and pauses retry until resolved
**And** the rejection path offers a linked correction draft while keeping the rejected snapshot read-only; it is not labeled a sync conflict
**And** no automatic merge, stale overwrite, data loss or server-accepted status is represented.

**Traceability:** Stories 8.1–8.2; FR-022–FR-024; UX-DR5; AD-4–AD-6; OD-02b; DEP-01/02 for unresolved validation cases.

### Story 12.6: Demonstrate review, summary and human decision gates

As a PoV evaluator,
I want to observe the Responsable reviewing evidence and making explicit human decisions,
So that AI and calculation assistance cannot replace accountable review.

**Acceptance Criteria:**

**Given** a server-accepted audit is available to its Responsable
**When** review, insight handling, summary confirmation and conformity decision are demonstrated
**Then** accepted measurements remain read-only, zero retained insights is allowed, and deterministic proposals appear only where DEP-01 rules exist
**And** AI failure still permits manual summary and explicit confirmation; either human machine-conformity outcome can proceed independently of individual verdicts
**And** actor/date traceability is visible for submission, summary confirmation and decision; an employee-work approval/rejection step is absent.

**Traceability:** Stories 9.1–10.4; FR-012, FR-013, FR-027–FR-033, FR-038; DR-005, DR-007–DR-009; SEC-011 (AI control); DEP-01.

### Story 12.7: Demonstrate report candidates through authorized history

As a PoV evaluator,
I want to demonstrate both official-report paths and later authorized retrieval,
So that report readiness and completion are evidenced.

**Acceptance Criteria:**

**Given** a confirmed summary and current human conformity decision
**When** the Responsable generates Word or uploads a manual PDF, inspects a candidate and designates it official
**Then** only one current eligible candidate becomes official; completion remains blocked until designation and the correct official file appears in authorized history
**And** PDF upload security/scan failures block readiness; report-template/content/signature claims requiring DEP-03 are reported as blocked
**And** handwritten signing is outside the software completion gate and no signed-scan upload is required.

**Traceability:** Stories 11.1–11.6; FR-014, FR-034–FR-036, FR-040, FR-041; SEC-010; AD-8, AD-9; UX-DR10/11; DEP-03.

### Story 12.8: Demonstrate post-acceptance replacement and deactivation recovery

As a PoV evaluator,
I want to verify replacement and deactivated-employee recovery preserve authorship and history,
So that recovery does not alter previously accepted evidence.

**Acceptance Criteria:**

**Given** an accepted audit requiring replacement and unfinished work owned by a deactivated employee
**When** the Responsable uses the applicable recovery path
**Then** only the Responsable creates a linked independent replacement; original measurements/comments remain immutable
**And** deactivation does not automatically reassign tasks; no-work-started, synchronized-draft, pending/immutable and tablet-only cases follow their distinct resolved behavior
**And** the Employé cannot initiate post-acceptance replacement and local-only work is never claimed as server-received.

**Traceability:** Story 8.3–8.4; FR-005, FR-024, FR-040; DR-001, DR-006; SEC-002/003; AD-4–AD-6; OD-01/03.

### Story 12.9: Record performance and platform acceptance conditions

As a PoV evaluator,
I want performance and device results measured against agreed conditions,
So that targets are not claimed without a defined test context.

**Acceptance Criteria:**

**Given** the representative device/browser matrix, dataset, network/load conditions and acceptance owner are agreed
**When** server-backed interactions, local save/autosave and Word generation are measured
**Then** results are recorded against <=3 seconds p95, <=1 second p95 and <=30 seconds p95 respectively
**And** mobile behavior is checked on representative Android phone/tablet and iPhone/iPad form factors; the selected Responsable web browsers are checked across their latest two major versions
**And** representative web/mobile journeys check touch targets, text scaling, readable focus/keyboard behavior and screen-reader labels; this evidence does not claim blanket WCAG conformance
**And** until the device/browser/test matrix and acceptance authority are confirmed, report the measurements as engineering evidence rather than a formal acceptance pass.

**Traceability:** NFR-003–NFR-006, NFR-008, UX-DR3, UX-DR12, OD-05, OD-06.
