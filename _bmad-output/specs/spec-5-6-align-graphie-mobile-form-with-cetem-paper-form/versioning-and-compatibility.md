# Versioning and compatibility

## Identity change (`packages/domain/src/graphie-identity.ts`)

| Constant | Before | After |
|---|---|---|
| `GRAPHIE_CATALOGUE_ID` | `graphie-mobile-pov` | unchanged |
| `GRAPHIE_CATALOGUE_VERSION` | `1.0.0` | `2.0.0` |
| `GRAPHIE_FORM_SCHEMA_VERSION` | `2` | `3` |
| `GRAPHIE_CALCULATION_RULE_ID` / `_VERSION` | `cetem-workbook-explicit-formulas` / `1.0.0` | unchanged (formulas untouched) |
| `LOCAL_DRAFT_SCHEMA_VERSION` (draft envelope) | `1` | unchanged |

Mobile catalogue, draft parser, domain `withContext` guard and the API calculations module all read these shared constants, so they move together. No module may hard-code the old or new tuple.

## Behaviour by stored payload

| Stored payload | Behaviour |
|---|---|
| `2.0.0` / `3` + current rule, known field IDs, valid choice options | Loads and hydrates the form. |
| `1.0.0` / `2` (any v1 Story 5.4–6.2 draft) | `LocalDraftPayloadCompatibilityError` / `GraphiePayloadCompatibilityError`. Shows `fr.employeeTasks.draftCompatibilityUnavailable`, does not hydrate, does not write, and leaves the stored bytes unchanged. Existing explicit delete stays available as today. |
| Mixed tuples (`2.0.0`/`2`, `1.0.0`/`3`, other rule) | Rejected the same way. |
| `2.0.0` / `3` containing a removed v1 field ID (e.g. `voltage.accuracy`) or a v1 option (« Conforme ») | Rejected (unknown field / unsupported option). |
| Legacy Story 5.3 `{ content }` | Preserved as labelled legacy content, as today. When saved, it is written under the new identity with `legacyContent` and is never mapped into fields. |
| Domain call with the v1 context | `unsupported-version`. No calculation runs. |

No migration, no automatic conversion, no silent drop of v1 values.

## Defaults and versioning

Defaults are applied only when no draft exists for the task: a fresh form is seeded and then saved as usual. Hydrating an existing v2 draft never re-applies defaults, so a cleared default stays `""`.
