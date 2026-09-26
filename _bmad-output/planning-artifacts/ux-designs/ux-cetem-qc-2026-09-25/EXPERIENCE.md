---
name: CETEM-QC
description: Phase 1 PoV behavior contract for Responsable web and cross-platform EmployÃ© mobile.
status: final
updated: 2026-09-26
sources:
  - ../../prds/prd-cetem-qc-2026-09-24/prd.md
  - ../../../../docs/product/
---

## Foundation

This is the finalized Phase 1 UX behavior specification for architecture handoff. The [finalized PRD](../../prds/prd-cetem-qc-2026-09-24/prd.md) overrides older material. [DESIGN.md](DESIGN.md) owns appearance; these two spines take precedence over subsequent mockups. [Source reconciliation](reconcile-product-sources.md) records reuse and exclusions across all nine product inputs. External validation dependencies remain open and are carried forward explicitly; they do not make this UX specification a draft.

Responsable web and EmployÃ© mobile are separate experiences. Reuse the source web sidebar/table patterns and touch-oriented mobile test groups. Source technology direction is React web and React Native mobile; no new UI library or storage architecture is selected. Shared tokens and vocabulary do not imply identical layouts.

Only Graphie Mobile is executable. Graphie fixe is visible but disabled; Scopie is unavailable. No employee-work validation/rejection, real email notifications, general evidence attachments, automatic PDF generation, signed-scan reintegration, full administration or collaborative multi-device editing. AI assists summary writing; human summary confirmation, human machine conformity and official report designation are separate milestones. After explicit submission request, preserve the complete local audit snapshot and make the pending audit locally read-only. This local editing restriction is distinct from authoritative submission: measurements/comments become server-accepted immutable evidence only on successful server acceptance. [PRD Â§Â§2â€“5.]

## Information Architecture

Functional surfaces below need not each become a separate route. Exact tab/section grouping remains a screen-design choice.

| ID / surface | Entry and purpose | Role / journey |
|---|---|---|
| A0 Controlled bootstrap | External deployment/administrative process creates the first Responsable; not an application surface. | Authorized project/system administrator; pre-PoV setup |
| A1 Authentication/activation | Email/password login; mandatory replacement of activation credential before tasks; authorized role landing. | Both; UJ-1/5 |
| W1 Ã‰quipe | Own-team names, email and active state; employee creation and activation/deactivation. | Responsable; UJ-1/5 |
| W1a Account created / temporary credential | Immediately after successful creation, or successful explicit pre-first-login regeneration; dedicated one-time credential display, copy and saved/shared acknowledgement. | Responsable; UJ-1 |
| W2 TÃ¢ches | Operational list: ID, type, establishment, assignee, state, last update; open detail or create. | Responsable; UJ-1 |
| W3 Create task | Graphie Mobile; required free-text establishment, free-text service, active own-team employee; no self-assignment. | Responsable; UJ-1 |
| W4 Submitted evidence | Task detail; accepted measurements/comments, calculations and applicable approved rules read-only; log access, not approval. | Responsable; UJ-1/3/5 |
| W5 Insights and summary | Review proposals, retain/discard, add manual insight, AI-assisted or manual summary, edit and explicitly confirm. | Responsable; UJ-1/3/4 |
| W6 Machine conformity | Distinct human choice after confirmed summary: Machine conforme / Machine non conforme. | Responsable; UJ-1/3 |
| W7 Report | Generate Word or upload manual PDF; inspect candidate; designate exactly one official report. | Responsable; UJ-1/3/4 |
| T1 Mes tÃ¢ches | Own assignments only; task context, business state and separate synchronization state. Responsive React Native surface across Android/iOS phones/tablets. | EmployÃ©; UJ-1/2 |
| T2 Task / control form | Current source-backed test groupings structure the UX; the definitive field and rule catalogue remains governed by DEP-01. Entry/comments, approved calculations, save/resume/edit and confirmed draft deletion. | EmployÃ©; UJ-1/2 |
| T3 Submission review | Review entered data and approved blocking errors; explicit submission request; pending versus accepted status. | EmployÃ©; UJ-1/2 |
| T4 Synchronization detail | Reachable from task/form status; per-item progress, recoverable failures and version conflicts. | EmployÃ©; UJ-2/5 |
| H1 Authorized history | Completed evidence, insights, confirmed summary, human decision, official report download and replacement linkage. | Both within authorization; UJ-1/3/5 |

Multiple active assignments per EmployÃ© are allowed. There is no employee-created unassigned audit. On server-accepted audit detail (W4 or authorized history H1), only Responsable sees Create replacement control; it enters the normal task-creation/assignment flow W3 with an explicit original audit/task link. EmployÃ© does not see this action and cannot initiate a post-acceptance replacement. Unfinished tasks of deactivated employees are flagged for explicit Responsable handling under the state-specific OD-03 rules below; no automatic reassignment. A0 is controlled bootstrap, not an application surface; after first-login password change, Responsable provisions EmployÃ© accounts and assignments in W1. EmployÃ© cannot self-register, create users/Responsables or elevate roles. No public registration, invitation acceptance, admin portal, role-selection or general Responsable-management UI.

Form information groups reuse intervention/establishment, equipment including tube/generator, measuring instruments, qualitative checks, quantitative tests and comments. Test families include voltage accuracy/repeatability, Kerma reproducibility, linearity and beam geometry. These groupings do not supply missing approved fields, units or mandatory flags (DEP-01).

## Voice and Tone

Use factual business language and a permitted next action. **All Phase 1 user-facing web/mobile copy is French**, including navigation, actions, labels, validation, synchronization states, errors, confirmations and authentication. No language selector; English and other-language UI are outside PoV scope. Never equate local saving with server submission.

Generated user-facing report content/templates use French unless the authoritative report specification later requires otherwise (DEP-03). Maintain approved CETEM BH domain terminology; when a technical term has no approved alternative, preserve its authoritative-source wording rather than invent a translation. Centralize/structure user-facing strings reasonably instead of scattering literals throughout components. A full i18n framework is not required solely for the PoV; architecture may select one if useful. Internal code, API fields, technical documentation and identifiers may remain English. French-only is a Phase 1 scope decision, not a permanent limitation.

English lifecycle and behavior names in this English-language specification denote internal concepts, not interface copy. The following French labels govern rendering; source-approved technical terminology still takes precedence.

