# Report template — « Rapport de Contrôle de Qualité d'un Appareil Mobile de Radiographie N° …/LCQ »

Source of truth: the four photos in `docs/product/source/formulaire-cetem/` (pages 1/4 … 4/4). Field IDs are those of `graphie-catalogue.ts`. Template id `cetem-paper-report`, version `1.0.0`. Labels are the French labels printed on the form (typography of the photos is not reproduced beyond tables, bold, underline and the logo). Values are the stored strings, shown verbatim; calculated values are at full precision with the decimal comma. An empty or missing value is an empty cell.

Header on every page: logo `docs/product/source/cetem-logo.png` (left). Page footer: « n/4 » page numbering only (as the form).

## Page 1/4

1. Title box: « Rapport de Contrôle de Qualité d'un Appareil Mobile de Radiographie » and « N° {header.reportNumber}/LCQ » (« N° ………/LCQ » if empty; the stored `header.reportNumber` is shown after « N° » and « /LCQ » is appended unless the value already ends with it).
2. Table: « ETABLISSEMENT » {header.etablissement}; « SERVICE/LIEU » {header.serviceLieu}; right block « Nature de l'intervention » with cells « Demande Ponctuelle » and « Convention », an « X » in the cell chosen by `header.interventionNature`; row « Réf. CETEMBH » | « Réf. Client »; row « Convention N° {header.refCetembh} » | « N° {header.refClient} ».
3. Table « Identification de l'équipement » × « Tube à rayons X » × « Générateur HT »; rows « Marque », « Modèle », « N°.S », « D.M.S »; cells `equipment.{equipment|tube|generator}.{brand|model|serial|dms}`.
4. Table « Appareils et outils de Contrôle »: columns « Désignation », « Marque », « Modèle », « N° de Série »; rows « KVp mètre », « Dosimètre », « Mètre-ruban » from `instruments.{kvpMeter|dosimeter|tapeMeasure}.{brand|model|serial}`.
5. Table « Aspects Qualitatifs » (columns « N.A », « Oui », « Non »; the chosen option is marked « X »), sub-heading « Contrôles Visuels » with the five rows `visual.integrity`, `visual.cleanliness`, `visual.keyboards`, `visual.accessories`, `visual.connectorsCables` (labels as the catalogue/paper).
6. Table « Contrôle de sécurité Mécanique » (same columns): « Contrôle des Freins » `mechanical.brakes`, « Contrôle des mouvements » `mechanical.movements`.

## Page 2/4 — « CONTROLE DES PERFORMANCES EN MODE GRAPHIE : »

7. « Exactitude de la tension : » → « Mesure : » table with columns « KVaffiché », « KVmesuré », « (KVmesuré - KVaffiché)/ KVaffiché » and rows « KVmin = », « KV = », « KVmax = »: `voltage.accuracy.row{1..3}.kvDisplayed|kvMeasured`, deviation from `results.voltageAccuracy.values.deviationPercent[i]` (« % »).
   « Tolérances : (KVmesuré - KVaffiché)/ KVaffiché <= ± 10 % ». « Commentaire : » `voltage.accuracy.comments`. « Test d'Exactitude de la Tension concluant : OUI ☐ NON ☐ » marked by the verdict rule (below).
8. « Répétabilité » → « Mesure : » table: « mAs » (`voltage.repeatability.mas`), « mAmax/2 » (`voltage.repeatability.maMaxHalf`), five rows « KVaffiché » (`…row{1..5}.kvDisplayed`), « KVmesuré » (`…kvMeasured`), « Kerma(mGy)* » (`…kerma`); then « KVmesuré_min », « KVmesuré_max », « KVmesuré_moy » from `results.voltageRepeatability.values.min|max|mean`; « (KVmesuré_min - KVmesuré_moy) / KVmesuré_moy » and « (KVmesuré_max - KVmesuré_moy) / KVmesuré_moy » from `minDeviationPercent|maxDeviationPercent`. « N.B : la mesure du kerma sera utilisée par la suite pour le contrôle de la reproductibilité et la répétabilité du rayonnement de sortie » (`KERMA_REUSE_HELP_FR`).
   « Tolérances : (KVmesuré_min - KVmesuré_moy) / KVmesuré_moy <= ± 5 % ; (KVmesuré_max - KVmesuré_moy) / KVmesuré_moy <= ± 5 % ». « Commentaire : » `voltage.repeatability.voltageComments`. « Test de répétabilité de la Tension concluant : OUI ☐ NON ☐ ».
