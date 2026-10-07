# Review UI (web, Responsable, W4)

Strings go in `packages/i18n` (`fr.tasks` and `fr.evidence`). The keys are suggestions. The screen adds no wording of its own beyond the table below.

## Entry (W2, `task-list.tsx`)

On a row with `state = submitted`, a secondary button « Consulter les preuves » (`aria-expanded` while open). It sits in the actions cell beside the existing buttons. Draft rows do not show it. Opening one audit closes the previous panel. The replacement form and the evidence panel are never open together.

## Panel layout (in order)

1. Heading « Preuves de l’audit » with the task ID, then the context line: establishment, service, assignee, « Soumis par {displayName} », « Accepté le {date} » (fr-FR, date and time) and the revision number.
2. Lineage lines when present, as in the list: « Remplacement de l’audit X », « Remplacé par l’audit Y ». Recovery lines reuse the list wording.
3. « Données saisies »: one read-only section per catalogue section, in paper order, for every field that does not feed a calculation (identification, visual checks, comments). Each field is a label and its stored value as text, with its unit. An empty value reads « Non renseigné ». Table-shaped sections keep their rows and columns as a read-only table.
4. `GraphieCalculationReview` from 6.4 with `{ identity, values, results }` from the response: measured values, calculated values, per-test verdict, tolerance and provenance. Its note is the only conformity wording.
5. « Retour à la liste ».

## Read-only and no approval

- The only control is « Retour à la liste » (and the row button that opened the panel). No `<input>`, `<textarea>`, `<select>` or `<form>`, no approve, reject, validate, « examiné » or review-state wording, no machine conformity or summary badge.
- Text values keep line breaks (`white-space: pre-wrap`) and wrap; nothing is truncated or reformatted. A multi-line comment shows as typed.
- React renders values as text. No HTML injection (`dangerouslySetInnerHTML`) is used.

## States

| State | Rendering |
|---|---|
| Loading | « Chargement… » status in the panel. |
| 200 | The layout above. |
| 404 | « Ces preuves ne sont pas disponibles. Actualisez la liste. » The list reloads. No hint of why. |
| 403 | The standard Responsable-only message (`fr.auth.responsableOnly`). |
| 500 | « Les preuves n’ont pas pu être chargées. » with « Réessayer ». |
| Network failure | `fr.api.unavailable` with « Réessayer ». |
| Unsupported identity | The 6.4 alert « Version de règle non prise en charge — aucun calcul » plus the stored identity; measured values and the « Données saisies » block still show. |

A retry sends a new request and therefore records a new access, because the earlier request returned no evidence only if it failed before the log insert. A reopening after a successful display is a new access as well.

Focus moves to the panel heading on open and returns to the opening button on « Retour à la liste ». Status is carried by text and symbol, never by colour alone.