| Concept / action | French interface text |
|---|---|
| Draft / correction draft | Brouillon / Brouillon de correction |
| Save / Submit | Enregistrer / Soumettre |
| Saving / saved locally / save failed | Enregistrement en coursâ€¦ / EnregistrÃ© sur cet appareil / Ã‰chec de lâ€™enregistrement |
| Offline | Hors ligne |
| Submission pending synchronization | Soumission en attente de synchronisation |
| Submitted, server accepted | Soumis â€” acceptÃ© par le serveur |
| Acceptance blocked | Soumission bloquÃ©e â€” non acceptÃ©e par le serveur |
| Create correction draft | CrÃ©er un brouillon de correction |
| Synchronization conflict | Conflit de synchronisation |
| Retry synchronization | RÃ©essayer la synchronisation |
| Keep local as a new revision | Conserver la version locale et crÃ©er une nouvelle rÃ©vision |
| Discard local and reload server | Abandonner la version locale et recharger la version du serveur |
| Create replacement control | CrÃ©er un contrÃ´le de remplacement |
| Replacement history links | Remplacement de lâ€™audit X / RemplacÃ© par lâ€™audit Y |
| Action required / resolution required | Action requise / RÃ©solution requise |
| Reopen / confirm summary | Modifier le rÃ©sumÃ© confirmÃ© / Confirmer le rÃ©sumÃ© |
| Unconfirmed / outdated report | Non confirmÃ© / Rapport obsolÃ¨te â€” basÃ© sur une version prÃ©cÃ©dente du rÃ©sumÃ© |
| Generate Word / upload PDF / designate official report | GÃ©nÃ©rer le rapport Word / Importer un rapport PDF / DÃ©signer comme rapport officiel |
| Temporary credential / one-time notice | Mot de passe temporaire / Ce mot de passe ne sera affichÃ© quâ€™une seule fois. |
| Copy / regenerate | Copier / GÃ©nÃ©rer un nouveau mot de passe temporaire |
| Handover acknowledgement | Jâ€™ai enregistrÃ© ou communiquÃ© le mot de passe temporaire. |
| Sign in / sign out / new password | Se connecter / Se dÃ©connecter / Nouveau mot de passe |
| Offline access expired / logged out | Reconnectez-vous Ã  Internet et authentifiez-vous pour accÃ©der Ã  vos donnÃ©es conservÃ©es sur cet appareil. |
| Deactivated account | Compte dÃ©sactivÃ©. Lâ€™accÃ¨s et la synchronisation sont bloquÃ©s. Les donnÃ©es locales non synchronisÃ©es sont conservÃ©es. |

| Condition | Proposed copy / meaning |
|---|---|
| Unsaved / saving | Unsaved changes / Savingâ€¦; French equivalent if confirmed: Modifications non enregistrÃ©es / Enregistrement sur cet appareilâ€¦ |
| Confirmed local save | Saved locally; optional last-successful-save time. Offline: saved on this device, may not yet be synchronized. Never claim durability before successful persistence. |
| Local save failed | Save failed â€” current changes are not saved. Preserve the last successfully saved draft; offer retry without implying newer measurements are protected. |
| Offline | Hors ligne. Show local save state separately; do not promise unsaved data is durable. |
| Draft transfer status | Draft â€” saved locally, not yet synchronized. Draft remains the lifecycle state; this secondary transfer status is not Pending synchronization submission status. |
| Synchronized draft | Brouillon synchronisÃ© â€” non soumis. |
| Queued submission | Submission pending synchronization. Not yet server-accepted/Submitted; audit locally read-only. French equivalent if confirmed: Soumission en attente de synchronisation. |
| Accepted submission | Soumission acceptÃ©e par le serveur Ã  [heure]. Mesures et commentaires en lecture seule. |
| Conflict | Versions diffÃ©rentes. Vos donnÃ©es locales sont conservÃ©es. Synchronisation suspendue. |
| Non-conflict validation rejection | Acceptance blocked â€” submission NOT accepted by the server. Show the specific validation problem when safe and understandable; offer Create correction draft. Do not label this a synchronization conflict or employee-work rejection. |
| Correction draft | Correction draft â€” editable; linked to the original rejected submission attempt. Not Submitted. |
| AI failure | Assistance IA indisponible. RÃ©essayer ou rÃ©diger le rÃ©sumÃ© manuellement. |
| Zero retained insights | Aucun constat retenu. This is valid, not a completion error. |

Machine non conforme is an ordinary human business outcome. Input validation is distinct from prohibited employee-work approval/rejection. No email-sent or invitation-delivered claim.

## Component Patterns

Names match DESIGN.md Components. {colors.primary} and {colors.error} supplement labels and do not carry meaning alone.

| Component | Behavioral contract |
|---|---|
| `app-shell` | Separate role spaces, authorized navigation and safe direct-access refusal; preserve task context. |
| `button-primary` | Explicit current action; busy differs from acknowledged success; repeated requests cannot create duplicate submissions/official outcomes. |
| `button-secondary` | Copy on W1a copies the currently displayed temporary credential with non-secret success/failure feedback, never acknowledges handover automatically. Back/cancel/retry where permitted; preserve input. After submission request, no cancellation to resume editing or modification of the pending audit; synchronization retry remains available. |
| `button-destructive` | Explicitly confirm draft deletion; never delete accepted evidence. Pending/local recovery constraints remain OD-01/02. |
| `form-field` | Persistent label/unit/help, approved validation, retained invalid input; accepted evidence readable but not editable. |
| `task-list` | Open authorized task; distinguish empty assignments, load failure and uncached offline content; show per-item sync status. |
| `status-badge` | Business lifecycle separate from connectivity/durability/transfer; no audit-approved/rejected states. |
| `sync-status` | Show lightweight Saving / Saved locally / Save failed separately from connectivity, transfer and submission. No routine autosave-success dialogs. Local saving leaves lifecycle Draft; open details on transfer/submission pending, errors or conflicts. |
| `audit-sections` | Test-organized navigation and progress with free revisiting; no EmployÃ© insight-selection workflow. |
| `measurement-result` | Defined calculations available offline; individual verdict only with established threshold/comparison/boundaries. Overall conformity never inferred. |
| `insight-item` | Responsable retains/discards post-submission factual proposals with provenance; authored/dated manual text with optional justification; zero retained valid. |
| `summary-editor` | AI only on request, grounded in audit data/retained insights; editable initial draft and explicit confirmation; manual entry always available. Preserve actual AI input/requester/date/model/initial output, never fabricate provenance for manual text. Before official designation, explicit Reopen summary returns to unconfirmed editing and preserves prior confirmation/version; invalidate current conformity and dependent reports under OD-10. After designation, summary/decision locked. |
| `conformity-decision` | After summary confirmation, explicit human Machine conforme / Machine non conforme; neither preselected nor AI-derived. |
| `report-panel` | Word generation or manual PDF upload; inspect and explicitly designate one official report. Regenerate/replace draft candidates before designation; completed official record frozen. |
| `history-record` | Authorized read-only evidence, insights, summary, decision/report; show Replacement for Audit X / Replaced by Audit Y links within access permissions. Original stays unchanged and accessible. Only Responsable can initiate Create replacement control from a server-accepted audit; EmployÃ© never sees/executes this action. Download the correctly linked official file. |
| `alert-message` | Persistent actionable errors with relevant recovery; toast never the sole conflict/data-preservation channel. |
| `confirmation-dialog` | Clear consequence and action/cancel; predictable focus return. Conflict offers explicit keep-local-as-new-revision or discard-local-and-reload-server actions; explain discard before confirmation. Dismissing the dialog does not resolve the conflict or unlock pending work. |
| `loading-state` | Localized progress, preserve usable cached content/input; busy never means success. |
| `empty-state` | Explain specific absence and authorized next step; zero insights, missing rules, no tasks and failed fetch remain distinct. |

