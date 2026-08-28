---
title: "Governed Hybrid Graph Memory: An Auditable System and Falsifiable Evaluation Protocol"
author: "Eyal Nof"
date: "2026-08-28"
lang: en
bibliography: references.bib
link-citations: true
geometry: margin=1in
fontsize: 11pt
abstract: |
  We describe a local-first memory and retrieval implementation that combines
  vector similarity, lexical retrieval, reciprocal-rank fusion, and relation
  expansion while tracking relation origin and admission. The contribution
  established here is an engineering artifact and a falsifiable evaluation
  protocol. We do not report a theorem, a manifold construction, a physical model,
  or an empirical superiority result. A historical script that claimed to prove
  topological retrieval superiority is withdrawn because it did not implement its
  stated baseline and contained an unmeasured conclusion. We specify neutral
  baselines, adversarial ablations, held-out relevance judgments, nDCG@10, paired
  bootstrap confidence intervals, permutation tests, and explicit negative
  outcomes. Until a frozen benchmark is executed, retrieval superiority remains
  not demonstrated.
---

# 1. Problem and contribution boundary

Long-running coding and research workflows need local context that survives a
single model conversation. Vector search retrieves semantic neighbors; lexical
search retrieves exact identifiers; explicit dependency relations can retrieve
structurally adjacent material. Combining them is useful engineering, but it does
not by itself establish a new mathematical topology or a performance advantage.

Graph-enabled RAG and topology-aware retrieval already exist in several forms.
GraphRAG constructs graph indexes and community summaries for corpus-level
questions [@edge2024graphrag]. G-Retriever selects relevant textual subgraphs using
a prize-collecting Steiner-tree formulation [@he2024gretriever]. Topology-aware RAG
has directly investigated proximity- and role-based graph relations
[@wang2024topology]. Consequently, the broad statement “use graph topology in RAG”
cannot be treated as novel here.

The presently defensible contribution has two parts:

1. a governed implementation in which declared, AST-observed, model-inferred, and
   legacy-unknown edges have different trust standing; and
2. an executable evaluator that can reject a favored conclusion when fixed-budget
   held-out evidence is insufficient.

The implementation also includes a live graph renderer and standalone HTML
exporter. These surfaces make admitted relations, node degree, descriptions, and
community labels inspectable. Their deterministic force-directed display is a
debugging and communication aid; display coordinates are not measurements of an
intrinsic latent geometry.

No mathematical contribution is claimed. Novelty beyond this implementation
combination requires a systematic literature review and comparison with primary
prior art.

# 2. System definition

Let the corpus contain retrievable records $D$, query $q$, and an admitted directed
relation multigraph $G=(V,E)$. Each relation stores its origin, admission status,
namespace, source, confidence, and (for model output) model provenance. Default
retrieval admits only `declared` and `observed_ast` edges whose status is
`admitted`. Predicted edges are candidates and cannot self-promote.

For nonzero embedding vectors $q,d\in\mathbb{R}^p$, semantic similarity is

$$s_{\mathrm{cos}}(q,d)=\frac{q^\top d}{\lVert q\rVert_2\lVert d\rVert_2}.$$

Semantic, lexical, and graph rankings are combined with weighted reciprocal-rank
fusion,

$$s_{\mathrm{RRF}}(d)=\sum_{m\in M}\frac{w_m}{k+r_m(d)+1},$$

a standard rank-fusion family [@cormack2009rrf]. A time-decay factor may affect
ranking, but is a policy signal rather than evidence that newer content is true.

The disambiguation gate accepts a retrieval when it has exact trigger,
symbol, or heading evidence, or when the best raw cosine score meets a declared
threshold. It does not compare the differently scaled RRF score with a cosine
threshold. Access counters update only after the gate accepts real results.

# 3. Engineering invariants and threat model

The repaired implementation is designed around the following falsifiable
invariants:

- malformed configuration and corrupt index manifests fail closed;
- traversal is sorted and bounded by depth, file count, file size, and total bytes;
- an incomplete scan cannot trigger deletion-based index replacement;
- staged indexing mutates the database in one transaction;
- inferred and legacy-unknown relations are excluded by default;
- operational asset admission requires a nonempty human reviewer;
- the historical global-hive export path is disabled;
- the JSON-RPC server separates parse, envelope, method, parameter, internal, and
  permission errors;
- the dashboard defaults to loopback and escapes stored values.

These are program properties supported by tests, not theorems about all possible
deployments. Residual risks include denial of service within configured bounds,
the absence of dashboard authentication, a browser dependency allowed from
`unpkg.com`, compromised local model services, assessor bias, and incorrect
explicit relations.

# 4. Withdrawal of the historical proof

The historical evaluator selected the maximum-degree node, compared its Louvain
community with another list of maximum-degree nodes, called that list “simulated
kNN,” hard-coded zero noise, and emitted unconditional approval. It never computed
nearest neighbors from embeddings. Its density denominator also silently assumed a
directed simple graph, while stored relations may require explicit direction and
multiedge semantics.

Therefore the result cannot establish any of the following: kNN degradation,
topological superiority, semantic isolation, a manifold, zero noise, or a
guarantee. The executable now fails closed and points to the replacement protocol.

