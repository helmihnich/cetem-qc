# Result display (mobile `measurement-result` pattern)

## Placement

| Form section (`id`) | Block(s), below the table, before the comment field |
|---|---|
| `voltageAccuracy` | Exactitude de la tension |
| `repeatability` | Répétabilité de la tension, then Reproductibilité et répétabilité du rayonnement de sortie |
| `linearity` | Linéarité du rayonnement de sortie (after the DFC field) |
| `lightField` | Correspondance champ lumineux / champ de rayons X (after Écart 4) |

Suggested component: `apps/mobile/graphie-test-result.tsx` (`GraphieTestResultBlock`), rendered by `GraphieSectionForm` for the sections above. Results are computed with `useMemo` from `formValues` and the identity (SPEC CAP-8), not stored in state that gets saved.

## Block content (in order)

1. Heading: the test name (paper wording, above).
2. Values, one line each, label + value + unit, with the paper row label where there are rows:

| Test | Lines |
|---|---|
| voltage-accuracy | « KV min — écart : … % », « KV — écart : … % », « KV max — écart : … % » |
| voltage-repeatability | « kV mesuré moy : … kV », « kV mesuré min : … kV », « kV mesuré max : … kV », « Écart min / moy : … % », « Écart max / moy : … % » |
| output-repeatability | « Kerma moy : … mGy », then « Mesure n — écart : … % » for n = 1…5 |
| output-linearity | per row « Mesure n — Kerma (1m) : … mGy · K1 : … mGy/mAs », then « K2 : … mGy/mAs », then « Mesure n — écart : … % » |
| light-field | « Σ\|écarts\| : … mm », « Résultat : … % de la D.F.R » |

3. Verdict line: symbol + text, from `suggestedVerdict`:
   - `conforme` → « ✓ Conforme (suggestion) »
   - `non-conforme` → « ✗ Non conforme (suggestion) »
   - `indisponible` → « — Verdict indisponible : <reason> »
4. Tolerance line when `suggestedVerdict.tolerance` exists: `abs-lte` → « Tolérance : |écart| ≤ N % », `abs-lt` → « Tolérance : |écart| < N % ». N comes from the result object, never a UI constant.
5. Provenance line: « Règle <ruleId> <ruleVersion> — formulaire CETEM, page <page>, <section> ».
6. Fixed line: « Suggestion : la conformité finale de l'appareil est décidée par le Responsable. »

## Values

- `calculated` → `String(value).replace(".", ",")` + unit. No rounding, no thousands grouping. Negative sign kept.
- `unavailable` → « Indisponible — <reason> ».

| Reason | French text |
|---|---|
| `missing-input` | mesure manquante |
| `invalid-input` | valeur numérique invalide |
| `zero-denominator` | division par zéro (valeur nulle au dénominateur) |
| `no-tolerance` | aucune tolérance imprimée sur le formulaire officiel |
| `unsupported-version` (whole result) | version de règle non prise en charge — aucun calcul |

## Field hint

A `number` field whose raw value is non-blank and unparseable shows « Valeur numérique invalide » under the input, as text linked to the input's accessibility hint. Save, autosave and navigation are not blocked.

## Accessibility and styling

- The block is read-only, visually separate from inputs (no `TextInput`, different background or border), and has `accessibilityLabel` = heading.
- The verdict line's `accessibilityLabel` spells out the full text (« Verdict suggéré : conforme »), so the symbol is not read alone.
- Colour may tint the verdict (existing palette), but the text and symbol carry the meaning on their own.
- The phone layout stacks the lines. The tablet layout may use two columns. Text wraps; nothing is truncated.

All strings go into `fr.employeeTasks` (or a new `fr.graphieResults` group) in `packages/i18n/src/fr.ts`.
