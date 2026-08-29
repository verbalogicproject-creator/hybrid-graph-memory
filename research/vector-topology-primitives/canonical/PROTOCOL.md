# Frozen evaluation protocol

## Question

Does provenance-governed relation evidence improve held-out retrieval under a fixed
budget, relative to actual vector kNN and neutral lexical/hybrid baselines?

This protocol does not test whether a repository is a manifold, whether a graph
distance is a Riemannian geodesic, or whether physical relativity describes
retrieval. Those statements are outside the instantiated model.

## Freeze boundary

Before the first test run, record the Git commit, corpus hash, judgments hash,
configuration hash, embedding model/checksum/precision, relation-table hash,
timestamp cutoff, namespace policy, inferred-edge policy, and all weights. Tune on
development only. Test judgments remain hidden until configuration is frozen.

The executable confirmatory bundle must supply these values in its `freeze`
manifest, including explicit embedding precision and a weights hash. Commit
identifiers must be full 40-hex hashes; content identifiers must be SHA-256 values.
Missing or malformed freeze metadata is a hard error, not a warning.

Use at least two relevance assessors blinded to method, adjudicate disagreements,
and report weighted Cohen's kappa. Group related tasks/paraphrases into one split.
Confirmatory data contain at least 100 development queries and 300 held-out test
queries, including at least 50 symbol, architecture, causal, cross-cluster, and
negative/underspecified queries. Predeclared runtime failures count as zero in the
primary intent-to-evaluate analysis.

## Baselines and ablations

All systems receive identical query text, admissible document set, namespace,
timestamp cutoff, output K, and maximum candidate-evaluation budget.

- B0: exact cosine top-k over the stored FP32 vectors.
- B1: production BM25 lexical-only.
- B2: semantic + lexical RRF, graph disabled.
- B3: graph-only from the same top-1 exact-vector seed, deterministic traversal.
- B4: production semantic + lexical + provenance-filtered graph RRF (candidate).
- B5: B4 without provenance-origin filtering (safety ablation).
- B6: B4 with degree-preserving shuffled edges within namespace.
- B7: highest-degree-node heuristic, explicitly a negative control, never “kNN.”

Repeat relevant systems with FP32, FP16, and one precisely specified INT4 embedding
quantizer. Model-weight quantization and embedding-vector quantization are distinct.
Seeds are exactly 0 through 9. Report K in {5,10,20}; nDCG@10 is primary.

## Metrics

For rank `i` beginning at 1 and graded relevance `rel_i`:

```text
DCG@K  = sum_i (2^rel_i - 1) / log2(i + 1)
nDCG@K = DCG@K / IDCG@K
```

Also report Recall@K, Precision@K, Noise@K = 1 - Precision@K, relation
coverage, p50/p95 latency, peak RSS, gate false accepts/rejects, and:

```text
Leak@K = count(retrieved documents outside allowed(query)) / K.
```

Any namespace leak is an engineering failure, not a small average loss. “0% noise”
is allowed only when every declared query has measured Noise@K=0 and the binomial
confidence bound is reported.

Quantization reports top-k Jaccard overlap, Kendall tau-b on the union (absent rank
K+1), and edge-distance relative error with median and 95th percentile.

## Confirmatory decisions

Primary nDCG is calculated only for answerable queries; negative/underspecified
queries instead contribute to the gate false-accept and false-reject endpoints.
Primary per-query values are averaged across seeds before inference. Use paired,
query-type-stratified bootstrap with 10,000 resamples and paired sign-flip
permutation tests with 10,000 resamples. Apply Holm correction across confirmatory
comparisons at familywise alpha 0.05. Publish raw per-query and per-seed deltas.

- H1: B4 beats B0. Confirm only if mean delta >= 0.02, the 95% CI lower bound is
  above 0.02, Holm-adjusted p < 0.05, and at least 8/10 seed deltas are positive.
- H2: B4 beats B2 under the same rule.
- H3: B4 beats shuffled-edge B6 under the same rule.
- H4: B4 is non-inferior to B5 in nDCG with margin -0.01 and improves or equals
  leakage/unsupported-relation rate; any leak fails safety.
