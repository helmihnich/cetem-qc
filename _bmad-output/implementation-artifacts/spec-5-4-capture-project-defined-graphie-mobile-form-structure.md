---
title: 'Story 5.4: Capture the project-defined PoV Graphie Mobile form structure'
story: 5.4
status: done
baseline_commit: 64b4a0cfc19d9fb81810e14b0129c5e00dab673f
---

# Story 5.4 implementation record

## Scope and planning baseline

Implemented the Story 5.4 acceptance criteria in `planning-artifacts/epics.md` against the 2026-10-01 DEP-01 catalogue decision. The catalogue is a project-defined PoV structure; external guidance and workbook-derived content retain explicit provenance and do not imply CETEM approval. No planning contradiction was found.

## Implementation

- Added a versioned configuration-driven French catalogue for intervention, equipment, measuring instruments, qualitative checks, quantitative test families and comments.
- Supported text, date, number, configured choice and multiline text inputs. Field metadata carries provenance and optional rule slots; requiredness, ranges, tolerance, rounding, N.A., blank/zero, comparison, incomplete-test and conformity rules remain absent.
- Persisted catalogue ID/version and form schema version inside each structured draft payload.
- Kept Story 5.3 durable draft transaction/revision/auth checks, explicit Save, autosave, resume and confirmed deletion. Legacy `{content}` records remain separate from structured catalogue values and are saved under a labelled `legacyContent` property only after explicit editing/saving; existing DB is not reset.
- No synchronization/submission lifecycle, calculations, insights, AI, conformity or reports added. Overall conformity remains the Responsable's explicit human decision.

## Verification

- Mobile tests: 79 passed, 0 failed, 0 skipped; includes rendered legacy/context/choice restart cases and Story 5.2/5.3 authorization and draft lifecycle regressions.
- Recursive workspace typechecks: passed.
- Generated contract check: passed; no contract changes.
- Boundary tests/checker: 8 passed; checker passed.
- Android and iOS Expo JavaScript exports: passed with `--no-bytecode`. Default Hermes bytecode generation was blocked by Windows permission denial invoking `hermesc.exe`.
- `git diff --check`: passed.
- Native Android/iOS builds, simulator/physical-device behavior, and on-device SQLCipher/SecureStore/Keychain/Keystore runtime were not exercised by JavaScript exports or tests.

## Acceptance limits

This implementation supplies form structure only. Business rules identified as unresolved by the approved catalogue decision remain unconfigured; there is no automatic conformity verdict.

### Review Findings

- [x] [Review][Patch] Reject unsupported catalogue/schema versions and malformed field-value shapes before interpreting a saved payload [apps/mobile/graphie-pov-catalogue.ts]
- [x] [Review][Patch] Keep structured context in its catalogue field and do not migrate opaque legacy text into that field [apps/mobile/graphie-pov-catalogue.ts]
- [x] [Review][Patch] Render `choice` fields using their configured French options [apps/mobile/App.tsx]
- [x] [Review][Patch] Remove workbook provenance from the project-defined beam geometry field [apps/mobile/graphie-pov-catalogue.ts]

Implementation acceptance for the approved fixes:

- [x] Accept only the supported Story 5.4 catalogue/schema pair. For unknown or malformed form payload metadata, show a French compatibility message, do not render values using current field semantics, and preserve the encrypted draft unchanged. Validate values as a plain string-valued record. Test supported and unsupported pairs, malformed metadata, rendered failure, and retained stored bytes.
- [x] Keep `intervention.contexte` in structured values across save/restart/resume. Preserve old Story 5.3 `{content}` as separate legacy content, editable only as explicitly labelled legacy text; if saved, keep it under a separate `legacyContent` property alongside structured catalogue values. Never map it into a catalogue field. Add rendered end-to-end tests for old legacy and current context save/restart/resume.
- [x] Render configured `choice` values as touch-operable controls using the catalogue's French options. Persist the selected configured value, expose selected state through text/accessibility as well as styling, and do not add requiredness or options. Test rendered options, selection, arbitrary-text unavailability, state, and save/restart/resume.
- [x] Tag `beam.geometry` with `PROJECT_POV_DECISION` provenance only, unless an existing planning source explicitly supports another class. Check nearby workbook provenance assignments and test that the beam-geometry field is not marked `CETEM_WORKBOOK`.
- [x] Preserve Story 5.2 authorization/redaction and Story 5.3 transactional local persistence, account/task isolation, save acknowledgement, resume, and deletion. Do not add synchronization, submission, calculations, verdicts, insights, AI, conformity, or reports. Keep sprint status Epic 5 `in-progress`, Story 5.4 `done`, Story 5.5 `backlog`.