### Temporary credential handover â€” OD-09

After successful account creation in W1, the system generates a temporary first-login credential and immediately opens W1a for the Responsable. Show the account identity, the credential, **Shown only once**, a simple **Copy** action and an explicit acknowledgement such as **I have saved/shared the temporary credential** before leaving through application controls. Copying alone does not acknowledge handover. The Responsable communicates it outside the application, preferably in person for the PoV; do not require the system to know how it was communicated or claim verified delivery.

Do not redisplay the credential after leaving/dismissing the screen, including return navigation. Application interruption must not become a way to recover the old credential; lost access uses regeneration. Do not store or expose the credential in normal employee details, history, logs or audit screens; no show-existing-password capability. Event traceability must not include the secret value. Credential verification/storage design remains architecture's responsibility.

If lost or expired before first login, the Responsable explicitly selects **Regenerate temporary credential** from the authorized employee-management context. Successful regeneration invalidates the previous temporary credential and displays the new one once through the same handover flow. Do not infer an expiry duration or extend this into an unspecified post-activation password-reset workflow.

The EmployÃ© authenticates with the temporary credential in A1 and must choose a new password before accessing tasks. First-login-only use and forced password replacement remain binding. Manual handover is a PoV onboarding mechanism; no email, SMS or external delivery integration is required. Architecture must allow a later production onboarding mechanism rather than make manual handover permanent.

### Reopening a confirmed summary before finalization â€” OD-10

The Responsable may explicitly select **Edit confirmed summary / Reopen summary** only before official report designation/finalization. Explain that reopening removes the current confirmation, invalidates any current conformity decision based on it and makes dependent report drafts outdated. Never silently change a confirmed summary.

On reopening, return the summary to editable/unconfirmed state. Preserve the previously confirmed version and its confirmation metadata as history. Any prior human conformity decision also remains historical but is no longer the current decision; never copy, preselect or infer it as the new decision. This invalidation occurs on reopening, not only after a changed text is saved.

After editing, require explicit confirmation of the updated summary with new confirmation actor/date. The prior confirmation remains historical. Then require the Responsable to make/confirm the human conformity decision again. Only after these current gates are satisfied may the generated draft report be regenerated. Mark previous dependent drafts **Outdated / Superseded â€” based on a previous summary**; never silently rewrite a generated artifact or permit an outdated report to be designated official.

Maintain **Measurements/results â†’ Insights â†’ Summary confirmation â†’ Human conformity decision â†’ Report generation â†’ Official report designation/finalization**. Changes to an upstream confirmed element before finalization require explicit reconfirmation or regeneration of dependent downstream decisions/artifacts. This does not permit editing server-accepted measurements or introduce unapproved upstream-edit controls. For the existing manual-PDF route, an artifact based on superseded content cannot remain current or become official; obtain a current replacement through the existing manual upload flow after the summary and human decision are current. Do not infer automatic PDF generation or PDF-content verification.

After official designation/finalization, lock the underlying summary and conformity decision for the PoV; do not show an enabled reopen action. Post-finalization amendment/correction of that record is outside PoV unless CETEM BH later specifies it. This does not remove OD-03's separate creation of a new independent replacement control with the original unchanged. Apply identical rules whether the summary originated from AI or was written manually.

## State Patterns

### EmployÃ©-mobile durability, transfer and submission

Connectivity, local durability, draft synchronization and authoritative submission are independent dimensions per audit. Online does not mean synchronized; synchronized does not mean submitted. One EmployÃ© mobile session actively edits an audit; automatic multi-device field merge is excluded.

