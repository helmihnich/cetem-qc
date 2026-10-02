---
id: SPEC-5-6-align-graphie-mobile-form-with-cetem-paper-form
story: 5.6
status: ready-for-dev
approved: 2026-10-02
companions:
  - field-catalogue.md
  - calculation-input-mapping.md
  - versioning-and-compatibility.md
  - test-plan.md
  - delivery-notes.md
  - ../../implementation-artifacts/spec-5-4-capture-project-defined-graphie-mobile-form-structure.md
  - ../../implementation-artifacts/spec-6-3-display-authorized-calculation-results-in-the-employe-form.md
sources:
  - docs/product/source/formulaire-cetem/
  - apps/mobile/graphie-pov-catalogue.ts
  - docs/product/graphie-calculation-rules-source-extraction.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Story 5.6 — Align the Graphie Mobile form with the official CETEM paper form

## Why

**Pain.** Catalogue `1.0.0` has one number field per test (e.g. `voltage.accuracy` "Exactitude de la tension"), but the shared formulas in `packages/domain` need raw readings (kV, Kerma, mAs). A technician cannot enter the data the calculations consume, so Story 6.3 is blocked. CETEM technicians already fill the official paper form *Rapport de Contrôle de Qualité d'un Appareil Mobile de Radiographie*, a 4-page form photographed in `docs/product/source/formulaire-cetem/`. The mobile form must reproduce its tables section by section.

**Story statement.** As an Employé, I want the Graphie Mobile form to have the same sections and tables as the official CETEM paper form, so that I enter the same raw readings I record on paper and later calculations have real inputs.

## Capabilities

Each `success` is an acceptance criterion. Field IDs, labels, units and defaults are in [field-catalogue.md](field-catalogue.md), which was checked against the photos.

- **CAP-1** — En-tête
  - **intent:** The technician records the report header: N° rapport (…/LCQ), Établissement, Service/Lieu, Nature de l'intervention, Réf. CETEMBH (Convention N°), Réf. Client (N°).
  - **success:** The `header` section renders these 6 fields. Nature de l'intervention offers exactly « Demande ponctuelle » and « Convention » and defaults to « Convention ». There is no separate « Convention N° » field.
- **CAP-2** — Identification de l'équipement and appareils et outils de contrôle
  - **intent:** The technician identifies the equipment, X-ray tube and HV generator, plus the three control instruments.
  - **success:** The `equipment` section has a 4 × 3 grid (Marque, Modèle, N° de série, D.M.S × Équipement, Tube à rayons X, Générateur HT). The `instruments` section has a 3 × 3 grid (KVp mètre, Dosimètre, Mètre-ruban × Marque, Modèle, N° de série). The 21 cells use stable, distinct IDs. In a new draft, the KVp mètre and Dosimètre rows are pre-filled with Fluke Biomedical / 8000 / 105991 (one multifunction device), editable; Mètre-ruban starts blank.
- **CAP-3** — Contrôles visuels and sécurité mécanique
  - **intent:** The technician answers each visual and mechanical check with N.A / Oui / Non.
  - **success:** The 5 visual items and 2 mechanical items offer only « N.A », « Oui » and « Non ». A blank (unanswered) value is allowed. Neither section has a comment field, matching the paper. « Conforme », « À signaler » and « Non vérifié » appear nowhere in the catalogue or UI.
- **CAP-4** — Exactitude de la tension
  - **intent:** The technician enters kV affiché and kV mesuré for 3 rows.
  - **success:** The rows are labelled « KV min », « KV », « KV max ». A new draft starts with kV affiché `50`, `70` and empty (kV max entered by the technician). All cells are editable and persist as strings.
- **CAP-5** — Répétabilité de la tension (+ rayonnement de sortie)
  - **intent:** The technician enters mAs and mA max/2 once, then 5 rows of kV affiché, kV mesuré and Kerma (mGy). The Kerma readings are entered once and also serve the reproductibilité/répétabilité du rayonnement de sortie test.
  - **success:** The section has 2 once-only fields and a 5-row table (kV affiché defaults `70`), and shows the paper's Kerma N.B. as help text. No second Kerma entry point exists in the form.
- **CAP-6** — Linéarité du rayonnement de sortie
  - **intent:** The technician enters 3 rows of kV affiché, mAs and Kerma (dét), then mA max/2 and DFC (m) once.
  - **success:** kV affiché defaults to `70` in all rows, row 1 mAs defaults to `10`, and the other cells start empty. The field order follows the paper (rows, then mA max/2), with DFC after.
