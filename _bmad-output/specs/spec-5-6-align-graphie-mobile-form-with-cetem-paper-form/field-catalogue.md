# Field catalogue — `graphie-mobile-pov` 2.0.0 / schema 3

Checked against the paper form photos in `docs/product/source/formulaire-cetem/` (pages 1/4–4/4).

All values are stored as strings. "Default" means the value seeded into a **new** draft only, matching the value pre-printed on paper. Field types are `text`, `date`, `number` (decimal keypad, still a string), `choice` and `textarea`. Provenance: `P` = `CETEM_PAPER_FORM`, `W` = `CETEM_WORKBOOK` (field feeds a workbook formula). No field carries `required`, `min`, `max`, `allowNA` or tolerance metadata.

ID scheme: `<group>.<field>` for once-only fields and `<test>.row<N>.<column>` for table cells (e.g. `voltage.accuracy.row1.kvMeasured`). Rows are numbered from 1. Section IDs are navigation keys only and are not field-ID prefixes.

## Paper elements deliberately not captured

| Paper element | Why excluded |
|---|---|
| « Test … concluant : OUI / NON » under each test | Verdict; out of scope (no Conforme/Non conforme). |
| Computed cells: (KV mesuré − KV affiché)/KV affiché, KV mesuré min/max/moy and their deviations, Kerma moy, (Kerma − Kerma moy)/Kerma moy, Kerma (1m), K1, K2, (K1 − K2)/K2, Σ\|écarts\|, Σ\|écarts\|/D.F.R | Calculation results (Story 6.3+). |
| « Tolérances » boxes | Tolerance rules; out of scope. |
| « Conclusion générale », « Contrôle approuvé par » | Belong to the Responsable (later stories). |
| Signature(s) | Stays manual on paper. |
| Reproductibilité et répétabilité table (page 3): KV 70 × 5, mAs, mA max/2, Kerma | Kerma reused from section 7 (paper N.B.); no second entry point. |

## 1. `header` — En-tête (page 1)

| Field ID | Label (fr) | Type | Options / help |
|---|---|---|---|
| `header.reportNumber` | N° rapport | text | help « N° …/LCQ » |
| `header.etablissement` | Établissement | text | |
| `header.serviceLieu` | Service / Lieu | text | |
| `header.interventionNature` | Nature de l'intervention | choice | Demande ponctuelle · Convention; default `Convention` (pre-printed X) |
| `header.refCetembh` | Réf. CETEMBH (Convention N°) | text | |
| `header.refClient` | Réf. Client (N°) | text | |

## 2. `equipment` — Identification de l'équipement (page 1)

Grid: rows = attributes (paper: Marque, Modèle, N°.S, D.M.S), columns = units. ID `equipment.<unit>.<attribute>`, all `text`, `P`.

| Attribute ↓ / Unit → | Équipement (`equipment`) | Tube à rayons X (`tube`) | Générateur HT (`generator`) |
|---|---|---|---|
| Marque (`brand`) | `equipment.equipment.brand` | `equipment.tube.brand` | `equipment.generator.brand` |
| Modèle (`model`) | `equipment.equipment.model` | `equipment.tube.model` | `equipment.generator.model` |
| N° de série (`serial`) | `equipment.equipment.serial` | `equipment.tube.serial` | `equipment.generator.serial` |
| D.M.S (`dms`) | `equipment.equipment.dms` | `equipment.tube.dms` | `equipment.generator.dms` |

## 3. `instruments` — Appareils et outils de contrôle (page 1)

Rows = Désignation, columns = Marque, Modèle, N° de série. ID `instruments.<instrument>.<attribute>`, all `text`, `P`. Defaults (pre-printed on paper in a cell shared by both rows, one multifunction device): KVp mètre and Dosimètre → Marque `Fluke Biomedical`, Modèle `8000`, N° de série `105991`. Mètre-ruban has no default.

| Désignation ↓ / Attribute → | Marque | Modèle | N° de série |
|---|---|---|---|
| KVp mètre (`kvpMeter`) | `instruments.kvpMeter.brand` | `instruments.kvpMeter.model` | `instruments.kvpMeter.serial` |
| Dosimètre (`dosimeter`) | `instruments.dosimeter.brand` | `instruments.dosimeter.model` | `instruments.dosimeter.serial` |
| Mètre-ruban (`tapeMeasure`) | `instruments.tapeMeasure.brand` | `instruments.tapeMeasure.model` | `instruments.tapeMeasure.serial` |

## 4. `visual` — Contrôles visuels (page 1, « Aspects qualitatifs »)

Choice options: `N.A` · `Oui` · `Non`. A blank value means unanswered. The paper has no comment field here.

| Field ID | Label (fr) |
|---|---|
| `visual.integrity` | Intégrité de l'appareil, bon état des couvercles |
| `visual.cleanliness` | Propreté générale |
| `visual.keyboards` | Bon état mécanique des claviers |
| `visual.accessories` | Bon état des accessoires et des périphériques |
| `visual.connectorsCables` | Bon état des connecteurs et des câbles électriques |

## 5. `mechanical` — Contrôle de sécurité mécanique (page 1)

Choice options: `N.A` · `Oui` · `Non`. The paper has no comment field here.

| Field ID | Label (fr) |
|---|---|
| `mechanical.brakes` | Contrôle des freins |
| `mechanical.movements` | Contrôle des mouvements |

## 6. `voltageAccuracy` — Exactitude de la tension (page 2)

Table with 3 rows. Row labels as on paper: « KV min », « KV », « KV max ».