| State / trigger | Presentation and behavior | Exit / boundary |
|---|---|---|
| Editing, unsaved | Explicit unsaved state; retain entered values. No claim of restart durability yet. | Autosave shortly after meaningful field changes/appropriate lifecycle events, or explicit Save; no network prerequisite. |
| Saving locally | Local progress, no premature saved/queued acknowledgment. | Durable write confirmed or local-save error. |
| Locally saved | Device acknowledgment/time; saved draft survives normal mobile-app restart. Lifecycle remains Draft. | Further editing or separate draft transfer status; never a submission transition from saving. |
| Offline | Separate connectivity label; all sections of previously synchronized tasks and defined calculations usable. | Reconnect does not itself indicate transfer completion. |
| Task not cached | Explain unavailable on this device until synchronized; no misleading empty usable form. | Authorized successful online fetch. |
| Draft not yet synchronized (transfer status only) | Locally saved Draft with separate transfer status, not the Pending synchronization submission state. Save/autosave does not change its lifecycle. | Separate transfer acknowledgment/failure/conflict leaves submission unrequested; only explicit Submit can enter the pending-submission lifecycle. |
| Draft synchronized | Explicitly still not submitted. | Further editing or explicit submission request. |
| Submission pending synchronization | Preserve complete local audit snapshot; audit locally read-only, no modification or cancellation to resume editing. Display Submission pending synchronization, not Submitted. Synchronization retry allowed. | Server acceptance transitions to Submitted; failures preserve pending data and local read-only restriction. Acceptance-blocking conditions enter explicit resolution state. OD-02a resolved by user. |
| Transfer in progress | Per-item progress; avoid duplicate outcomes. | Transport success alone does not prove authoritative acceptance. |
| Server accepted | Acceptance/actor/date evidence; measurements/comments now read-only and available to Responsable. | No in-place evidence reopening; material correction needs independent linked audit. |
| Transfer failure / acknowledgment unknown | Preserve complete pending snapshot and local read-only state; show pending/uncertain status and allow synchronization retry without duplication. Never automatically return to editable Draft. | Definitive server outcome; never infer acceptance from connection or timeout. |
| Server field validation failure / other non-conflict acceptance blocker | Acceptance blocked; explicitly NOT accepted by server. Preserve the original snapshot read-only, show the specific validation problem when safe and clear. | EmployÃ© explicitly selects Create correction draft, without Responsable intervention solely for validation rejection. Never unlock/modify the original or classify validation rejection as a synchronization conflict. |
| Correction draft | New editable draft initialized from the rejected pending snapshot; linked to the original rejected submission attempt. Original remains preserved read-only and never overwritten. | EmployÃ© corrects what is necessary and submits through the normal flow; new submission becomes locally read-only pending acceptance. This action is unavailable for server-accepted audits. |
| Version conflict | Stop synchronization for this audit; preserve the complete local version; retrieve/display current server metadata and clearly identify the conflict to EmployÃ©. Pending submission remains locked. | Require explicit keep-local-as-new-revision/replacement-draft or discard-local-and-reload-server action, as detailed below. No direct stale overwrite or automatic field merge. Resolve before submission retry. |
| Local save failure | Prominent Save failed feedback and retry; preserve the last successfully saved draft and retain current input where possible. Do not imply unsaved measurements are protected or survive restart. | Only a confirmed successful local write may show Saved locally. Lifecycle remains Draft. |
| Offline access within configured window | Authenticated EmployÃ© may reopen offline and access permitted locally available tasks/audits for up to 7 days from the last successful server authentication. Existing draft/pending/accepted editing restrictions still apply. | Only successful online re-authentication resets the period; app reopen, local save or connectivity alone does not. |
| Offline access expired | Block offline work and access to preserved local data; explain that reconnection and successful authentication are required. | Successful online re-authentication restores access subject to current account status/permissions. Preserve all local work; server authorization revalidation precedes synchronization. |
| Known account deactivation | On reconnect and discovery of deactivation, do not restore working access or allow sync as that user. | Preserve unsynchronized work for explicit administrative recovery; exact mechanism may remain outside PoV. Flag unfinished tasks for explicit Responsable action under OD-03, preserving original attribution; no automatic reassignment. |
| Explicit logout | Immediately end offline-access authorization; unused seven-day window cannot be reused. Preserve drafts, pending submissions, rejected snapshots, correction drafts and unsynchronized work securely but inaccessible. | Reopening requires successful online authentication and identity/current-authorization revalidation before restoring access or synchronizing. Successful authentication starts a new offline window. Deactivated account remains denied, with data preserved for administrative recovery. |

### EmployÃ©-mobile draft persistence â€” autosave and explicit Save

While an audit is an editable Draft, automatically persist meaningful field changes shortly after entry and on appropriate lifecycle events such as navigating between audit sections. Use secure local draft storage and work without network connectivity; local saving does not require or acknowledge server synchronization. Keep a visible **Save** action that deliberately writes the current editable state to the same storage. Use distinct labels and action placement for **Save** and **Submit**.

Show lightweight **Savingâ€¦**, **Saved locally** and **Save failed** feedback. When offline, explain that successfully saved work is on this device but may not yet be synchronized. Do not interrupt routine measurement entry with success dialogs after each autosave. On persistence failure, clearly warn, preserve the last successfully saved draft and never claim newer unsaved measurements are protected. Online Save also must not imply server synchronization unless that transfer has actually succeeded.

**Editable Draft â†’ autosave / Save â†’ remains Draft.** Only explicit submission may cause **Draft â†’ Pending synchronization â†’ Submitted after server acceptance**. A separate draft-transfer indicator does not change this lifecycle or authorize submission. Autosave never submits, queues submission or transitions Draft to Pending synchronization/Submitted.

Once explicit submission creates the immutable pending snapshot, normal draft editing/autosave must not change it, consistent with OD-02a. Autosave callbacks or later Save actions cannot mutate the pending snapshot. Editable correction drafts use ordinary Draft saving; their preserved originals remain untouched. Exact debounce timing is an implementation/architecture decision, not a CETEM BH-required value supplied by this UX specification.

### Offline authentication â€” configurable PoV policy (OD-01)

Record the time of the last successful server-authenticated session. The configured Phase 1 offline-access period is **7 days**, renewed by each successful online re-authentication. During that period, offline reopening permits only the locally available work authorized for that EmployÃ©. Once the period has expired, block further offline work and local data access until successful online re-authentication.

Expiry must never delete local drafts, pending submissions, rejected snapshots, correction drafts or other unsynchronized work. Keep those data inaccessible until successful re-authentication; restore access only where the employee's current authorization/account status permits. Do not synchronize before the server revalidates authorization. Failed authentication or simply reconnecting does not restore access or renew the window.

When reconnection reveals account deactivation, deny working access and synchronization as that user. Preserve unsynchronized data for an explicit recovery/administrative process; its exact mechanism may remain outside the PoV. Do not imply an implemented administrative recovery screen or silently remove preserved work.

Offline credentials/session material and local audit data use the secure local-storage approach required by the PRD. **The 7-day offline permission is not a 7-day server access-token lifetime.** Online session/token expiration remains an authentication architecture decision. Make this PoV setting configurable and review it before production deployment; it is not a permanent production security policy.

**Deliberate logout ends the offline authorization immediately.** The remaining seven-day period cannot be reused. Reopening after logout requires successful online authentication before any local audit/task data is accessible. Revalidate the employee's identity and current permissions before restoring access or synchronizing; successful authentication starts a new offline-access window. Never delete preserved drafts, pending submissions, rejected snapshots, correction drafts or other unsynchronized data on logout. A deactivated account receives no working access or synchronization; keep its local data for the previously defined recovery/administrative handling.

Application close/restart, device restart, temporary loss of connectivity and normal server-token expiration **do not by themselves cancel** offline authorization. They neither reset its start time nor extend its seven-day limit. Normal token expiry still requires the online authentication handling chosen by architecture for server operations; it does not itself revoke otherwise-valid offline access. These logout and restart rules are part of the configurable PoV offline-security policy, not a permanent production policy.

### Explicit synchronization conflict resolution â€” OD-02b

1. Stop synchronization for the affected audit. Preserve the complete local version and, for pending submissions, the original pending snapshot for traceability until resolution is complete. Keep the pending audit locally read-only; conflict is not cancellation back to normal editing.
2. Retrieve and display current server-version metadata alongside local context (available version identifiers and dates). If metadata retrieval fails, show that failure and permit retrieval retry; do not fabricate current server metadata or claim resolution.
3. Show a clear conflict state to the EmployÃ© and require an explicit action:
   - **Keep local version and create a new synchronized revision / replacement draft.** Use the preserved local version as the new revision/draft; never overwrite the current server version directly from the stale local draft.
   - **Discard local version and reload server version.** Explain the loss of the local working version and require explicit confirmation. The original pending snapshot still remains preserved for traceability until resolution completes; discarding working data is not immediate deletion of that snapshot.
