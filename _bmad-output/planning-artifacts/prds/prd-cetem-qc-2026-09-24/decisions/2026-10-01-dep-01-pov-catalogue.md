# Product Owner Decision: DEP-01 PoV Catalogue Structure

**Date:** 2026-10-01  
**Decision owner:** Product Owner  
**Status:** Decided for PoV form structure; business rules remain open

## Decision

CETEM BH will not provide a formal Graphie Mobile field catalogue. For the PoV, use a project-defined, versioned, configuration-driven Graphie Mobile catalogue. This resolves DEP-01 only as a blocker to defining Story 5.4's form structure. It does not represent CETEM BH approval of the catalogue or any external guidance.

The catalogue is derived from two distinct source classes:

1. **CETEM BH source workbook:** use only information present in or derived from `docs/product/CALCUL_graphie_01.xls`. Preserve [Graphie Calculation Rules — CETEM BH Source Extraction](../../../../../docs/product/graphie-calculation-rules-source-extraction.md) unchanged. Workbook-derived formulas remain source-derived numerical evidence; the extraction is not described as CETEM-reviewed or approved.
2. **Recognized diagnostic-radiography QC guidance:** established IAEA/AAPM practice may inform conventional metadata, intervention/control metadata, measuring-instrument metadata, qualitative equipment checks, standard radiography QC families and conventional measurement concepts. Such items are project-defined PoV catalogue decisions, not CETEM-provided or CETEM-approved requirements.

External guidance does not establish CETEM-specific or PoV business rules: tolerance thresholds, pass/fail rules, mandatory status, numeric ranges, rounding, N.A. semantics, blank/zero behavior, overall conformity or deterministic insights. Those require an explicit Product Owner decision or stronger source.

## PoV catalogue starting structure

| Section | Starting fields / families |
|---|---|
| Intervention | Control/intervention date; establishment; service/location; employee/technician; control context where justified; comments |
| Equipment | Manufacturer; model; serial number; equipment/type identification; generator identification where applicable; X-ray tube identification where applicable |
| Measuring instruments | Instrument; manufacturer; model; serial number; calibration information where applicable |
| Qualitative checks | General condition; controls/display; cables/connectors where applicable; movement/locking where applicable; collimator/light-field observations where applicable; comments |
| Quantitative tests | Exactitude de la tension (kV); Reproductibilité de la tension; Reproductibilité du rayonnement de sortie; Linéarité du rayonnement de sortie; Géométrie / faisceau |
| General comments | Free-text observations/comments |

Do not add Epic 6 calculations or tolerance logic to Story 5.4. The configuration/schema may support `id`, `section`, `testFamily`, `labelFr`, `type`, `unit`, `required`, `min`, `max`, `allowNA`, `options`, `displayOrder`, validation configuration and source/provenance, but unsupported business values must remain unset. Do not add fake defaults to fill schema slots. Field/rule provenance uses one or more of `CETEM_WORKBOOK`, `IAEA_GUIDANCE`, `AAPM_GUIDANCE`, `PROJECT_POV_DECISION`.

All user-facing field labels, section names, help and validation messages are French. Internal identifiers, APIs, schema identifiers and technical documentation may be English.

## Explicitly unresolved rules

The following remain unresolved unless separately authorized: tolerance thresholds; comparison operators; inclusive/exclusive boundaries; signed-versus-absolute verdict semantics; rounding/precision; blank behavior; zero behavior; N.A. behavior; incomplete-test behavior; kVmax; K2; initial-linearity baseline; deterministic insight rules; automatic conformity. Overall machine conformity remains the Responsable's explicit human decision.

DEP-02 calculation/verdict reference fixtures and DEP-03 report-template/content approvals also remain open. The absence of a CETEM field catalogue no longer blocks Story 5.4 planning or its form-structure implementation.