| Field ID | Label (fr) | Type | Unit | Default | Prov. |
|---|---|---|---|---|---|
| `voltage.accuracy.row1.kvDisplayed` | kV affiché | number | kV | `50` | P W |
| `voltage.accuracy.row1.kvMeasured` | kV mesuré | number | kV | — | P W |
| `voltage.accuracy.row2.kvDisplayed` | kV affiché | number | kV | `70` | P W |
| `voltage.accuracy.row2.kvMeasured` | kV mesuré | number | kV | — | P W |
| `voltage.accuracy.row3.kvDisplayed` | kV affiché | number | kV | — (kV max, entered by technician) | P W |
| `voltage.accuracy.row3.kvMeasured` | kV mesuré | number | kV | — | P W |
| `voltage.accuracy.comments` | Commentaire | textarea | | | P |

## 7. `repeatability` — Répétabilité de la tension (page 2) + comment for page 3 test

Once-only fields (merged cells on paper; column order mAs, mA max/2, then rows):

| Field ID | Label (fr) | Type | Unit | Default | Prov. |
|---|---|---|---|---|---|
| `voltage.repeatability.mas` | mAs | number | mAs | — | P W |
| `voltage.repeatability.maMaxHalf` | mA max/2 | number | mA | — | P |

Table with 5 rows (`N` = 1…5). Row label: « Mesure N ».

| Field ID | Label (fr) | Type | Unit | Default | Prov. |
|---|---|---|---|---|---|
| `voltage.repeatability.rowN.kvDisplayed` | kV affiché | number | kV | `70` | P |
| `voltage.repeatability.rowN.kvMeasured` | kV mesuré | number | kV | — | P W |
| `voltage.repeatability.rowN.kerma` | Kerma | number | mGy | — | P W |

Help text on the Kerma column (paper N.B.): « La mesure du kerma sera utilisée par la suite pour le contrôle de la reproductibilité et la répétabilité du rayonnement de sortie. »

Comments:

| Field ID | Label (fr) |
|---|---|
| `voltage.repeatability.voltageComments` | Commentaire — répétabilité de la tension |
| `voltage.repeatability.outputComments` | Commentaire — reproductibilité et répétabilité du rayonnement de sortie |

Kerma is entered here only.

## 8. `linearity` — Linéarité du rayonnement de sortie (page 3)

Order as on paper: 3 rows, then the mA max/2 row. DFC appears on paper only in the N.B. « Kerma (1m) = Kerma (dét)·(DFC/1m)² » and is captured once after the table, at the user's request.

| Field ID | Label (fr) | Type | Unit | Default | Prov. |
|---|---|---|---|---|---|
| `output.linearity.rowN.kvDisplayed` (N = 1…3) | kV affiché | number | kV | `70` | P |
| `output.linearity.rowN.mas` (N = 1…3) | mAs | number | mAs | row 1 `10`; rows 2–3 — | P W |
| `output.linearity.rowN.kerma` (N = 1…3) | Kerma (dét) | number | mGy | — | P W |
| `output.linearity.maMaxHalf` | mA max/2 | number | mA | — | P |
| `output.linearity.dfc` | DFC (distance foyer–chambre) | number | m | — | P |
| `output.linearity.comments` | Commentaire | textarea | | | P |

## 9. `lightField` — Géométrie du faisceau de rayons X : correspondance entre le champ lumineux et le champ de rayons X (pages 3–4)

| Field ID | Label (fr) | Type | Unit | Default |
|---|---|---|---|---|
| `lightField.kv` | kV | number | kV | `70` |
| `lightField.mas` | mAs | number | mAs | `4` |
| `lightField.dfr` | D.F.R (distance foyer–récepteur) | number | m | `1` |
| `lightField.gap1` … `lightField.gap4` | Écart 1 … Écart 4 | number | mm | — |
| `lightField.comments` | Commentaire | textarea | | |

All fields are `P`.

## 10. `comments` — Commentaires généraux (page 4)

| Field ID | Label (fr) | Type |
|---|---|---|
| `comments.general` | Commentaires généraux | textarea |

## 11. `controlPerformedBy` — Contrôle effectué par (page 4)

| Field ID | Label (fr) | Type |
|---|---|---|
| `controlPerformedBy.nom` | Nom et prénom | text |
| `controlPerformedBy.qualite` | Qualité | text |
| `controlPerformedBy.dateControle` | Date de contrôle | date |

The signature stays on paper and has no field.

## Totals and removals

- 84 field IDs: header 6, equipment 12, instruments 9, visual 5, mechanical 2, voltageAccuracy 7, repeatability 19, linearity 12, lightField 8, comments 1, controlPerformedBy 3.
- Section order: `header`, `equipment`, `instruments`, `visual`, `mechanical`, `voltageAccuracy`, `repeatability`, `linearity`, `lightField`, `comments`, `controlPerformedBy`.
- **Removed** from 1.0.0: sections `intervention`, `qualitative`, `quantitative`. Fields `intervention.*`, `equipment.identity.0–6`, `instrument.*`, `qualitative.0–4`, `qualitative.observations`, `voltage.accuracy`, `voltage.reproducibility`, `output.reproducibility`, `output.linearity`, `beam.geometry`, `measurement.other`. The options « Conforme », « À signaler » and « Non vérifié » are also removed. The date and technician move to `controlPerformedBy.*`.
- The header has no separate « Convention N° » field: on paper, that cell is the value of Réf. CETEMBH, and the unlabelled « N° » cell is the value of Réf. Client.
- **Catalogue type additions:** `CatalogueField.defaultValue?: string`, provenance `CETEM_PAPER_FORM`, and a section-level explicit table grouping (`tables?: { id; rowLabelsFr: string[]; columns: field templates }` or equivalent). The grouping lets the UI render rows. Every concrete field ID must still appear in the flattened catalogue used by `parseGraphiePayload`.