4. Keep the conflict unresolved if the selected operation fails or has not completed; preserve data and the pending lock. Do not automatically switch to the other option, merge fields, overwrite a version or resume submission.
5. Resolve the conflict before allowing submission retry. A successful resolution is not server acceptance of a submission; only acceptance transitions to Submitted. Loading a server version must respect its actual lifecycle, including read-only accepted evidence.

No automatic merge, collaborative editing or multi-device reconciliation is included in the PoV. These pre-acceptance conflict choices do not define OD-03's separate replacement-audit initiation after a material error in accepted evidence. Post-resolution revision identity/linkage, snapshot retention beyond resolution and any new-draft submission handoff must remain traceable implementation details without silently unlocking the original pending snapshot or claiming acceptance.

### Explicit correction of a non-conflict acceptance blocker

1. Show **Acceptance blocked** and clearly state that the server did not accept the submission. Communicate the specific validation problem where safe and understandable; do not expose sensitive server details or invent missing validation rules.
2. Keep the original rejected pending snapshot preserved and read-only. Never automatically modify, unlock or overwrite it.
3. Offer **Create correction draft** to the EmployÃ©. On explicit action, initialize a new editable draft from that snapshot and link it to the original rejected submission attempt for traceability. No Responsable intervention is required solely because server validation rejected the attempt.
4. In the correction draft, the EmployÃ© corrects what is necessary, then uses normal review/submission. The original rejected attempt remains preserved separately. Creation failure leaves the original untouched and does not claim that an editable correction draft exists.
5. On requesting submission of the correction draft, apply the usual pending read-only rule; only server acceptance marks it Submitted. Ordinary network failure or uncertain acknowledgment is not evidence of validation rejection and does not authorize this correction path.

The UX sequence is **Draft â†’ Pending synchronization â†’ Acceptance blocked â†’ Correction draft**, followed by normal submission. **Submitted (server accepted)** is a separate authoritative state. A server-accepted audit cannot be altered using an ordinary correction draft: post-acceptance corrections use the separate replacement/new-control workflow (OD-03: Responsable-only initiation, independent linked task and normal assignment). Validation rejection is not synchronization conflict; do not offer OD-02b's conflict-resolution options as its recovery.

T3/T4 expose the acceptance-blocked attempt and explicit correction action; T2 hosts the new editable correction draft with its originating-attempt link. The existing form, status, alert and action components cover these states; no new administration surface is introduced.

### Replacement after server acceptance â€” OD-03

Only the Responsable explicitly initiates **Create replacement control** from a Submitted/server-accepted audit. The EmployÃ© cannot independently create this replacement and does not see its action. This is a new independent audit/task, with its own lifecycle, measurements, timestamps, calculations, insights, summary, human conformity decision and report. Do not treat the original's evidence, decisions or report as the replacement's results.

Retain an explicit link to the original audit/task. Creating a replacement never automatically changes the original's status or measurements: the accepted original remains immutable and accessible in authorized history. Display **Replacement for Audit X** on the new record and **Replaced by Audit Y** on the original as traceability relationships, not automatic status changes.

The Responsable assigns the new task to an EmployÃ© through normal assignment. That EmployÃ© performs it like any other assigned task. Creation/assignment progress and failure use W3's normal states; do not claim a replacement exists before successful creation or modify the original on failure. No new copy-forward or transfer policy is inferred.

Keep the three recovery paths distinct: EmployÃ© may create a correction draft after server validation rejection; synchronization conflicts follow OD-02b; only Responsable initiates a replacement after server acceptance. A linked pre-acceptance correction/conflict draft does not grant authority to create a post-acceptance replacement.

### Unfinished tasks after employee deactivation â€” OD-03

Once deactivation is known, prevent new authenticated work by that employee and enforce OD-01 access/synchronization restrictions. Preserve existing tasks, audits and history. In W2/task detail, clearly label the deactivated assignee and flag unfinished tasks **Action required**. The Responsable explicitly selects a reassignment/recovery action; deactivation itself never reassigns a task.

| Work state | Explicit Responsable handling | Preservation and limits |
|---|---|---|
| No audit work started | Reassign the existing task to another active EmployÃ© through the authorized assignment controls. | Preserve assignment history. Absence of a server draft alone is not proof that no tablet-only work exists. |
| Editable draft synchronized to server | Create/restart the working audit for the newly assigned employee. | Preserve the previous employee's draft, attribution and history. Never relabel their measurements as authored by the new employee or silently transfer ownership of their measurement record. |
| Unsynchronized work only on deactivated employee's tablet | Surface the known task as needing recovery/action, without claiming its local data has reached the server. | No synchronization under the deactivated user after authorization failure. Preserve local work under OD-01. Administrative recovery is separately unresolved/out-of-PoV unless specified later; no invented extraction/transfer action. |
| Pending submission or other preserved immutable snapshot | Surface **Resolution required** to the Responsable and retain the task/snapshot. | Never silently reassign, modify or delete it. The reassignment control is not a way to unlock or rewrite a snapshot. This decision does not specify a new administrative snapshot-recovery mechanism. |

Use W2/task detail as the explicit reassignment/recovery entry and W3's normal active-employee selection where reassignment is permitted. Where recovery has no specified PoV mechanism, explain the limitation rather than claim a completed recovery. Preserve both prior and new employee attribution visibly in related records/history. Do not infer server possession of offline data or bypass current authorization to retrieve it.

### Surface states

Every interactive surface requires visible focus, meaningful labels and safe permission-denied handling without cross-team disclosure. No offline Responsable editing capability is inferred.

