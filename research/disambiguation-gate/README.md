# Disambiguation gate: calibration and evaluation

The gate decides whether retrieval found enough evidence to answer at all, or
whether the caller gets a disambiguation request instead. It is governed by two
thresholds in `.antigravityrc.json`: `disambiguationThreshold` (semantic) and
`lexicalEvidenceThreshold` (query-term coverage).

This directory exists so that the numbers quoted in `README.md` and
`src/core/config.ts` are reproducible rather than asserted.

## Contents

- `calibration_queries.json` — the 35-query set the shipped thresholds were tuned
  on. **Authored by the tuner after reading the corpus, and therefore not held
  out.** It reproduces the quoted bands; it cannot support a claim.
- `run_gate_set.ts` — replays a labelled set through the live gate and reports
  per-class score bands and verdicts. Issues no verdict of its own.

```sh
npx tsx research/disambiguation-gate/run_gate_set.ts \
  research/disambiguation-gate/calibration_queries.json
```

Requires a live embedder; the semantic arm is part of what is being measured.
Results depend on the indexed corpus, so re-index before comparing runs.

## Status

Calibration is not evaluation. Placing a threshold sensibly between two observed
distributions says nothing about whether the gate is *good* — that requires a
held-out set the tuner did not author and a decision rule fixed in advance.

See row **C11** in `../vector-topology-primitives/canonical/CLAIMS.md` for the
current status and the promotion rule.
