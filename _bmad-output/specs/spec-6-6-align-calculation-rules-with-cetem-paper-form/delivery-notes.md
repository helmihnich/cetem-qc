# Delivery notes

## Files affected

| File | Change |
|---|---|
| `packages/domain/src/graphie-identity.ts` | Rule ID/version → `cetem-paper-form` / `2.0.0`. |
| `packages/domain/src/graphie-calculations.ts` | Replace the function set with the 5 paper tests ([calculation-functions.md](calculation-functions.md)). Add the result, verdict and provenance types and export `GRAPHIE_TOLERANCES`, `TOLERANCE_EPSILON` and the comparison helper. Remove the reproducibility, normalized-mean and initial-linearity functions, the 0.49 factor, `unresolved-source-rule` and the `average` helper if it becomes unused. |
| `packages/domain/src/graphie-calculations.source-regression.ts` | Re-key the fixtures to the paper tests. Keep D26, B26/C26, D20/E20, N25, P25–P29, O40/P40–P42 (DFC 0.70) and D13:F15 (sign negated). Drop P14, O25 and Q40. |
| `packages/domain/src/graphie-calculations.test.ts` | Rewrite per [test-plan.md](test-plan.md). |
| `apps/api/src/modules/calculations/calculations.ts` | Generic return type only. Remove the `rawKermaMean` cast. No logic. |
| `apps/api/src/modules/calculations/calculations.test.ts` | Parity calls for the 5 new functions. |
| `apps/mobile/graphie-calculation-service.ts` | Expected unchanged (generic). Touch only if types fail. |
| `apps/mobile/graphie-calculation-service.test.ts` | New functions and the old-rule refusal case. |
| `apps/mobile/graphie-pov-catalogue.test.ts`, `apps/mobile/App.render.test.tsx`, `apps/mobile/local-drafts/local-drafts.test.ts` | Tuple fixtures only ([versioning-and-compatibility.md](versioning-and-compatibility.md)). No UI or component change. |
| `docs/product/graphie-calculation-rules-source-extraction.md` | Add a « Superseded by the paper form (rule `cetem-paper-form` 2.0.0) » section. It lists each workbook-vs-paper difference (sign of F13–F15, B26/C26 literals → MIN/MAX, 0.49 → (DFC/1 m)², rows 14–16 reproducibility and Q40 not on paper, O25 unused), the 4 printed tolerances with their pages, and the missing light-field tolerance. The original extraction is kept unchanged as evidence. |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | Done at spec time (see below). |
| `_bmad-output/planning-artifacts/epics.md` | Done at spec time: short Story 6.6 entry after 6.5. |

Untouched: `apps/mobile/App.tsx` UI, `graphie-pov-catalogue.ts` catalogue content, the OpenAPI contract, the database.

## Sprint status

- Add `6-6-align-calculation-rules-with-the-official-cetem-paper-form: ready-for-dev` under epic-6.
- `6-3-…: backlog  # blocked by 6-6`. The comment on 6-3 now names only 6-6, since 5-6 is done and 6-6 is the rule-set v2 story.

## Follow-ups for Story 6.3 (not done here)

- Refresh the 6.3 spec when 6.3 is planned (not edited now, by decision). It still names rule `cetem-workbook-explicit-formulas` 1.0.0 and says that no verdict is authorized. After 6.6, a *suggested* per-test verdict exists and must be shown as a suggestion, with its tolerance and paper-page provenance. Light field must show « indisponible ».
- 6.3 owns string → `number | null` parsing for the field IDs in the mapping table.