### Patch completion evidence

- [x] Supported catalogue/schema pair pinned to `graphie-mobile-pov` / `1.0.0` / schema `2`; unsupported and malformed payload metadata, unknown payload keys, unknown field IDs, and unsupported choice values produce a French compatibility state without field hydration or draft writes. Tests cover supported pair, unknown catalogue/schema, malformed metadata, no current-semantics rendering, and unchanged persisted row bytes.
- [x] Story 5.3 `{content}` is surfaced as labelled legacy content and saved separately as `legacyContent`; structured `intervention.contexte` remains a catalogue value. Rendered restart/resume coverage exercises legacy edit/save and structured context, as well as current context save/restart/resume.
- [x] Configured choice fields render only their French catalogue options as touch-operable buttons; selected state is text and accessibility exposed. The parser rejects unsupported choice values while allowing blank/unselected fields. Rendered coverage checks no text input, stable persisted choice, and restart/resume.
- [x] `beam.geometry` provenance is `PROJECT_POV_DECISION` only. Nearby quantitative fields were checked against current workbook extraction; supported workbook provenance is retained only for voltage accuracy/reproducibility, output reproducibility and output linearity.
- [x] Story 5.2/5.3 behavior and requested scope boundaries are covered by the regression and boundary suites; sprint state remains Epic 5 `in-progress`, Story 5.4 `done`, Story 5.5 `backlog`.

Other initial review suggestions assessed as outside the confirmed patch scope:

- Edge Hunter: queued save overwrites another task's values — the detail screen's Back action waits for a pending save before leaving, and the write queue serializes saves; no path to a different task was demonstrated while the write runs.
- Resolved by Patch 2: legacy text now remains a separately labelled legacyContent value and is not stored in intervention.contexte.
- Blind/Edge Hunter: the qualitative `Conforme` option invents automatic conformity — it is a manually selected qualitative observation; the UX allows illustrative qualitative states and overall conformity remains an explicit Responsable decision.
- Acceptance Auditor: a separate output repeatability family is missing — the current Product Owner catalogue decision specifies output reproducibility and does not include output repeatability as a separate Story 5.4 family.
- Blind Hunter: every supported measurement family needs multi-reading capture — the approved Story 5.4 decision defines family structure only; source formulas and calculation inputs remain Epic 6 scope.
- Edge Hunter: protected form text stays visible after authorization lock — locking switches the rendered app to the sign-in surface, so protected values are no longer exposed in the UI.

### Independent post-patch review

- Edge Case Hunter: found a saved choice value could fall outside its configured options. Resolved by rejecting unsupported nonblank choice values while preserving the allowed blank state; the full mobile suite passed afterward.
- Acceptance Auditor: no remaining acceptance gaps against this story record.
- Verification Gap Reviewer: withdrew the suggestion to validate number/date value syntax because Story 5.4 requires a string-valued record and leaves type-specific validation unset; adding such validation would exceed the approved catalogue behavior.
- Blind Hunter suggestions rejected after checking the story and approved PoV decision:
  - Date picker/format validation and negative-number keyboard semantics are not specified by the catalogue; inventing format or numeric rules would exceed this patch scope.
  - Sections are grouped in one scrollable form, which allows sequential progress and revisiting earlier sections.
  - Establishment and employee/technician fields are explicitly listed by the Product Owner decision; auto-population is not specified.
  - Index-based equipment IDs pose a future catalogue-editing risk, but no current field reorder or ID collision occurs in this change.
  - Provenance classes match the required catalogue categories; the Product Owner decision permits IAEA/AAPM guidance to inform qualitative checks. The generic additional measurement remains tagged only as a project decision.

## Closure decision (2026-10-01)

The implementation was independently re-reviewed after remediation. All confirmed blocking and medium findings are resolved; no new in-scope blocking or medium findings remain. Platform-evidence gaps below are recorded limitations, not Story 5.4 product defects.

- Mobile tests: 79/79 passed, zero skipped; Story 5.2 authorization and Story 5.3 persistence/resume regressions passed.
- Recursive typechecks, generated contract check, boundary checker and `git diff --check` passed; boundary tests passed 8/8.
- Android and iOS Expo JavaScript exports passed with `--no-bytecode`. Normal Hermes bytecode export could not execute `hermesc.exe` in the Windows environment because of a permission error.
- No native Android build, native iOS build, simulator or physical-device verification, or on-device SQLCipher/SecureStore/Keychain/Keystore verification was performed.
- Story 5.4 is closed as `done`. Epic 5 remains `in-progress`; Story 5.5 remains `backlog`. No Epic 5 retrospective was started.
