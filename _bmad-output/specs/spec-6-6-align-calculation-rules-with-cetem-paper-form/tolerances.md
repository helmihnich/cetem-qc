# Tolerances (from the paper form photos, checked 2026-10-03)

| Test | Compared value | Printed text | Rule (`comparison`, `limitPercent`) | Exactly at limit | Source |
|---|---|---|---|---|---|
| Exactitude de la tension | each row's (KV mesuré − KV affiché)/KV affiché | `<= ± 10 %` | `abs-lte`, 10 | conforme | p2, `8fe5a363-…(1).jpg` |
| Répétabilité de la tension | (KV min − KV moy)/KV moy and (KV max − KV moy)/KV moy | `<= ± 5%` (both lines) | `abs-lte`, 5 | conforme | p2, `8fe5a363-…(1).jpg` |
| Reproductibilité et répétabilité du rayonnement de sortie | each row's (Kerma − Kerma moy)/Kerma moy | `< ± 10%` | `abs-lt`, 10 | non-conforme | p3, `f9657912-…(1).jpg` |
| Linéarité du rayonnement de sortie | each row's (K1 − K2)/K2 | `< ± 15%` | `abs-lt`, 15 | non-conforme | p3, `f9657912-…(1).jpg` |
| Correspondance champ lumineux / champ RX | Σ\|écarts\|/D.F.R | none printed | — → `indisponible` / `no-tolerance` | — | p4, `c2805aec-…(1).jpg`. **Open question for CETEM:** tolerance to confirm, with no invented value. |

## Comparison rule (floating-point noise)

`TOLERANCE_EPSILON = 1e-9` (percentage points). This **absorbs floating-point noise only**. It is not a tolerance widening, and values are never rounded. A value whose |écart| is within 1e-9 of the limit counts as equal to the limit:

| Comparison | `conforme` iff | Write it exactly as |
|---|---|---|
| `abs-lte` (≤) | \|x\| ≤ limit (+ noise) | `Math.abs(x) - limit <= TOLERANCE_EPSILON` |
| `abs-lt` (<) | \|x\| < limit (− noise) | `limit - Math.abs(x) > TOLERANCE_EPSILON` |

The expression form is part of the contract. `Math.abs(x) < limit - TOLERANCE_EPSILON` is wrong: `10 - 1e-9` rounds to `9.999999999`, so 9.999999999 would become `non-conforme`.

| Value | ≤ 10 | < 10 |
|---|---|---|
| 10 | conforme | non-conforme |
| 10.000000000000002 | conforme | non-conforme |
| 9.999999999 | conforme | conforme (10 − x = 1.0000000827e-9 > ε) |
| 10.001 | non-conforme | non-conforme |

- Compare the signed percentage after taking its absolute value. Tolerances are exported as one constant (e.g. `GRAPHIE_TOLERANCES`) so that 6.3 can display them and tests can reference them.
- These tolerances come from the signed paper form, which the Product Owner names as the rule reference. They are not DEP-02 acceptance fixtures.