- **CAP-7** — Géométrie du faisceau : correspondance champ lumineux / champ de rayons X
  - **intent:** The technician records the exposure setup and the 4 measured écarts.
  - **success:** kV defaults to `70`, mAs to `4` and D.F.R to `1` (m). There are 4 fields « Écart 1–4 » in mm.
- **CAP-8** — Commentaires
  - **intent:** The technician adds a comment wherever the paper has « Commentaire », plus general comments.
  - **success:** There are comment fields for exactitude, voltage repeatability, output reproducibility/repeatability, linearity and light field, plus « Commentaires généraux ». None of the tests has a « concluant OUI/NON » field.
- **CAP-9** — Versioning
  - **intent:** Drafts written against catalogue `1.0.0` / schema `2` are never reinterpreted under the new form.
  - **success:** The shared identity is `graphie-mobile-pov` / `2.0.0` / schema `3`. A stored v1 draft opens with the existing French compatibility notice, its values are not loaded into the form, and the stored bytes stay unchanged. Legacy Story 5.3 `{content}` drafts behave as today. See [versioning-and-compatibility.md](versioning-and-compatibility.md).
- **CAP-10** — Phone-friendly tables
  - **intent:** The technician fills the repeated-row tables on a phone as easily as on a tablet, offline, with autosave.
  - **success:** On a phone, each table row renders as its own labelled group (paper row label or « Mesure n ») with stacked inputs that show their units, a decimal keypad and touch targets of at least 44 pt. Tablet layout, offline use, explicit save, autosave, resume and delete behave as in Stories 5.1–5.5.
- **CAP-11** — Contrôle effectué par
  - **intent:** The technician records who performed the control and when.
  - **success:** The last section, `controlPerformedBy`, has Nom et prénom (text), Qualité (text) and Date de contrôle (date). There is no signature, « Contrôle approuvé par » or « Conclusion générale » field.

## Constraints

- Draft values stay `Record<string, string>`. Numeric parsing, validation and range checks belong to Story 6.3.
- No calculations, derived results, tolerances, « Test … concluant » verdicts or « Conforme / Non conforme » in this story.
- `packages/domain` formula code is not changed. Only `graphie-identity.ts` constants and the tests that hard-code the old tuple change, and those test edits only replace the schema-3 "unsupported" examples. The calculation rule ID/version stays `cetem-workbook-explicit-formulas` / `1.0.0`.
- The catalogue stays explicit, with every field ID written out or produced by a local helper as today. Allowed additions: an explicit table/row grouping and a per-field default. No generic or remote-driven form engine.
- Field IDs in [field-catalogue.md](field-catalogue.md) are stable contract. Story 6.3 and the rule-set v2 story bind to them.
- No migration from v1 drafts. The local draft envelope (`LOCAL_DRAFT_SCHEMA_VERSION = 1`) is unchanged.
- Defaults are the values pre-printed on paper. They are seeded as editable values only into a new draft and never overwrite a value that was saved or cleared.
- Paper-form fields carry provenance `CETEM_PAPER_FORM`. `CETEM_WORKBOOK` is added only on fields that feed a workbook formula.
- Labels are French and follow the paper wording. Capitalisation is normalised, e.g. ETABLISSEMENT → Établissement.

## Non-goals

- Numeric parsing, locale grammar, required fields, min/max values (Story 6.3 / DEP-01R).
- Calculation display, provenance UI, tolerance or pass/fail (Story 6.3+).
- Resolving the calculation-rule questions: reproducibility inputs, the repeatability mAs array, the voltage-deviation reference, the DFC correction. These go to a separate rule-set v2 story before 6.3.
- « Conclusion générale » and « Contrôle approuvé par »: Responsable scope, later.
- Changing formulas, the 0.49 linearity factor, or the calculation rule version.
- Migrating, converting or deleting v1 drafts automatically.
- Report generation that mirrors the paper layout (Epic 11).
- Server-side schema, sync or submission changes (Epic 7).

## Success signal

A technician opens a new Graphie Mobile task on a phone, offline. Section by section, they fill the same tables they fill on the paper form, from the header to « Contrôle effectué par », including the 3/5/3-row measurement tables with the pre-printed defaults. They close the app, reopen it and find every value intact. A device holding a v1 draft shows the compatibility notice and leaves that draft untouched.

