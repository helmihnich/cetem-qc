# Test plan

## `apps/mobile/graphie-pov-catalogue.test.ts` (rewrite)

1. The catalogue identity equals `GRAPHIE_CALCULATION_CATALOGUE`, which is `graphie-mobile-pov` / `2.0.0` / `3`.
2. Section IDs appear in the exact order listed in field-catalogue.md.
3. The flattened field-ID set equals the 84 IDs in field-catalogue.md (exact snapshot), and every ID is unique.
4. Every field has a non-empty French label, an allowed type and provenance, and no `required`/`min`/`max`/`allowNA`.
5. The 7 visual/mechanical choice fields have options exactly `["N.A","Oui","Non"]`. `header.interventionNature` has exactly `["Demande ponctuelle","Convention"]`.
6. No catalogue string contains « Conforme », « À signaler » or « Non vérifié ». None of the removed v1 IDs is present.
7. Defaults are exact: header.interventionNature `Convention`; instruments.kvpMeter and instruments.dosimeter brand `Fluke Biomedical`, model `8000`, serial `105991`; instruments.tapeMeasure none; voltageAccuracy row1 `50`, row2 `70`, row3 none; repeatability rows 1–5 kvDisplayed `70`; linearity rows 1–3 kvDisplayed `70`, row1 mas `10`; lightField kv `70`, mas `4`, dfr `1`. No other field has a default.
8. The table structure declares 3/5/3 rows for voltageAccuracy/repeatability/linearity, and every table cell ID is in the flattened set.
9. Units are kV / mGy / mAs / mA / m / mm, as listed. `controlPerformedBy.dateControle` is type `date`.
9a. Row labels: voltageAccuracy « KV min », « KV », « KV max »; repeatability and linearity « Mesure n ». `visual` and `mechanical` have no comment field. No field ID or label references a signature, « concluant », « Conclusion générale » or « Contrôle approuvé par ». `header.conventionNumber` is absent; header labels are « Réf. CETEMBH (Convention N°) » and « Réf. Client (N°) ».

## Payload parsing (same file)

10. A v2 payload with values across all sections round-trips unchanged.
11. A v1 payload (`1.0.0`/`2`) and the mixed tuples `2.0.0`/`2` and `1.0.0`/`3` throw `GraphiePayloadCompatibilityError`.
12. A v2 payload containing `voltage.accuracy` or a `qualitative.0` value, or a visual field value « Conforme », throws.
13. Legacy `{content}` is still preserved as `legacyContent`. The existing malformed-shape cases stay covered.

## `apps/mobile/local-drafts/local-drafts.test.ts`

14. A stored v1 draft row throws `LocalDraftPayloadCompatibilityError`, and the stored bytes are unchanged.
15. Fixtures are updated from the `1.0.0`/`2` literals to the current tuple where they test current behaviour.

## `apps/mobile/App.render.test.tsx`

16. On phone and tablet layouts, every section (11, ending with « Contrôle effectué par ») is reachable from section navigation and renders its French heading.
17. Tables on a phone render one labelled group per row (« Mesure n »). Inputs carry units and accessibility labels that include the row (e.g. « Mesure 2 — kV mesuré (kV) ») and use a decimal keypad.
18. A new draft shows the defaults (including the header choice and the Fluke instrument rows). After save, restart and resume the defaults persist. A default cleared by the user stays empty after save, restart and resume.
19. Values entered in the table cells of all three tables and in the light-field gaps survive save, restart and resume with exact strings (e.g. `"69,7"` is kept verbatim).
20. Choice fields render N.A/Oui/Non as touch buttons, expose the selected state, and persist the selection.
21. A stored v1 draft shows `draftCompatibilityUnavailable`, renders no field values, and leaves the stored bytes unchanged. The existing 1.0.0 fixture literals are updated accordingly.
22. Regressions: autosave, explicit save, delete confirmation, offline open, auth expiry/lock and legacy content all pass unchanged.

## Version-guard tests that hard-code the tuple (test-only edits)

23. `packages/domain/src/graphie-calculations.test.ts:121` and `apps/mobile/graphie-calculation-service.test.ts:43` use `schemaVersion: 3` as the "unsupported" example. Switch them to the retired `1.0.0`/`2` tuple and assert `unsupported-version`. Formula expectations stay untouched.
24. `apps/api/src/modules/calculations/calculations.test.ts` stays green with the shared identity.

## Gates

`pnpm -r test`, `pnpm -r typecheck`, the boundary checker, the generated-contract check (expect no contract diff) and `git diff --check`.