9. Heading « Reproductibilité, répétabilité et linéarité du rayonnement de sortie : ».

## Page 3/4

10. « Reproductibilité et répétabilité : » → « Mesure : » table: « KV » (70 ×5, from the stored `voltage.repeatability.row{i}.kvDisplayed`), « mAs » (`voltage.repeatability.mas`), « mAmax/2 », « Kerma (mGy) » (`…kerma`), « (Kerma – Kermamoy) / Kermamoy » from `results.outputRepeatability.values.deviationPercent[i]`, « Kermamoy » from `kermaMean`. « Tolérances : (Kerma - Kermamoy) / Kermamoy < ± 10% ». « Commentaire : » `voltage.repeatability.outputComments`. « Test de reproductibilité, répétabilité du rayonnement de sortie concluant : OUI ☐ NON ☐ ».
11. « * Linéarité : » → « Mesure : » table: « KV », « mAs », « Kerma (dét) », « Kerma (1m) », « [Kerma(1m)/mAs] = K1 », « (K1 - K2)/ K2 (%) »; three rows from `output.linearity.row{1..3}.kvDisplayed|mas|kerma`, `kermaAt1m[i]`, `k1[i]`, `deviationPercent[i]`; last row « mAmax/2 » (`output.linearity.maMaxHalf`) and « [Kerma(1m)/ mAs]_moy = K2 » `k2`. « NB : Kerma (1m) = Kerma (dét)*(DFC/1m)² » with the entered DFC (`output.linearity.dfc`, « DFC = {value} m »). « Tolérances : [(K1 - K2)/ K2] < ± 15% ». « Commentaire : » `output.linearity.comments`. « Test de linéarité du rayonnement de sortie : OUI ☐ NON ☐ ».
12. « Géométrie du faisceau de rayons X : » « Correspondance entre le champ lumineux et le champ de rayons X : ».

## Page 4/4

13. Table: « KV » `lightField.kv`, « mAs » `lightField.mas`, « D.F.R » `lightField.dfr` (« m »), four « écarts » `lightField.gap1..4`, « Σ |écarts| » `sumAbsGapsMm`, « Σ |écarts| / D.F.R » `resultPercent` (« % »). « NB : Σ |écarts| : somme de la valeur absolue des écarts ; DFR : Distance Foyer Récepteur. ». « Commentaire : » `lightField.comments`. « Test de correspondance entre le champ lumineux et le champ des Rayons X concluant : OUI ☐ NON ☐ » — no tolerance exists: neither box is marked and « indisponible — aucune tolérance définie » is printed (PO decision).
14. « COMMENTAIRES : » `comments.general`.
15. « CONCLUSION GENERALE : » first line « Machine conforme » or « Machine non conforme » (the recorded human decision), then the confirmed summary text, paragraphs preserved.
16. Table « Contrôle effectué par : » columns « Nom et Prénom » (`controlPerformedBy.nom`), « Qualité » (`controlPerformedBy.qualite`), « Date de Contrôle » (`controlPerformedBy.dateControle`), « Signature(s) » — **empty**.
    Table « Contrôle Approuvé par : » columns « Nom et Prénom » = « HENIDI Rache », « Qualité » = « CHEF DE SERVICE » (preprinted on the paper form), « Date de Contrôle » empty, « Signature » — **empty**.

## Verdict marks (OUI / NON)

From the stored `suggestedVerdict` of each test (rule `cetem-paper-form` 2.0.0): `conforme` → OUI marked (☒) and NON empty (☐); `non-conforme` → NON marked; `indisponible` (missing input, zero denominator, no tolerance, unsupported version) → neither marked and the line « indisponible — {reason} » printed using the `fr.graphieResults` reason labels. Verdicts are suggestions per test; they never set the decision printed in « Conclusion générale ».

## Rules

- Stored strings are rendered as-is (no trimming that changes content beyond XML escaping; line breaks in comments and summary become paragraphs).
- Unsupported identity tuple on a result: its calculated cells are empty and the verdict line reads « indisponible — version de règles non prise en charge ».
- Nothing else is added: no insights, no AI text, no provenance block, no rule id, no « candidat » mark, no signature image, no date other than the form's own fields.
- The model implies three open items for CETEM at final DEP-03 acceptance (see SPEC « Open Questions »); none blocks building.
