# Payload validation alignment (CAP-6, epic-7 retro item 20)

## Domain (`packages/domain/src/graphie-catalogue.ts`)

The payload rules are split into three exported groups. The server keeps one entry point, `validateGraphiePayload(payload, kind)`, which runs all three groups in this order and returns the same codes as before:

| Group | Rules | Code |
|---|---|---|
| Structure: `checkGraphiePayloadStructure(payload)` | object; legacy `{ content }` payload; identity tuple; allowed keys; `values` is a plain object; known field IDs; string values; choice options; `legacyContent` type | `INVALID_PAYLOAD` / `UNSUPPORTED_PAYLOAD` / `UNSUPPORTED_PAYLOAD_VERSION`, with the existing issue codes |
| Storable characters | NUL (`nul-character`, existing); **unpaired UTF-16 surrogate (`unpaired-surrogate`, new)**, in values and `legacyContent` | `INVALID_PAYLOAD` |
| Kind | `legacyContent` on a `submit` (`legacy-content-on-submit`, existing) | `INVALID_PAYLOAD` |

- Function names may change, but there must be one copy of each rule.
- Paired surrogates (emoji and other astral characters) remain valid.
- No required-field, range, unit or tolerance rule is added. Those wait for DEP-01R/02 and would come with a new rule or catalogue version.

## Device

- `parseGraphiePayload` (`apps/mobile/graphie-pov-catalogue.ts`) calls the domain structure check. It keeps only its own legacy mapping, `{ content }` → `legacyContent`. The private copies of `supportedFieldIds`, `choiceOptions` and the key list are removed. The existing parser tests in `graphie-pov-catalogue.test.ts` pass unchanged. A draft containing NUL or an unpaired surrogate stays readable, so a refused payload can be corrected.
- `parseLocalDraft` (`local-drafts/model.ts`) is unchanged. It checks the envelope and the identity tuple, not the field catalogue, and existing store tests rely on that.
- `requestSubmission` runs `validateGraphiePayload(payload, "submit")` after its existing checks and before it writes. Existing refusals keep their current error, as outbox test line 244 expects. When the payload fails, it throws `SubmissionValidationError`, which extends `SubmissionNotAllowedError`, with the domain `issues`. Nothing is written, and no snapshot or item is created. The App shows `submissionInvalid` and the issue lines (correction-ui.md). This prevents a predictable server refusal and is not a new rule.
- `save` stays permissive. Local saves never lose typed data. A `sync-draft` the server refuses keeps the 7.2 `draft-rejected` behaviour.

## Parity test

One table-driven test runs the same payloads through the domain validator and the device parser. The table includes a valid payload, each structural issue, NUL, a lone high surrogate, a lone low surrogate, a paired surrogate and legacy content. For every structural case the device and the server must agree. The character cases must stay readable on the device and must be refused by `validateGraphiePayload` and by `requestSubmission`.
