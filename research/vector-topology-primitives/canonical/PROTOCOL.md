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

The candidate gate's false-accept and false-reject rates are computed by
`evaluate.ts` and reported, but no hypothesis above decides on them: they are
descriptive output, not a confirmatory endpoint. A gate threshold tuned to make
those numbers look good is therefore unfalsifiable under this protocol as written.
This is a known gap, tracked as C11.

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
