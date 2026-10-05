# Delivery notes

## Suggested order

1. Domain split and the surrogate rule. Then the device parser delegation and the parity test (V1, V2, P1).
2. Contracts: OpenAPI, then generated types, zod schemas and the client (K3, K4).
3. API: migration 0012, the reference check and the lineage insert (L9–L16).
4. Mobile store v5, `createCorrectionDraft`, stamping and the local submission check (S5, C1–C6). Then the engine, the adapter field and the derivation (E6, T5, D3).
5. Refusal panel, correction draft labels and strings (R29–R36, X4).

## Bookkeeping at build

- In `deferred-work.md`, mark the 7.3 review entry « A field value with an unpaired UTF-16 surrogate … » as resolved by 8.2, naming test V1/L9.
- In `sprint-status.yaml`, mark `epic-7-retro-item-20-make-the-mobile-parsegraphiepayload-dele` as `done`, with a note naming P1.
- In `epics.md`, Story 8.2 already carries its spec traceability line. Do not edit it again.

## Build decisions (2026-10-05)

Technical resolutions taken while building; none is a CETEM business rule.

- **Derivation result.** `TaskSyncState` gains `rejection` and `correction` as specified. The 7.2 `expectState` helper now also asserts them (`rejection` set exactly for `acceptance-blocked`, `correction` null in those rows), and the 8.1 D2 full-object expectations add `rejection: null, correction: null`, so the existing rows check strictly more.
- **Schema version tests.** The version-pinned local tests (outbox S1, S2, S4, conflict O1 and the migration statement count) follow the specified v4 → v5 bump; S4 and O1 now refuse version 6, and O1 expects the new `correction_operation_id` column as null on upgraded rows.
- **Server reference check.** `sync` reads the outcome row it owns; the « link of this predecessor » read (`readLineageLinkOfPredecessor`) and the insert stay in `audits`. A reference already linked as `rejected-submission-correction` to this task's audit is passed as `alreadyLinked` and adds no row.
- **Correction draft without a local row.** When no local draft row exists, the correction is revision 1 with a new draft ID (C1).
- **App render double.** The test double of `App.render.test.tsx` now stores `correction_drafts` and `correction_operation_id`, answers the snapshot-by-ID and « accepted item carrying the reference » reads, and returns the identity columns (`draft_id`, `created_at`, `saved_at`) of a local draft. No existing test body changed; every 7.x/8.1 render test passes on it.
- **Issue texts.** `nul-character` and `unpaired-surrogate` share the French text « caractère non autorisé » (correction-ui.md); R35 uses a distinct code for the second refusal so its « earlier issues are gone » check is meaningful.

## Code review (2026-10-05)

Fresh adversarial review of the uncommitted 8.2 change against this spec. It found no blocking defect and changed no code. All gates passed.

- **Deferred:** if a snapshot payload ever fails `parseGraphiePayload`, the store commits the correction, but the App reports `correctionFailed`. This cannot happen with the single `2.0.0` catalogue. It is recorded in `deferred-work.md` for the first catalogue version bump.
- **Rejected:** in `process-sync-operation.ts`, the condition `correction === "invalid" || validation === null` looks redundant. It is kept because it narrows `correction` for the accept input.
- **Rejected:** `findOpenRefusal` reads the latest `submit` among all items, while the derivation ignores submits with a `conflict` outcome. They can disagree only when a newer conflicted submit follows an uncorrected refusal. The App cannot reach that state, because Soumettre is hidden while the task is `acceptance-blocked`.
- **Rejected:** deleting a correction draft (Supprimer) keeps the « Brouillon de correction » state with an empty form. This is consistent with « the correction record is insert-only ». The next save is still stamped with the reference.
- **Rejected:** `RejectionPanel` updates its state after unmount on success. React 18 ignores this without a warning, and the panel is keyed by `operationId`, so a stale `correctionFailed` never carries over to a newer refusal.

## Hand-offs

- **Story 8.3.** Add `replacement-control` in its own migration. Never reuse `rejected-submission-correction`. A refusal with `AUDIT_ALREADY_SUBMITTED` stays read-only on the device. Recovery from it belongs to 8.3/8.4.
- **Story 8.4.** A refusal or correction owned by a deactivated employee keeps that employee's attribution. 8.2 adds no reassignment rule.
- **Epics 9 and 11.** History and reports derive correction lineage only from `audit_lineage_links` (AD-6). A correction that never reached the server exists only on the device.
- **Story 12.5.** Demonstrate the path end to end: refusal shown, correction created, values corrected, resubmitted and accepted, with the lineage row present.
- **DEP-01R/02.** When CETEM rules arrive, they go into the domain validator with a new rule or catalogue version. The device inherits them through the shared validator. `rulesGated` is then revised.