| Surface | Empty / loading | Error / offline / denied |
|---|---|---|
| A1 | Empty credentials; sign-in/activation progress. | Generic invalid credentials, inactive account, password-change failure; offline reopen within the configured 7-day window; expired access requires online re-authentication; deliberate logout also requires fresh online authentication before local access, regardless of unused offline time. |
| W1 | No employees; create/update progress. | Required names, invalid/duplicate email; retain fields on failure; preserve task/history on deactivation. |
| W1a | Show credential only after successful account creation/regeneration; make generation progress distinct from success. Copy acknowledgment contains no secret. | Copy failure stays on the same one-time screen, explains failure and permits retry/manual copying. No false copied/delivered claim. Regeneration failure does not claim a new credential or completed invalidation. Lost/dismissed/interrupted display uses explicit regeneration, never redisplay of the old secret. Require explicit acknowledgement before normal in-app departure. |
| W2â€“W3 | No tasks / eligible employees; list/create progress. | Unavailable assignee, required establishment, permission/network failure; no success before server acknowledgment. |
| W4 | Awaiting accepted submission differs from missing evidence; result load. | Fetch/permission failure; unavailable rule not a pass; accepted evidence remains read-only. |
| W5 | Empty summary differs from valid zero insights; AI/save/reopen progress; reopened summary editable/unconfirmed with previous version available in history. | Retry/manual fallback, preserve text; failed confirmation never labeled confirmed. Failed reopening does not claim success. Official designation locks reopening. |
| W6 | Nothing selected; decision-save progress; previous decision historical after summary reopening. | Require current summary confirmation and a new explicit human decision; no carried-forward choice. Failed save is not a recorded decision. |
| W7 | No candidate; generation/upload/designation progress; dependent old drafts visibly Outdated/Superseded. | Manual PDF lifecycle is Selecting â†’ Uploading â†’ Validating â†’ Security scan â†’ Ready â†’ explicit designation. Reject non-PDF, >20 Mo, protected/encrypted, corrupt/unreadable/structurally invalid/truncated or unsafe files. Scan failure/incomplete blocks designation and offers retry. Gate designation on current summary, human decision and current Ready report; regenerate dependent generated drafts, never silently modify old files. Failed designation is not completion. |
| T1 | No assignments versus no cached tasks; refresh. | Unreachable server, stale context, per-item pending state; authorization recovery preserves local data. |
| T2â€“T3 | Unstarted versus saved draft; save/submit progress. | Full EmployÃ©-mobile state table; approved field errors and missing rule dependencies distinct from accepted read-only view. |
| T4 | Nothing pending versus unknown status; per-item progress. | Retryable failure, conflict, uncertain acceptance and authorization failure distinct. |
| H1 | No completed records; load/download progress. | Download failure preserves correct link; authorization enforced; no promise of offline report availability. |

## Interaction Primitives

Web actions support keyboard and pointer; tablet actions are touch-visible without hover-only controls or mandatory zoom. Focus follows reading order; dialogs return focus to invokers. No gesture is the sole saving/submission/recovery mechanism.

Submission, summary confirmation, human conformity and official designation require explicit intent and distinct consequences. This does not mandate a second modal for every action. Draft deletion and conflict discard require confirmation. Preserve saved work during navigation/restart. Pending submission cannot be cancelled or modified; retry synchronization is permitted unless a conflict first requires explicit resolution under OD-02b. Non-conflict validation rejection permits explicit Create correction draft as described above, never unlocking the original. The offline-access window is the configured 7-day PoV rule; no autosave interval or online token lifetime is inferred.

## Accessibility Floor

Retain source requirements for visible keyboard focus, persistent labels, text alongside semantic color, understandable corrections, generous touch areas and no mandatory zoom. Associate errors with fields and make multi-section submission errors reachable. Announce meaningful save/submission/error transitions without continuously interrupting input. Read-only values remain accessible.

{typography.body.fontSize} is inherited web guidance, not an approved mobile size. Honor text scaling and keep values, units, errors and statuses readable. DESIGN.md records palette evidence; rendered boundaries, focus, screen-reader behavior and touch usability still need verification. Device ergonomics and any formal acceptance target remain OD-05; this specification makes no accessibility-conformance claim.

## Responsive & Platform

Responsable web uses stable navigation and comparison tables. EmployÃ© uses one responsive React Native experience across Android smartphone/tablet and iPhone/iPad: vertically reflowed phone forms, optional multi-column tablet layouts where useful, portrait phone support and practical landscape support. Avoid fixed widths, mouse/hover-only behavior and rotation blockers; keep primary actions reachable, numeric keyboards appropriate, validation near fields, and Save distinct from Submit. Preserve identity, units, statuses and complete error messages at both sizes. Offline/local-save/pending/conflict/correction/unsynchronized-data behavior is identical across platforms. Exact Android/iOS/iPadOS versions, representative devices and formal acceptance owner remain open; no glove/outdoor-brightness requirement is assumed. No platform-specific workflow, PWA replacement, dark mode or extra language support is silently added.

The critical EmployÃ© journey must be mocked and validated on at least one representative Android smartphone, Android tablet, iPhone and iPad viewport. Shared responsive React Native components are preferred; separate implementations are justified only where a platform genuinely requires it, without changing business behavior.

## Inspiration & Anti-patterns

Reuse the existing guide's calm professional design, web navigation/table pattern, touch test groups, persistent offline feedback and discreet AI assistance. Exclude obsolete approval/rejection, actual assignment email, automatic conformity, presenting a locally read-only queued audit as server-accepted, automatic merge, mandatory AI and signed scans. Illustrative dashboards/equipment management are not requirements. [Source reconciliation](reconcile-product-sources.md) preserves details.

## Key Flows

Salma (Responsable) and Sami (EmployÃ©) are illustrative journey names, not new business personas. Titles mirror PRD Â§4; open transitions remain explicit.

### UJ-1 â€” Assigned field control to official report.

1. Salma creates Sami's account in W1. W1a shows the generated temporary credential once; she copies/saves it, explicitly acknowledges saved/shared status and hands it over outside the application, preferably in person. No delivery tracking or email is required. Sami authenticates in A1 and chooses a new password before task access. A credential lost/expired before first login is explicitly regenerated by Salma, invalidating the old one and repeating the one-time display.
2. Salma creates and assigns Graphie Mobile in W3. Sami sees his assignment in T1 through in-app visibility, without email delivery.
3. Sami synchronizes, enters measurements/comments in T2 and checks authorized calculations. Autosave persists meaningful changes and section navigation locally, including offline; visible Save provides deliberate persistence. Saved locally follows confirmed persistence, while the audit remains Draft; sections stay revisitable.
4. In T3 he explicitly requests submission. The complete local snapshot is preserved and the pending audit becomes locally read-only, with no cancellation or modification. Only server acceptance changes it to Submitted and establishes accepted immutable evidence.
5. Salma reads W4, retains/discards proposals or adds manual insights in W5. Zero retained insights is valid.
6. She requests an AI draft or enters manual text, edits and explicitly confirms; then separately decides machine conformity in W6.
7. In W7 she generates/inspects Word OR uploads/inspects manual PDF and designates exactly one official report. Draft candidates may be regenerated/replaced before designation.
8. **Climax:** completion and the correctly linked official report are visible in H1. Handwritten signature after printing does not gate software completion.

Before step 8, if Salma explicitly reopens the confirmed summary, the old summary/confirmation and conformity decision become historical, and dependent report drafts become outdated. She edits and reconfirms, makes the human decision again and regenerates the report (or replaces an outdated manual PDF through its existing route) before designation. After step 8, summary/decision reopening is unavailable for the PoV.

