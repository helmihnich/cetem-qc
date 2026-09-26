# Input Reconciliation Review

Reviewed: 2026-09-26  
Inputs: final PRD and addendum; UX `EXPERIENCE.md`, `DESIGN.md`, and `DECISIONS.md`; `ARCHITECTURE-SPINE.md`.

## Verdict

The spine has the correct primary architecture: modular monolith, PostgreSQL authority, transactional mobile replica/outbox, module ownership, and the report/summary gate. It needs the following additions before handoff because a builder reading only the spine could choose behavior that conflicts with resolved product decisions.

## High findings

1. **OD-01's actual offline authorization policy is only referenced, not bound.** AD-5 says to follow OD-01, but omits the resolved **seven-day period from the last successful server authentication**, renewal only by successful online re-authentication, and the requirement to restore only currently authorized local access afterward. Bind those conditions explicitly; app restarts, saves, temporary loss of connectivity, and ordinary server-token expiry do not end the window, while deliberate logout does.

2. **OD-04's PDF safety baseline is incomplete.** AD-9 mandates validation, size enforcement, and malware scanning but does not bind PDF-only intake, the configurable **20 MB** maximum, rejection of protected/encrypted/password, corrupt, unreadable, truncated, and invalid files, nor the Ready lifecycle and scan-failure behavior. Record the resolved baseline: an upload remains untrusted and cannot be designated until structural validation and scanning succeed; unavailable/failed scanning blocks designation and supports retry; unsafe files are rejected/quarantined. Keep report-content/template rules deferred under DEP-03.

3. **OD-08 controlled bootstrap is missing.** The spine mentions identity/authentication but not that the first Responsable is provisioned through a controlled external/deployment process. It must prohibit public registration, exposed bootstrap endpoints, a separate application Administrator role, role selection/elevation, and general Responsable-management UI. After first login, only a Responsable provisions Employé accounts; each activation credential is one-time and forces a password change.

4. **AI authorization and provenance are under-specified.** FR-032 and SEC-011 require an AI request to contain only authorized audit data and retained/manual insights, and retain requester/date, actual input set, model/provider provenance, draft output, and final/confirmed text. AD-8 preserves versions and manual fallback but does not bind the input boundary or complete provenance. Add it to `ai`/`summaries` ownership and ensure logs do not duplicate sensitive prompt payloads.

5. **Offline calculation parity is not explicit.** FR-042 requires authorized calculations, individual feedback, validation, local Save, and viewing to work offline. AD-7 defines calculation ownership and AD-5 defines storage, yet neither binds the same versioned pure calculation/rule implementation to mobile and server. Require mobile offline execution from validated, versioned rules and server revalidation on acceptance; unresolved DEP-01/02 rules must remain unavailable rather than fabricated.

## Medium findings

- **OD-06 is resolved as configurable engineering targets**, whereas the spine defers performance targets wholesale. Record the PoV targets: normal server-backed interaction <=3 s p95, local Save/autosave <=1 s p95, and Word generation <=30 s p95. Exact device/browser matrix, scenarios, conditions, and acceptance owner remain deferred.
- **Scope exclusions are not collected as a boundary.** Add an explicit Phase 1 exclusion rule for Graphie fixe execution, Scopie, employee-work approval/rejection, real email delivery, automatic PDF generation, general evidence attachments, electronic signatures/signed-scan reintegration, collaborative multi-device editing, and field-level automatic merges. The notification port may remain but no Phase 1 adapter/workflow exists.
- **Authorization shape needs the two required scopes.** AD-3 says server authorization, but should state own-team access for Responsable and own-assignment access for Employé, with unauthorized cross-team/task requests disclosing no resource data.
- **OD-03 deactivated-work state distinctions are absent.** Bind: no-start task may be reassigned; synchronized editable draft preserves prior attribution and starts/restarts work for the new employee; mobile-device-only work cannot be assumed server-visible; pending/immutable snapshots require explicit resolution and are never reassigned, modified, or deleted automatically.
- **Task and report traceability need a minimum explicit contract.** Retain actor/date for submission, summary confirmation, conformity decision, and official designation; retain task/audit, Responsable, human decision, finalization date, report origin/metadata, and report inputs. AD-6/8 imply much of this but do not make it clear enough for independent modules.

## No contradiction found

The spine agrees with the selected pnpm/Expo architecture, vendor-neutral operations, PostgreSQL relational core plus validated versioned JSONB, no microservices for Phase 1, server-authoritative acceptance, idempotent retries, optimistic concurrency, correction drafts after validation rejection, and summary reopening before official designation.
