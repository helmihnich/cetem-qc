# Correction UI (CAP-1, CAP-2, CAP-3, CAP-5)

The screens reuse the existing task detail (T2–T4), together with the `alert-message`, `status` and action components. No new screen is added. Rendering lives in a small module in `apps/mobile/sync/` (for example `rejection-panel.tsx`), not inline in `App.tsx`. Its pure helpers are unit-tested.

## Refusal panel (`TaskSyncState.rejection` non-null)

It is shown with `alert-message` (role `alert`), so a toast is never the only channel. Order:

1. The « État » keeps the existing `acceptanceBlocked` label « Soumission bloquée — non acceptée par le serveur ».
2. The code message: `rejectionCodes[code]`, or `rejectionCodeUnknown` when the code is missing or unknown.
3. `rejectionIssues`, then the issue lines, from `rejectionIssueLines(issues)`, a pure helper:
   - `values.<fieldId>` that is a catalogue field → `section labelFr › field labelFr` (table cells: `section › ligne — champ`, the same label as 8.1 `diffGraphieValues`). Reuse that labelling helper; do not copy it.
   - Any other path, or an unknown field → `issueFormLevel`.
   - The text is `issueCodes[code]`, or `issueCodeUnknown`.
   - Lines appear in catalogue order, then form-level lines. Duplicates are merged. Values are never shown.
4. `rejectionOriginalKept`.
5. `rulesGated` (CAP-5).
6. Action:
   - When `canCorrect` is true, the button `createCorrection` « Créer un brouillon de correction ». It needs no confirmation: it is non-destructive and is the explicit action. It is disabled while it runs. On success, the form shows the correction draft, editable. On `CorrectionDraftError("stale")`, the outbox refreshes and the panel re-renders. Any other failure shows `correctionFailed`, keeps the panel, and nothing changes.
   - For `AUDIT_ALREADY_SUBMITTED`, no button and no conflict action is shown. The message alone is shown.

The form stays read-only while the refusal panel is shown. Soumettre, Supprimer and the retry button are not rendered.

## Correction draft (`TaskSyncState.correction` non-null, lifecycle `draft`)

- The « État » reads `correctionDraft` « Brouillon de correction ». The task list row uses the same label, plus the existing transfer suffix rules.
- The link line `correctionOf` names the refused attempt with `rejectedAt` (JJ/MM/AAAA, HH:MM, device time).
- `rulesGated` is shown.
- Issue texts of the corrected refusal appear as field error text (`errorFr`) on their fields. Form-level issues appear above the form. They are taken from the refused item's stored detail and stay until a later submit exists. They are a reminder, not a live re-check.
- Save, the sync line, Soumettre with its confirmation, and the pending lock behave as for any draft.

## Local submission refusal (CAP-6)

When `requestSubmission` throws `SubmissionValidationError`, the confirmation closes. The App shows `submissionInvalid` with the same issue lines (role `alert`), and the form stays editable. Nothing is queued.

## French strings (`packages/i18n`, `fr.employeeTasks`)

| Key (suggested) | Text |
|---|---|
| `rejectionOriginalKept` | La soumission refusée est conservée sur cet appareil, en lecture seule. |
| `rejectionIssues` | Problèmes signalés par le serveur : |
| `rejectionCodes.INVALID_PAYLOAD` | Les données du contrôle sont invalides. |
| `rejectionCodes.UNSUPPORTED_PAYLOAD` | Cette version du formulaire n’est pas prise en charge par le serveur. |
| `rejectionCodes.UNSUPPORTED_PAYLOAD_VERSION` | Cette version du formulaire n’est pas prise en charge par le serveur. |
| `rejectionCodes.INVALID_CONFLICT_REFERENCE` | La référence du conflit de synchronisation est invalide. |
| `rejectionCodes.INVALID_CORRECTION_REFERENCE` | La référence de la soumission corrigée est invalide. |
| `rejectionCodes.AUDIT_ALREADY_SUBMITTED` | Ce contrôle a déjà été soumis et accepté. Aucun brouillon de correction n’est possible. |
| `rejectionCodeUnknown` | Le serveur n’a pas accepté la soumission. |
| `issueFormLevel` | Formulaire |
| `issueCodes.unknown-field` | champ non prévu par ce formulaire |
| `issueCodes.unknown-key` | donnée non prévue par ce formulaire |
| `issueCodes.not-an-object` | structure des données invalide |
| `issueCodes.not-a-string` | type de valeur incorrect |
| `issueCodes.unknown-option` | option non prévue pour ce champ |
| `issueCodes.nul-character` | caractère non autorisé |
| `issueCodes.unpaired-surrogate` | caractère non autorisé |
| `issueCodes.legacy-content-on-submit` | contenu d’un ancien brouillon, non soumissible |
| `issueCodes.legacy-payload` | ancien format de brouillon, non soumissible |
| `issueCodes.unsupported-version` | version du formulaire non prise en charge |
| `issueCodes.invalid-reference` | référence de synchronisation invalide |
| `issueCodeUnknown` | problème non détaillé |
| `createCorrection` | Créer un brouillon de correction |
| `correctionFailed` | Le brouillon de correction n’a pas pu être créé. La soumission refusée est conservée. |
| `correctionDraft` | Brouillon de correction |
| `correctionOf` | Correction de la soumission refusée le {date} à {time} |
| `rulesGated` | Les règles d’obligation, de plage et d’unité des mesures attendent la validation du CETEM : elles ne sont pas contrôlées. |
| `submissionInvalid` | Ce brouillon ne peut pas être soumis : corrigez les points signalés. |

Keys may be renamed. Texts may change only toward EXPERIENCE.md wording. This is UI copy, not a CETEM rule. The server's own `REJECTION_MESSAGES` gains the `INVALID_CORRECTION_REFERENCE` text above.
