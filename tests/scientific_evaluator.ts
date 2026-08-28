import assert from "node:assert/strict";
import { evaluateBundle, EvaluationBundle } from "../research/vector-topology-primitives/canonical/evaluate";

const bundle: EvaluationBundle = {
  protocolVersion: "1.0",
  studyMode: "smoke",
  seeds: [0],
  cutoff: 10,
  candidate: "B4",
  baselines: ["B0"],
  queries: [
    { id: "q1", split: "test", queryType: "symbol", answerable: true, relevance: { relevant: 3, partial: 1 } },
    { id: "q2", split: "test", queryType: "negative", answerable: false, relevance: {} },
  ],
  systems: {
    B4: {
      budget: { outputK: 10, candidateEvaluations: 40 },
      runs: { "0": { q1: ["relevant", "partial"], q2: [] } },
    },
    B0: {
      budget: { outputK: 10, candidateEvaluations: 40 },
      runs: { "0": { q1: ["noise", "relevant"], q2: ["noise"] } },
    },
  },
  candidateGateResults: {
    "0": { q1: "accepted", q2: "disambiguation" },
  },
};

const result = evaluateBundle(bundle);
assert.equal(result.overallDecision, "smoke_only_no_scientific_claim");
assert.equal(result.comparisons[0].decision, "smoke_only");
assert(result.comparisons[0].meanDelta > 0);
assert.equal(result.answerableTestQueryCount, 1);
assert.deepEqual(result.candidateGate, {
  falseAcceptRate: 0,
  falseRejectRate: 0,
  evaluatedOutcomes: 2,
});
assert.deepEqual(result.protocolCoverage.notEvaluated, ["H4", "H5", "H6"]);

const unfair = structuredClone(bundle);
unfair.systems.B0.budget.candidateEvaluations = 10;
assert.throws(() => evaluateBundle(unfair), /Budget mismatch/);

const duplicate = structuredClone(bundle);
duplicate.systems.B0.runs["0"].q1 = ["relevant", "relevant"];
assert.throws(() => evaluateBundle(duplicate), /Duplicate document/);

const falsePositiveNegative = structuredClone(bundle);
falsePositiveNegative.queries[1].relevance = { hallucination: 3 };
assert.throws(() => evaluateBundle(falsePositiveNegative), /Negative query has positive relevance/);

const forged = structuredClone(bundle) as EvaluationBundle;
forged.studyMode = "confirmatory";
forged.candidate = "FAVORITE";
forged.baselines = ["STRAW"];
forged.systems = { FAVORITE: bundle.systems.B4, STRAW: bundle.systems.B0 };
assert.throws(() => evaluateBundle(forged), /Confirmatory candidate must be B4/);

const missingFreeze = structuredClone(bundle) as EvaluationBundle;
missingFreeze.studyMode = "confirmatory";
missingFreeze.seeds = [0,1,2,3,4,5,6,7,8,9];
missingFreeze.baselines = ["B0", "B2", "B6"];
missingFreeze.systems.B2 = structuredClone(bundle.systems.B0);
missingFreeze.systems.B6 = structuredClone(bundle.systems.B0);
assert.throws(() => evaluateBundle(missingFreeze), /freeze manifest/i);

console.log("scientific evaluator contract: pass (smoke cannot claim; forged confirmation rejected)");