# 5. Evaluation protocol

The frozen protocol compares exact cosine top-k, lexical-only, semantic+lexical
RRF, graph-only, the production hybrid, a no-provenance ablation, a
degree-preserving shuffled-edge control, and the historical hub heuristic as a
negative control. All systems share the same query, candidate universe, namespace,
timestamp cutoff, output $K$, and maximum candidate-evaluation budget.

For graded relevance $\mathrm{rel}_i$,

$$\mathrm{DCG}@K=\sum_{i=1}^{K}\frac{2^{\mathrm{rel}_i}-1}{\log_2(i+1)},\qquad
\mathrm{nDCG}@K=\frac{\mathrm{DCG}@K}{\mathrm{IDCG}@K}.$$

The primary endpoint is macro mean nDCG@10 on answerable queries. Negative and
underspecified queries are evaluated through gate false-accept and false-reject
rates rather than being assigned zero ideal DCG. Confirmatory analysis averages
each query across seeds 0--9, then uses a query-type-stratified paired bootstrap with
10,000 resamples, a paired sign-flip permutation test with 10,000 resamples, and
Holm familywise correction. A superiority comparison is confirmed only when the
mean improvement is at least 0.02, the 95% confidence interval lower bound exceeds
0.02, adjusted $p<0.05$, and at least eight of ten seed deltas are positive.

The current executable binds confirmatory input to candidate B4, baselines
B0/B2/B6, the full freeze manifest, the declared query roster, and seeds 0--9. It
can decide only H1--H3. H4--H6 still require distinct executable analyses for
non-inferiority and safety, quantization, and blinded answer scoring.

The protocol also reports recall, precision, measured noise, namespace leakage,
relation coverage, latency, memory, and gate error rates. Any namespace leakage is
an engineering failure. Quantization studies distinguish embedding-vector
quantization from model-weight quantization and compare FP32, FP16, and a fully
specified INT4 transformation using neighbor Jaccard overlap, Kendall $\tau_b$,
and edge-distance error.

Adversarial cases include poisoned inferred edges, wrong namespaces, disconnected
graphs, singleton and zero-edge communities, duplicate/multiedges, hubs,
identifier-free paraphrases, irrelevant structural neighbors, shuffled edges, and
post-cutoff information.

# 6. Mathematics and physics boundary

Directed graphs can support legitimate algebraic-topological constructions; path
homology, for example, defines chain-like structures for digraphs
[@grigoryan2012path]. But naming graph neighborhoods “manifolds” does not construct
a manifold. Likewise, $\partial^2=0$ is a consistency identity once a chain complex
is defined; it does not prove that a retrieval ontology is complete or meaningful.

Maggie Miller's documented research concerns geometric low-dimensional topology,
especially surfaces embedded in 4-manifolds, isotopy, concordance, complements,
and related structures [@millerresearch]. No reviewed source used here connects
that work to this retrieval architecture or to general relativity.

In relativity, four-dimensional spacetime combines three spatial coordinates with
time, and general relativity relates physical spacetime geometry to gravity
[@einsteinonline]. A four-manifold in geometric topology is therefore not
automatically physical spacetime. A retrieval model would need an explicitly
defined differentiable manifold, metric tensor and signature, observable mapping,
field/dynamical equations, and out-of-sample predictive advantage before a
relativity claim could be evaluated.

Motion and parallax can supply multiple observations that reveal depth or temporal
change. That intuition motivates a possible temporal/multi-view retrieval
experiment. It does not prove an additional spatial dimension. The required future
dataset must record entity, time, viewpoint, observation, and held-out targets,
then compare against lower-dimensional and nontemporal alternatives.

# 7. Results presently supported

The software build, typecheck, alignment controls, and hostile regression suite can
support the implementation invariants after independent rerun. The evaluator smoke
test supports only contract behavior: invalid budgets, duplicate rankings,
positive relevance on negative queries, arbitrary confirmatory candidates,
incomplete baseline rosters, and absent freeze metadata are rejected; smoke mode
cannot issue a scientific claim.

No frozen corpus with blinded relevance judgments and no confirmatory run receipt
is included at this stage. Therefore:

> **Hybrid retrieval superiority is not demonstrated.**

This is not a negative judgment about the idea. It is the only result licensed by
the available evidence.

# 8. What qualifies as contributing

The repository can objectively contribute a useful software artifact: provenance-
typed graph memory, review-gated inferred relations, transactional indexing,
fail-closed controls, and a reusable evaluation harness. That contribution can be
inspected and reproduced even if the primary empirical hypothesis later fails.

An empirical research contribution requires the frozen benchmark and prespecified
results. A mathematical contribution requires a new formal statement and proof.
A physics contribution requires a physical model and discriminating predictions.
None of those stronger categories follows from terminology or architectural fit.

# 9. Conclusion

The collision between graph memory and topology is productive when it generates
clear definitions, controls, and experiments. The repaired project converts an
unconditional narrative into a governed engineering artifact and a falsifiable
research program. Its present result is deliberately bounded: implementation
invariants are testable; broad superiority, manifold, and relativity claims remain
unproved.

# References
