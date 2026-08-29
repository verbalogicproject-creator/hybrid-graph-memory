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

- `generate_queries.ts` — builds the H7 pool mechanically from repository content
  as it stood at `984fa09`, before any gate work began, plus generated negatives.
- `h7_pool.json` — 266 queries: 66 answerable, 200 negative, split development /
  test by SHA-256 parity of the query text.
- `h7_evaluate.ts` — executes the H7 decision rule transcribed from `PROTOCOL.md`.
- `h7_test_result.json` — the single test-split run.

```sh
npx tsx research/disambiguation-gate/generate_queries.ts
npx tsx research/disambiguation-gate/h7_evaluate.ts --split dev
npx tsx research/disambiguation-gate/h7_evaluate.ts --split test
```

## Result

H7 was confirmed on 2026-08-29 against the held-out test split: 0 false accepts
of 96 negative queries (95% Wilson upper bound 0.039) and 0 false rejects of 31
answerable ones (upper bound 0.110), with thresholds frozen at commit `e245aa9`.

The development split did real work rather than rubber-stamping the design: it
accepted seven of fifty-four content-free queries, all of which reduced to the
single token `without`, missing from the stop-word class. That was fixed, and the
configuration frozen, before the test split was run once.

## What this does and does not establish

It establishes that on **this** corpus, with **this** embedder, the gate separated
answerable from unanswerable queries without error on queries the tuner did not
write. The bounds are what 127 queries support: the false-reject upper bound is
0.110, so "rarely refuses answerable queries" holds only to about that precision.

It is not evidence that retrieval *quality* is good — that is C4–C6, needs graded
relevance from assessors blinded to method, and remains not demonstrated. It is
also unreplicated: one corpus, one embedder, and answerability labelled by source
rather than verified per query.

See row **C11** in `../vector-topology-primitives/canonical/CLAIMS.md`.