Failure: preserve data on input/save/network errors; follow UJ-4 for AI failure; report failure permits retry without claiming completion. Exact fields/template remain DEP-01/03.

### UJ-2 â€” Network interruption.

1. Sami opens a previously synchronized task, then loses connectivity.
2. All field sections and defined calculations work offline. A successful local write produces device/time acknowledgment.
3. After a normal app/tablet restart he resumes the saved draft.
4. His complete submission snapshot remains locally read-only with Submission pending synchronization displayed. He may retry synchronization but cannot cancel to resume editing or modify the audit.
5. Reconnection starts per-item transfer; retries reconcile the server result without duplication.
6. **Climax:** explicit server acceptance makes measurements/comments read-only and available to Salma.

Failure: network/sync failure retains the read-only pending submission and data, never automatically editable Draft. On conflict, Sami sees current server metadata and explicitly keeps his local version as a new synchronized revision/replacement draft, or confirms discarding the local working version and reloading the server version. Original pending snapshot remains traceable until resolution completes; submission retry waits for resolution. No direct stale overwrite, automatic merge or silent unlock. For a non-conflict validation rejection, Sami sees Acceptance blocked and the safely communicated problem, then explicitly creates a linked editable correction draft from the preserved rejected snapshot. He corrects necessary values and submits normally; the original is never unlocked or overwritten. Expiry blocks local access until successful online re-authentication; restore only current authorization, revalidate before sync. Known deactivation blocks working access/sync and preserves data for explicit administrative recovery, never deletion. Lost acknowledgment remains uncertain until reconciled.

### UJ-3 â€” Normal and nonconforming outcomes.

1. Salma reads accepted evidence; absent tolerance rules are not replaced with guessed badges.
2. She reviews insights, legitimately retaining zero or more, then confirms the summary.
3. She explicitly selects Machine conforme or Machine non conforme; calculations and AI do not choose it.
4. She follows either report route and designates the official file.
5. **Climax:** both outcomes complete normally, with unchanged evidence and the human decision visible in history.

Failure: missing rules remain identifiable; no invented zero, N.A., pass/fail or overall verdict. Missing confirmation/decision cannot be bypassed.

### UJ-4 â€” AI unavailable.

1. Salma requests assistance in W5 using audit data and retained insights.
2. The request fails; existing text remains, with retry and manual entry available.
3. She writes manually or retries and edits generated text. Manual-only content has no fictitious AI metadata.
4. She explicitly confirms, makes the human decision and follows either report route.
5. **Climax:** the same human-controlled completion is possible without AI availability.

Failure: failed text saving/confirmation retains input but never claims confirmation. Explicit reopening before official designation follows OD-10's same historical preservation, reconfirmation, fresh human decision and report-regeneration rules for manual and AI-assisted summaries.

### UJ-5 â€” Material submitted error or employee deactivation.

1. Salma identifies a material error in accepted evidence, or deactivates an employee through W1.
2. For a material error in accepted evidence, only Salma sees and explicitly selects Create replacement control. A new independent audit/task is linked to the original; its status and measurements remain unchanged. Sami cannot initiate this action.
3. Salma assigns the replacement through normal W3 assignment; the assigned EmployÃ© performs it with its own measurements, calculations, insights, summary, conformity decision and report. History shows Replacement for Audit X / Replaced by Audit Y while preserving the original.
4. In the deactivation branch, new login/work/authorized synchronization is prevented while history and unfinished-task visibility remain. A disconnected mobile device may discover this only at reconnection.
5. Salma sees the deactivated assignee and Action required on unfinished tasks. She explicitly reassigns an unstarted task to an active EmployÃ©, or creates/restarts working audit for that employee while preserving any synchronized editable draft and its original attribution. Pending/immutable snapshots are flagged for resolution, not silently transferred.
6. Work stored only on the deactivated employee's mobile device remains preserved under OD-01, without claiming the server has received it or synchronizing as the deactivated employee. Administrative recovery remains separately unresolved/out-of-PoV.
7. **Climax:** replacement/original links, previous drafts and measurement authors remain traceable. Permitted task recovery follows Salma's explicit action, never automatic reassignment or relabeling another employee's measurements.

Failure: failed reassignment/restart must not appear completed or alter attribution/history. Unknown mobile-only content is not treated as absent; preserved snapshots stay protected. No reopen-original, silent copy-forward, discard-local or unspecified administrative recovery is invented.

## Unresolved Requirements and External Dependencies

See [DECISIONS.md](DECISIONS.md) for the resolved decision register and carried-forward dependencies. OD-01 offline duration/expiry/deactivation and deliberate logout are resolved by the configurable PoV policy above; administrative recovery mechanics may stay outside PoV; OD-02a is resolved: read-only preserved pending snapshot, no cancellation/modification, retry allowed, no automatic editable-Draft fallback; OD-02b synchronization-conflict resolution is resolved by the two explicit actions above. Non-conflict acceptance-blocker recovery is also resolved: EmployÃ© explicitly creates a linked editable correction draft while the rejected original remains preserved read-only; accepted audits still require the separate replacement workflow. OD-03 post-acceptance replacement is resolved as Responsable-only creation of an independent linked task through normal assignment; deactivated employees' unfinished-task handling is also resolved by the explicit state-specific rules above, while administrative recovery of tablet-only data remains separately unresolved/out-of-PoV; OD-04 PDF size/security; OD-05 corrected cross-platform responsive Android/iOS phone/tablet support is resolved; exact Android/iOS/iPadOS versions, physical devices and formal acceptance owner remain open validation items; OD-06 PoV engineering targets are resolved below, with exact test matrices/authority still open; OD-08 controlled bootstrap and post-login team provisioning are resolved; OD-09 is resolved as one-time credential display/manual PoV handover and explicit pre-first-login regeneration; OD-10 is resolved: explicit pre-finalization reopening, preserved history, new summary confirmation/human decision and regenerated current reports; official designation locks summary/decision. **OD-07 is settled: in-app tasks, email deferred.** Employé-mobile saving is resolved as autosave plus explicit Save, preserving Draft state; French language scope and the four-screen visual reference set are resolved.

DEP-01 is an external validation dependency, not a UX design decision. The source-derived workbook baseline is known and traceable: formulas/cell references, fixed divisors, signed percentages, repeated-kV behavior, Rayonnement sortie reproducibility, RÃ©pÃ©tabilitÃ©, LinÃ©aritÃ© including the explicit 0.49 factor, and the blank initial-linearity baseline that produces `#DIV/0!`. CETEM must still provide/validate field requiredness/labels/groups/units/formats/ranges and missing inputs; tolerance thresholds/operators/boundaries and signed-versus-absolute semantics; rounding/display/internal precision/report presentation; blank/zero/N.A./invalid/division-by-zero/incomplete-group behavior; deterministic insight conditions/wording/multiplicity/order; baseline provenance and any tests/rules absent from the workbook. Use the known numerical formulas without inventing thresholds, pass/fail verdicts, rounding, special-value behavior, deterministic insights or overall conformity. Architecture must trace implemented rules to authoritative definitions without requiring UX redesign.

