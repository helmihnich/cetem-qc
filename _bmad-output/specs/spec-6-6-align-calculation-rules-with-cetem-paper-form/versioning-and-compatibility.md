# Versioning and compatibility

## Identity change (`packages/domain/src/graphie-identity.ts`)

| Constant | Before | After |
|---|---|---|
| `GRAPHIE_CATALOGUE_ID` / `_VERSION` / `GRAPHIE_FORM_SCHEMA_VERSION` | `graphie-mobile-pov` / `2.0.0` / `3` | unchanged |
| `GRAPHIE_CALCULATION_RULE_ID` | `cetem-workbook-explicit-formulas` | `cetem-paper-form` |
| `GRAPHIE_CALCULATION_RULE_VERSION` | `1.0.0` | `2.0.0` |
| `LOCAL_DRAFT_SCHEMA_VERSION` | `1` | unchanged |

## Behaviour

| Input | Behaviour |
|---|---|
| Domain call with the full new tuple | Calculates. |
| Domain call with `cetem-workbook-explicit-formulas` / `1.0.0` (any catalogue) | `{ status: "unavailable", reason: "unsupported-version", context }`. Nothing is computed. |
| Domain call with any one of the 5 fields mismatched | `unsupported-version`, as today. |
| Stored draft `2.0.0` / `3` + old rule (created after 5.6) | `parseGraphiePayload` throws `GraphiePayloadCompatibilityError`. The mobile app shows `draftCompatibilityUnavailable`, does not hydrate the draft and keeps the stored bytes. Explicit delete is still available. |
| Stored v1 draft (`1.0.0` / `2` + old rule) | Refused as today. |
| New draft | Stamped with `cetem-paper-form` / `2.0.0` through the shared constants (`App.tsx` already reads them). |
| Legacy Story 5.3 `{content}` | Behaves as today, and is written under the new tuple when saved. |

No migration (PoV, no real users).

## Tests that hard-code the tuple

- `packages/domain/src/graphie-calculations.test.ts` uses `ruleVersion: "2.0.0"` as the *mismatch* example. That becomes the current version, so switch it to `"1.0.0"`, and add an explicit case for the full old rule tuple.
- `apps/mobile/graphie-pov-catalogue.test.ts:45` asserts the old tuple. Update it to the new one.
- `apps/mobile/App.render.test.tsx:391, 1022` and `apps/mobile/local-drafts/local-drafts.test.ts:94` write the old rule as *current*. Switch them to the shared constants or the new literals. Lines 417, 1738 and 117 are *v1* fixtures: keep the old literals there, because they must stay refused.
- Add one mobile test: a `2.0.0` / `3` draft stamped with the old rule shows the compatibility notice and keeps its bytes unchanged.
