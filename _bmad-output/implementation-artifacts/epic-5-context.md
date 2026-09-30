# Epic 5 Context: Employé Mobile Field Work

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Enable Employé to open assigned work on Android and iOS phones and tablets, capture approved Graphie Mobile evidence, preserve it securely, and continue authorized work offline. Keep role/assignment authorization and server acceptance authoritative. Build the secure local foundation before draft editing; later stories add draft lifecycle and form content.

## Stories

- Story 5.1: Open assigned work across supported phone and tablet form factors
- Story 5.2: Protect local drafts and apply the resolved offline access window
- Story 5.3: Save, resume and explicitly delete a local draft
- Story 5.4: Capture the confirmed Graphie Mobile form structure
- Story 5.5: Continue editing a synchronized task offline

## Requirements & Constraints

- Employee access remains limited to the authenticated employee's assignments; server-side authorization is authoritative.
- Offline access is a configurable PoV policy of up to seven days after successful online authentication. Only successful online reauthentication resets it. Explicit logout ends it immediately. Restart, temporary connectivity loss, and ordinary server-token expiry do not end the offline grant.
- Expiry, logout, and known deactivation lock local protected work without deleting it. Reconnection must revalidate current account authorization before protected server activity or synchronization. Deactivated accounts cannot access or synchronize as that employee; device-only recovery remains outside the PoV.
- One responsive French React Native experience serves Android/iOS phones and tablets. Exact OS/device matrix and physical secure-storage evidence remain platform acceptance items.
- Do not invent DEP-01 field, validation, calculation, or tolerance rules. Keep draft CRUD/autosave in 5.3, form structure in 5.4, and offline editing in 5.5.

## Technical Decisions

- Mobile architecture uses a transactional encrypted local datastore with a distinct secure-key-store boundary; authorization, server token/session lifetime, local persistence, and synchronization are separate concepts.
- Expo SDK 57 / React Native 0.86.3 is the current mobile baseline. Keep native secure-storage dependencies behind small adapters. Android/iOS exports prove JavaScript bundling only, not native behavior.
- Preserve local work through failures and authorization locks; no implicit deletion or overwrite. No sync outbox or submission behavior is introduced by Story 5.2.

## UX & Interaction Patterns

- French UI presents offline authorization, expiry/reconnect requirements, and account access denial clearly. Keep connectivity, local durability, transfer, and business lifecycle distinct.
- At expiry or logout, explain that protected work is preserved but inaccessible until successful online authentication. Avoid presenting stale server authorization as current.

## Cross-Story Dependencies

- Story 5.2 establishes protection/authorization foundations reused by 5.3–5.5. Story 5.3 introduces actual draft save/resume/delete. Story 5.4 depends on approved DEP-01 catalogue details. Story 5.5 reuses protected local task state but does not pull forward sync/outbox behavior.
