/**
 * WITHDRAWN EVALUATOR
 *
 * The former script did not compare topological retrieval with k-nearest-neighbor
 * retrieval. It compared a Louvain community around a highest-degree node with a
 * second highest-degree-node selection, labelled the latter "simulated k-NN",
 * hard-coded zero noise, and printed an unconditional approval. Those operations
 * cannot establish superiority, a manifold, semantic isolation, or a proof.
 *
 * This executable fails closed so old automation cannot cite its output as
 * scientific evidence. Use the versioned protocol and evaluator under
 * research/vector-topology-primitives/canonical instead.
 */

export const TOPOLOGY_PROOF_WITHDRAWAL = Object.freeze({
  status: "withdrawn",
  reason: "The historical baseline, noise measurement, and conclusion were invalid.",
  replacement: "research/vector-topology-primitives/canonical/PROTOCOL.md",
});

export function runWithdrawnTopologyProof(): never {
  throw new Error(
    `WITHDRAWN: ${TOPOLOGY_PROOF_WITHDRAWAL.reason} ` +
    `See ${TOPOLOGY_PROOF_WITHDRAWAL.replacement}.`
  );
}

if (require.main === module) {
  console.error(JSON.stringify(TOPOLOGY_PROOF_WITHDRAWAL, null, 2));
  process.exitCode = 2;
}
