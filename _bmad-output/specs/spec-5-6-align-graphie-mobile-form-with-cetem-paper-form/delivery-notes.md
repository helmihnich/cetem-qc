# Delivery notes

## Files affected

| File | Change |
|---|---|
| `packages/domain/src/graphie-identity.ts` | Catalogue version `2.0.0`, schema `3`. |
| `apps/mobile/graphie-pov-catalogue.ts` | Replace sections and fields per field-catalogue.md. Add `defaultValue`, `CETEM_PAPER_FORM` and the explicit table grouping. Add a function that returns the seeded values for a new draft. The parser logic is unchanged apart from the new field set and options. |
| `apps/mobile/App.tsx` | Render table groups (row cards on phone, row grid on tablet). Seed defaults when no draft exists. Render `date` fields as today for `intervention.date`. The section navigation must stay usable with 11 sections (scroll or wrap). Remove nothing from the save, autosave or hydration flow. Consider extracting a `GraphieTableSection` component. |
| `packages/i18n/src/fr.ts` | Only if row-label or table strings are placed there rather than in the catalogue (« Mesure {n} »). |
| `apps/mobile/graphie-pov-catalogue.test.ts` | Rewrite per test-plan.md. |
| `apps/mobile/App.render.test.tsx` | Update tuple fixtures and add table, default and v1-incompatibility cases. |
| `apps/mobile/local-drafts/local-drafts.test.ts` | Update tuple fixtures and add a v1 rejection case. |
| `packages/domain/src/graphie-calculations.test.ts` | Version-mismatch example only. |
| `apps/mobile/graphie-calculation-service.test.ts` | Version-mismatch example only. |
| `apps/mobile/local-drafts/model.ts` | No logic change expected (it reads the shared identity). Verify. |
| `apps/api/src/modules/calculations/*` | No change expected (it reads the shared identity). Verify the tests. |

Not touched: `packages/domain/src/graphie-calculations.ts`, `graphie-calculations.source-regression.ts`, API schemas and contracts.

## Sprint status (`_bmad-output/implementation-artifacts/sprint-status.yaml`)

- Add `5-6-align-the-graphie-mobile-form-with-the-official-cetem-paper-form: ready-for-dev` under epic-5.
- Set `epic-5` back to `in-progress`.
- `6-3-display-authorized-calculation-results-in-the-employe-form` stays `backlog`, with the comment `# blocked by 5-6 and the calculation rule-set v2 story (not yet created)`. The file has no `blocked` status. The 6.3 spec should later list both as dependencies and re-pin its baseline to `2.0.0`/`3`.

## Epics (`_bmad-output/planning-artifacts/epics.md`)

- A short Story 5.6 entry is added after Story 5.5 for traceability.
