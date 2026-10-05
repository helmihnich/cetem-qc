# Replacement UI (web, Responsable)

All strings go in `packages/i18n` (`fr.tasks`). The keys are suggestions.

## Task list (W2, `task-list.tsx`)

| Situation | Rendering |
|---|---|
| `state = draft` | The existing « Brouillon » pill. |
| `state = submitted` | Pill `submitted`: « Soumis — accepté par le serveur ». |
| `replacementOf = X` | A line under the ID: « Remplacement de l’audit X ». |
| `replacedBy = Y` | A line under the ID: « Remplacé par l’audit Y ». The state pill is unchanged. |
| `state = submitted` and `replacedBy = null` | A secondary row button: « Créer un contrôle de remplacement ». |
| Any other row | No replacement button. |

Labels supplement the colour: `status-badge` never relies on colour alone.

## Replacement form

The button opens the existing creation form (`task-creation.tsx`) in replacement mode for that original. Reuse the component; do not copy it.

- Heading: « Créer un contrôle de remplacement ».
- Context line: « Remplacement de l’audit X. L’audit d’origine et ses mesures restent inchangés. »
- Fields, assignee loading, validation and the disabled Graphie fixe and Scopie options are the same as normal creation. Every field starts empty.
- Actions:
  - submit: « Créer le contrôle de remplacement », busy text « Création en cours… »;
  - cancel: « Annuler ». It closes the form and writes nothing.
- The request goes to `POST /api/tasks/{originalTaskId}/replacements`. Add a Next route handler with `rejectCrossOriginMutation` and the session cookie, modelled on `api/tasks/route.ts`.

## Outcomes

| Response | Message (form keeps input unless stated) |
|---|---|
| 201 | Status message: « Contrôle de remplacement créé », the new task ID, « Brouillon ». The form closes and the list reloads with both lineage lines. |
| 409 `REPLACEMENT_ALREADY_EXISTS` | « Un contrôle de remplacement existe déjà pour cet audit. » The list reloads. |
| 409 `AUDIT_NOT_ACCEPTED` or 404 | « Cet audit n’est plus disponible pour un remplacement. Actualisez la liste. » The list reloads. |
| 422 `TASK_ASSIGNEE_UNAVAILABLE` | The existing `assigneeUnavailable` text. The assignees reload. |
| 400 or 500 | « Le contrôle de remplacement n’a pas pu être créé. L’audit d’origine est inchangé. » |
| Network failure | The existing `fr.api.unavailable` text. |

- A repeated click while busy sends nothing.
- Nothing claims that a replacement exists before the 201 arrives.