DEP-02 is a separate external CETEM validation dependency and does not block general UX structure. Keep **source-derived regression cases** (workbook/extraction examples used to verify faithful formula reproduction) separate from **CETEM BH-approved acceptance cases** (final domain validation). Approved cases should cover normal, abnormal/out-of-tolerance, exact and near-boundary, missing/optional/blank/zero/N.A., invalid format/range, incomplete group, division-by-zero and special inputs such as `kVmax`, `K2` and the initial linearity baseline once their meaning is approved. Each case should ideally provide inputs â†’ expected calculations â†’ expected displayed/rounded values â†’ individual tolerance/verdict â†’ deterministic insight(s). Workbook examples must not be called approved without explicit CETEM validation. UX may use clearly illustrative structural states such as Conforme, Non conforme or validation error without invented thresholds or domain-acceptance claims.

DEP-03 remains open only for report content and document-specific validation, not the workflow. The resolved workflow keeps two visible paths: **GÃ©nÃ©rer le rapport Word** or **Importer un rapport PDF**, followed by inspection and explicit **DÃ©signer comme rapport officiel**. Finalization is downstream of current summary confirmation and human conformity; reopening a summary makes dependent drafts outdated and requires regeneration/replacement before designation. Finalization links the report to task/audit, summary, decision and Responsable; handwritten signing happens outside software and signed-scan upload is not required by the PoV. OD-04 resolves the configurable technical upload baseline: PDF content validation, 20 Mo maximum, no page limit, no protected/encrypted/password files, server structural validation, and security scan before Ready/designation. Capture known traceability metadata automatically; do not invent report-content fields. CETEM still must approve the Word template, sections, labels, measurement/calculation/tolerance/insight/summary/conformity presentation, identities, dates, version/provenance and signature zones; manual-PDF content/metadata/file-specific rules beyond the baseline; and official-source, naming, retention and replacement rules. Keep report generation template-driven and report metadata distinct from the binary where appropriate.

The confirmed minimum report traceability is task/audit linkage, Responsable, human machine-conformity decision and finalization date. Generated Word must be printable with approved handwritten-signature zones; exact fields/layout remain DEP-03. Internal insight/AI provenance stays preserved in the system without automatically requiring every provenance field in the official report. Submission, summary confirmation, machine decision and official designation retain actor/date; no audit-approval event is introduced. Both report-production paths and explicit finalization are resolved; document-specific content/validation remains dependent. [PRD Â§Â§5.5â€“6.]

Workbook evidence authorizes explicit numerical formulas, not tolerance verdicts. Preserve signed deviations, fixed divisors and actual dependencies. Literal extrema do not establish MIN/MAX formulas; display format is not rounding policy. A blank initial linearity baseline is not zero/N.A./pass. Human overall conformity remains separate. Architecture must resolve security/sync/provider mechanisms while preserving these boundaries. The source-derived calculation baseline may appear in implementation/UX where defined; rule-dependent states remain honest where catalogue validation is pending. Automated tests should retain separate source-regression and CETEM-acceptance fixture labels.

### Performance and compatibility targets â€” OD-06

Treat these as configurable Phase 1 PoV engineering targets, not CETEM BH contractual SLAs:

- Normal server-backed interactive operations and screen/data loading: â‰¤3 seconds at p95 under defined test conditions. Do not apply mechanically to report generation, upload or security scanning; show immediate feedback and processing states for longer operations.
- Local Save/autosave persistence: â‰¤1 second at p95 on representative Phase 1 Android/iOS/iPadOS devices. This measures local persistence, not synchronization. Preserve Saved locally â‰  synchronized â‰  submitted.
- Word report generation: â‰¤30 seconds at p95 under defined conditions; asynchronous from the userâ€™s perspective, with processing state, non-frozen interface and explicit retry on failure. Success never designates the report official.
- Responsable web: latest two major versions of the browsers selected for Phase 1 acceptance, not every browser. EmployÃ© follows corrected OD-05 Android/iOS/iPadOS phone/tablet testing, not browser-version support.

Before measuring p95, record representative device/browser, network conditions, dataset and record sizes, backend environment and report input. Offline local measurement entry, confirmed-rule calculations, local validation, Save/autosave and viewing locally available assignments remain usable without network; synchronization performance is evaluated separately. Exact browser/Android matrices, formal test environment and acceptance authority remain validation items.

### Phase 1 acceptance matrix â€” open validation record

The EmployÃ© acceptance matrix must include at least these four representative mobile devices, without inventing models or OS versions yet:

| Platform/form factor | Required record before acceptance |
|---|---|
| Android smartphone | Manufacturer/model; Android version; screen size/resolution; supported orientation; application build/version |
| Android tablet | Manufacturer/model; Android version; screen size/resolution; supported orientation; application build/version |
| iPhone | Manufacturer/model; iOS version; screen size/resolution; supported orientation; application build/version |
| iPad | Manufacturer/model; iPadOS version; screen size/resolution; supported orientation; application build/version |

The Responsable application remains web-based with a separate browser matrix: record selected browsers and the latest two major versions used for Phase 1 acceptance. Exact mobile OS versions, physical devices, browser selection, test environment and formal acceptance owner remain open validation items. Do not claim compatibility or p95 compliance until those records and test conditions exist.
## Finalization and Visual Coverage

The Phase 1 visual reference set is exactly four mock artifacts: **EmployÃ© responsive phone** (Android/iOS phone viewport, vertical field entry, numeric input, validation, Enregistrer/Soumettre); **EmployÃ© responsive tablet** (Android/iPad tablet viewport, same workflow/hierarchy, larger grouped/contextual layout); **EmployÃ© offline/save/submission states** (one annotated state mock or small sequence covering EnregistrÃ© sur cet appareil, Hors ligne, en attente de synchronisation, retry, Acceptance blocked, Create correction draft, conflict resolution and Soumis â€” acceptÃ© par le serveur); and **Responsable review-to-report** (results/tolerances, insights, AI/manual summary, confirmation, explicit conformity, report generation/designation, plus OD-10 outdated-draft/reopen state). All mockup copy is French. Phone/tablet are one cross-platform responsive React Native EmployÃ© experience. Supporting screens remain spine/component-only; no extra high-fidelity mocks are required. Both spines are finalized for architecture handoff; external validation dependencies remain explicitly open.

