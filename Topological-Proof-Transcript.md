# Withdrawn historical transcript

**Status: WITHDRAWN — not evidence, not a benchmark result, and not a proof.**

An earlier version of this file reproduced output from the former
`src/evaluation/prove_topology.ts` script. That script selected a maximum-degree
hub instead of running vector k-nearest-neighbor retrieval, used incompatible
graph-density semantics, did not measure relevance or noise, and printed a
favorable conclusion regardless of evidence. Its output cannot support claims of
retrieval superiority, semantic isolation, a manifold, a mathematical guarantee,
or an LLM-quality improvement.

The historical text remains available through Git history for auditability. It is
removed from the active document because presenting invalid output beside the
canonical research bundle would make the repository internally contradictory.
The script now fails closed with exit status 2.

The only active scientific contract is:

- `research/vector-topology-primitives/canonical/CLAIMS.md`
- `research/vector-topology-primitives/canonical/PROTOCOL.md`
- `research/vector-topology-primitives/canonical/evaluate.ts`
- `research/vector-topology-primitives/canonical/paper.md`

Current result: **hybrid retrieval superiority is not demonstrated.**