- H5: graph anchoring reduces FP32-to-INT4 degradation relative to B0 by at least
  0.02, with the paired 95% CI wholly on the favorable side.
- H6: any answer-generation claim requires blinded atomic-claim scoring, at least
  five percentage points lower unsupported-claim rate, Holm-adjusted p < 0.05,
  and no correctness/nDCG loss worse than 0.02.

If a superiority CI upper bound is <=0, the stated direction is refuted on this
test. Every other failure to confirm is “not demonstrated,” not proof of equality.

## H7: the disambiguation gate

The candidate gate's false-accept and false-reject rates were previously computed
by `evaluate.ts` and reported without any hypothesis deciding on them, which left a
threshold tuned to flatter those numbers unfalsifiable. H7 closes that gap. It is
declared here in full before the test split is generated or run, and it governs
claim C11.

### Query classes

Queries carry a binary answerability label, not graded relevance, so H7 does not
require the relevance assessors that H1--H6 require. It does still require that the
queries not be authored by whoever tunes the thresholds.

- `answerable`: derived mechanically from repository artifacts, never composed for
  this evaluation. Declared sources, with the share of the class each contributes:
  markdown headings (verbatim phrasing, the easy case), Git commit subject lines
  (prose written by the repository's authors, frequently without symbol names, the
  paraphrase case the adversarial suite calls for), and the first sentence of
  documentation comments (the intermediate case).
- `off_topic`: unanswerable. Generated combinatorially from a question-template
  list and an everyday-domain vocabulary, both fixed in advance, so that individual
  queries are not selected one by one.
- `content_free`: unanswerable. Generated programmatically from a declared seed —
  punctuation runs, repeated characters, stop-word-only sequences, and random
  consonant strings.

### Split and freeze

The generated pool is split by a deterministic rule declared before generation:
SHA-256 of the query string, first byte even to development and odd to test.
Thresholds may be tuned on development only. The test split is run exactly once.

If the test split fails a bound, the recorded outcome is "not demonstrated." The
thresholds may not then be re-tuned and the same test split re-run; a subsequent
attempt requires a newly generated test split under a new seed.

### Decision rule

Let false accept be a negative query the gate answered and false reject be an
answerable query the gate refused. Report the 95% Wilson score interval for each.

- H7a (safety): false-accept rate on the pooled negative test split <= 0.05, with
  the Wilson upper bound <= 0.10.
- H7b (utility): false-reject rate on the answerable test split <= 0.10, with the
  Wilson upper bound <= 0.20.

Confirm H7 only if H7a and H7b both hold. Report the `off_topic` and
`content_free` rates separately as descriptive output; the H7a decision uses the
pooled negatives, as declared here, and is not re-cut by sub-class after the fact.
If a rate's Wilson lower bound exceeds its bound, the stated direction is refuted
on this test rather than merely not demonstrated.

### Declared weakness

The protocol requires assessors blinded to method. That is unavailable when the
same agent tunes the thresholds and runs the evaluation, so H7 substitutes a
procedural control: bounds and split rule fixed in advance, queries not authored by
the tuner, development-only tuning, and a single test run recorded whatever its
outcome. This is weaker than blinding and does not make H7 a substitute for the
assessor-graded hypotheses. Answerability labels are assigned by source rather than
verified per query: a commit subject describing since-removed code is labelled
answerable although it is not, which inflates the false-reject rate and therefore
biases against confirmation.



`evaluate.ts` currently instantiates only H1--H3 and therefore requires candidate
B4 and the exact B0/B2/B6 baseline roster in confirmatory mode. It cannot issue an
H4, H5, H6, whole-protocol, mathematical, or physics verdict. Those hypotheses
require separate executable analyses for non-inferiority/safety, quantization, and
blinded answer scoring before they can be evaluated.

## Adversarial suite

Include wrong namespaces, missing identity, poisoned high-confidence inferred
edges, disconnected and zero-edge graphs, singleton communities, duplicate and
parallel edges, hubs, paraphrases without symbol names, irrelevant hubs, timestamp
violations, and shuffled-edge controls. Prevent label leakage through AST names,
recency/access counts, graph construction, candidate-pool differences, or tuning.
