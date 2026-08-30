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
  Takes `--pool` so each attempt keeps its own bundle.
- `h7_pool.json` / `h7_test_result.json` — attempt 1.
- `h7_pool_attempt2.json` / `h7_test_result_attempt2.json` — attempt 2.

```sh
npx tsx research/disambiguation-gate/generate_queries.ts
npx tsx research/disambiguation-gate/h7_evaluate.ts --pool h7_pool_attempt2.json --split dev
npx tsx research/disambiguation-gate/h7_evaluate.ts --pool h7_pool_attempt2.json --split test
```

Every file here that contains query text is in `excludedPathPrefixes`. That is not
tidiness: `generate_queries.ts` holds the off-topic vocabulary, and while it was
indexed "bake sourdough bread" was in the corpus verbatim and scored full lexical
coverage. A negative whose text appears in the corpus is not a negative.

## Results

### Attempt 2 — current, 2026-08-29

Confirmed against the held-out test split: **0 false accepts of 104 negatives**
(95% Wilson upper bound 0.036) and **0 false rejects of 32 answerable queries**
(upper 0.107), thresholds frozen at `52195e0` before the single run.

This attempt evaluates the complete `embeddinggemma-300m-q8` with EmbeddingGemma's
prompt prefixes. Attempt 1's configuration — a GGUF missing the model's projection
head, and no prefixes — is no longer served, which under `PROTOCOL.md` "Attempts
after the first" ends that result's applicability.

The development split again did real work. At the inherited threshold of 0.5 it
refused 4 of 34 answerable queries, an 11.8% false-reject rate against H7b's 10%
bound, and all four were commit subjects: the paraphrase class, which carries the
least lexical overlap and leans hardest on the semantic arm. 0.5 had been
calibrated against the unprojected space; the projected space runs lower. The
threshold moved to 0.32, near the middle of the only separating gap between
anchored negatives (max 0.261) and answerable queries (min 0.378), and the
configuration was frozen before the test split was run once.

The split rule is salted with the seed. Without that, answerable queries — which
are extracted deterministically from a pinned commit and so are byte-identical
across seeds — would have carried their attempt-1 split forward, handing attempt 2
a test set already consumed while the bundle truthfully reported a new seed. The
answerable test split still overlaps attempt 1's by 12 of 32; the rule requires a
new split, not a disjoint one, and none is claimed.

### Attempt 1 — superseded, kept

Confirmed on 2026-08-29 against its own held-out split: 0 false accepts of 96
negatives (upper 0.039), 0 false rejects of 31 answerable ones (upper 0.110),
thresholds frozen at `e245aa9`.

Its development split accepted seven of fifty-four content-free queries, all
reducing to the single token `without`, missing from the stop-word class; that was
fixed before the test run.

Two caveats found afterwards. The evaluator scored an empty result set as an
acceptance — harmless for the false-accept endpoint, since 0 false accepts means
every negative returned exactly the disambiguation request, but an answerable query
returning nothing was scored as answered, so the 0/31 may be optimistic. Only
aggregates were recorded, so it cannot be rechecked. The evaluator has since been
fixed.

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
