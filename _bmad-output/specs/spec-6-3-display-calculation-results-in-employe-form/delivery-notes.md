# Delivery notes

## Files affected

| File | Change |
|---|---|
| `packages/domain/src/graphie-inputs.ts` (new) + `index.ts` export | `parseGraphieReading`, `isInvalidGraphieReading`, field-ID table, `graphieTestInputsFromValues` ([input-parsing-and-mapping.md](input-parsing-and-mapping.md)). |
| `packages/domain/src/graphie-inputs.test.ts` (new) | P1–P4, G1–G4. |
| `apps/mobile/graphie-calculation-service.ts` (+ test) | `calculateGraphieResults(identity, values)`; S1–S2. |
| `apps/mobile/graphie-test-result.tsx` (new) | Result block ([result-display.md](result-display.md)). |
| `apps/mobile/App.tsx` | `GraphieSectionForm` renders the blocks and the invalid-number hint; results via `useMemo` from `formValues` + identity. |
| `apps/mobile/App.render.test.tsx` | R1–R12. |
| `apps/mobile/graphie-pov-catalogue.test.ts` | C1. |
| `packages/i18n/src/fr.ts` | Result, reason, verdict, tolerance, provenance and hint strings. |

Untouched: domain formulas and tolerances, catalogue content and field IDs, identity constants, local draft envelope, API, OpenAPI, database, gate scripts, `.env`.

## Done at spec time

- `epics.md` Story 6.3 gains a traceability pointer to this spec.
- The 2026-09 planning spec in `implementation-artifacts/` is replaced by a pointer to this folder.
- `sprint-status.yaml`: `6-3-display-authorized-calculation-results-in-the-employe-form: ready-for-dev`; `epic-6: in-progress`.
- `deferred-work.md` « Re-pin the Story 6.3 spec » marked resolved.
