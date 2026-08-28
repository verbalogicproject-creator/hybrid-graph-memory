import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

type Split = "dev" | "test";
type GateOutcome = "accepted" | "disambiguation";
interface Query {
  id: string;
  split: Split;
  queryType: string;
  answerable: boolean;
  relevance: Record<string, number>;
}
interface Budget { outputK: number; candidateEvaluations: number; }
interface SystemRuns { budget: Budget; runs: Record<string, Record<string, string[]>>; }
export interface FreezeManifest {
  gitCommit: string;
  corpusSha256: string;
  judgmentsSha256: string;
  configSha256: string;
  weightsSha256: string;
  embeddingModel: string;
  embeddingChecksum: string;
  embeddingPrecision: string;
  relationTableSha256: string;
  timestampCutoff: string;
  namespacePolicy: string;
  inferredEdgePolicy: string;
}
export interface EvaluationBundle {
  protocolVersion: "1.0";
  studyMode: "smoke" | "confirmatory";
  seeds: number[];
  cutoff: 10;
  candidate: string;
  baselines: string[];
  queries: Query[];
  systems: Record<string, SystemRuns>;
  freeze?: FreezeManifest;
  candidateGateResults?: Record<string, Record<string, GateOutcome>>;
}
interface Comparison {
  hypothesis: "H1" | "H2" | "H3";
  baseline: "B0" | "B2" | "B6";
  meanDelta: number;
  ci95: [number, number];
  rawP: number;
  holmAdjustedP: number;
  positiveSeeds: number;
  decision: "confirmed" | "refuted_direction" | "not_demonstrated" | "smoke_only";
}

const CONFIRMATORY_BASELINES = ["B0", "B2", "B6"] as const;
const HYPOTHESIS_BY_BASELINE = { B0: "H1", B2: "H2", B6: "H3" } as const;

function mean(values: number[]): number {
  assert(values.length > 0, "Cannot calculate a mean over an empty sample");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ndcg(ranking: string[], relevance: Record<string, number>, cutoff: number): number {
  const gain = (grade: number) => Math.pow(2, grade) - 1;
  const dcg = ranking.slice(0, cutoff).reduce(
    (sum, docId, index) => sum + gain(relevance[docId] || 0) / Math.log2(index + 2), 0
  );
  const ideal = Object.values(relevance)
    .sort((a, b) => b - a)
    .slice(0, cutoff)
    .reduce((sum, grade, index) => sum + gain(grade) / Math.log2(index + 2), 0);
  return ideal === 0 ? 0 : dcg / ideal;
}

function rng(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function percentile(sorted: number[], probability: number): number {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * fraction;
}

function stratifiedBootstrap(deltas: number[], strata: string[], count = 10_000): [number, number] {
  const groups = new Map<string, number[]>();
  strata.forEach((stratum, index) => groups.set(stratum, [...(groups.get(stratum) || []), index]));
  const random = rng(0x51a7f1ed);
  const samples: number[] = [];
  for (let iteration = 0; iteration < count; iteration += 1) {
    const drawn: number[] = [];
    for (const indices of groups.values()) {
      for (let index = 0; index < indices.length; index += 1) {
        drawn.push(deltas[indices[Math.floor(random() * indices.length)]]);
      }
    }
    samples.push(mean(drawn));
  }
  samples.sort((a, b) => a - b);
  return [percentile(samples, 0.025), percentile(samples, 0.975)];
}

function signFlipP(deltas: number[], count = 10_000): number {
  const observed = Math.abs(mean(deltas));
  if (observed === 0) return 1;
  const random = rng(0x70f4a11);
  let extreme = 0;
  for (let iteration = 0; iteration < count; iteration += 1) {
    const permuted = deltas.map((delta) => random() < 0.5 ? delta : -delta);
    if (Math.abs(mean(permuted)) >= observed) extreme += 1;
  }
  return (extreme + 1) / (count + 1);
}

function assertFreezeManifest(freeze: FreezeManifest | undefined): asserts freeze is FreezeManifest {
  assert(freeze, "Confirmatory mode requires a freeze manifest");
  assert.match(freeze.gitCommit, /^[0-9a-f]{40}$/i, "Freeze gitCommit must be a full commit hash");
  for (const field of ["corpusSha256", "judgmentsSha256", "configSha256", "weightsSha256", "embeddingChecksum", "relationTableSha256"] as const) {
    assert.match(freeze[field], /^[0-9a-f]{64}$/i, `Freeze ${field} must be SHA-256`);
  }
  for (const field of ["embeddingModel", "embeddingPrecision", "namespacePolicy", "inferredEdgePolicy"] as const) {
    assert(freeze[field].trim().length > 0, `Freeze ${field} must be nonblank`);
  }
  assert(freeze.timestampCutoff.trim().length > 0 && Number.isFinite(Date.parse(freeze.timestampCutoff)),
    "Freeze timestampCutoff must be an ISO-compatible timestamp");
}

function validate(bundle: EvaluationBundle) {
  assert.equal(bundle.protocolVersion, "1.0");
  assert(bundle.studyMode === "smoke" || bundle.studyMode === "confirmatory", "Unknown study mode");
  assert.equal(bundle.cutoff, 10);
  assert(bundle.queries.length > 0);
  assert(bundle.seeds.length > 0 && bundle.seeds.every(Number.isInteger), "Seeds must be nonempty integers");
  assert.equal(new Set(bundle.seeds).size, bundle.seeds.length, "Seeds must be unique");
  assert(bundle.baselines.length > 0 && !bundle.baselines.includes(bundle.candidate));
  assert.equal(new Set(bundle.baselines).size, bundle.baselines.length, "Baselines must be unique");

  const queryIds = bundle.queries.map((query) => query.id);
  assert(queryIds.every((id) => id.trim().length > 0), "Query IDs must be nonblank");
  assert.equal(new Set(queryIds).size, queryIds.length, "Query IDs must be unique");
  for (const query of bundle.queries) {
    assert(query.split === "dev" || query.split === "test", `Invalid split for ${query.id}`);
    assert.equal(typeof query.answerable, "boolean", `Missing answerable label for ${query.id}`);
    assert.equal(query.queryType === "negative", !query.answerable,
      `Only negative queries may be unanswerable: ${query.id}`);
    const grades = Object.values(query.relevance);
    assert(grades.every((grade) => Number.isInteger(grade) && grade >= 0 && grade <= 3),
      `Relevance grades must be integers in [0,3]: ${query.id}`);
    if (query.answerable) {
      assert(grades.some((grade) => grade > 0), `Answerable query has no relevant document: ${query.id}`);
    } else {
      assert(grades.every((grade) => grade === 0), `Negative query has positive relevance: ${query.id}`);
    }
  }

  if (bundle.studyMode === "confirmatory") {
    assert.equal(bundle.candidate, "B4", "Confirmatory candidate must be B4");
    assert.deepEqual([...bundle.baselines].sort(), [...CONFIRMATORY_BASELINES],
      "Confirmatory baseline roster must be exactly B0, B2, and B6");
    assert.deepEqual(bundle.seeds, [0,1,2,3,4,5,6,7,8,9]);
    assertFreezeManifest(bundle.freeze);
    assert(bundle.candidateGateResults, "Confirmatory mode requires candidate gate results");
    const dev = bundle.queries.filter((query) => query.split === "dev");
    const test = bundle.queries.filter((query) => query.split === "test");
    assert(dev.length >= 100, "Confirmatory mode requires at least 100 dev queries");
    assert(test.length >= 300, "Confirmatory mode requires at least 300 test queries");
    for (const type of ["symbol", "architecture", "causal", "cross_cluster", "negative"]) {
      assert(test.filter((query) => query.queryType === type).length >= 50, `Need at least 50 ${type} test queries`);
    }
  }

  assert(bundle.baselines.every((baseline) => baseline in HYPOTHESIS_BY_BASELINE),
    "Evaluator baselines must have registered hypotheses: B0, B2, or B6");

  const requiredSystems = [bundle.candidate, ...bundle.baselines];
  requiredSystems.forEach((name) => assert(bundle.systems[name], `Missing system ${name}`));
  const budget = bundle.systems[bundle.candidate].budget;
  assert.equal(budget.outputK, bundle.cutoff);
  assert(Number.isInteger(budget.candidateEvaluations) && budget.candidateEvaluations >= bundle.cutoff,
    "candidateEvaluations must be an integer at least as large as outputK");
  requiredSystems.forEach((name) => {
    assert.equal(bundle.systems[name].budget.outputK, budget.outputK, `Budget mismatch for ${name}`);
    assert.equal(bundle.systems[name].budget.candidateEvaluations, budget.candidateEvaluations,
      `Budget mismatch for ${name}`);
  });

  for (const systemName of requiredSystems) for (const seed of bundle.seeds) for (const query of bundle.queries) {
    const ranking = bundle.systems[systemName].runs[String(seed)]?.[query.id];
    assert(ranking, `Missing run: ${systemName}/seed=${seed}/${query.id}`);
    assert(ranking.length <= bundle.cutoff, `Output budget exceeded: ${systemName}/${query.id}`);
    assert.equal(new Set(ranking).size, ranking.length, `Duplicate document: ${systemName}/${query.id}`);
  }
  if (bundle.candidateGateResults) {
    for (const seed of bundle.seeds) for (const query of bundle.queries) {
      const outcome = bundle.candidateGateResults[String(seed)]?.[query.id];
      assert(outcome === "accepted" || outcome === "disambiguation",
        `Missing or invalid candidate gate result: seed=${seed}/${query.id}`);
    }
  }
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function evaluateBundle(bundle: EvaluationBundle) {
  validate(bundle);
  const allTestQueries = bundle.queries.filter((query) => query.split === "test");
  const queries = allTestQueries.filter((query) => query.answerable);
  assert(queries.length > 0, "At least one answerable test query is required");
  const scores = new Map<string, number[][]>();
  for (const name of [bundle.candidate, ...bundle.baselines]) {
    scores.set(name, bundle.seeds.map((seed) => queries.map((query) =>
      ndcg(bundle.systems[name].runs[String(seed)][query.id], query.relevance, bundle.cutoff)
    )));
  }
  const comparisons: Comparison[] = bundle.baselines.map((baseline) => {
    const typedBaseline = baseline as keyof typeof HYPOTHESIS_BY_BASELINE;
    const candidateScores = scores.get(bundle.candidate)!;
    const baselineScores = scores.get(baseline)!;
    const perQuery = queries.map((_, queryIndex) => mean(bundle.seeds.map((__, seedIndex) =>
      candidateScores[seedIndex][queryIndex] - baselineScores[seedIndex][queryIndex]
    )));
    const perSeed = bundle.seeds.map((_, seedIndex) => mean(queries.map((__, queryIndex) =>
      candidateScores[seedIndex][queryIndex] - baselineScores[seedIndex][queryIndex]
    )));
    return {
      hypothesis: HYPOTHESIS_BY_BASELINE[typedBaseline],
      baseline: typedBaseline,
      meanDelta: mean(perQuery),
      ci95: stratifiedBootstrap(perQuery, queries.map((query) => query.queryType)),
      rawP: signFlipP(perQuery),
      holmAdjustedP: 1,
      positiveSeeds: perSeed.filter((delta) => delta > 0).length,
      decision: "not_demonstrated",
    };
  });
  const ordered = [...comparisons].sort((a, b) => a.rawP - b.rawP);
  let runningAdjusted = 0;
  ordered.forEach((comparison, index) => {
    runningAdjusted = Math.max(runningAdjusted, Math.min(1, comparison.rawP * (ordered.length - index)));
    comparison.holmAdjustedP = runningAdjusted;
  });
  for (const comparison of comparisons) {
    comparison.decision = bundle.studyMode === "smoke" ? "smoke_only"
      : comparison.meanDelta >= 0.02 && comparison.ci95[0] > 0.02 && comparison.holmAdjustedP < 0.05 && comparison.positiveSeeds >= 8
        ? "confirmed"
        : comparison.ci95[1] <= 0 ? "refuted_direction" : "not_demonstrated";
  }

  const gateOutcomes = bundle.candidateGateResults
    ? bundle.seeds.flatMap((seed) => allTestQueries.map((query) => ({
      answerable: query.answerable,
      outcome: bundle.candidateGateResults![String(seed)][query.id],
    })))
    : [];
  const answerableGateOutcomes = gateOutcomes.filter((item) => item.answerable);
  const negativeGateOutcomes = gateOutcomes.filter((item) => !item.answerable);

  return {
    protocolVersion: bundle.protocolVersion,
    inputSha256: crypto.createHash("sha256").update(JSON.stringify(bundle)).digest("hex"),
    studyMode: bundle.studyMode,
    primaryMetric: "macro_nDCG@10_on_answerable_test_queries",
    testQueryCount: allTestQueries.length,
    answerableTestQueryCount: queries.length,
    seedCount: bundle.seeds.length,
    candidateGate: bundle.candidateGateResults ? {
      falseAcceptRate: rate(
        negativeGateOutcomes.filter((item) => item.outcome === "accepted").length,
        negativeGateOutcomes.length
      ),
      falseRejectRate: rate(
        answerableGateOutcomes.filter((item) => item.outcome === "disambiguation").length,
        answerableGateOutcomes.length
      ),
      evaluatedOutcomes: gateOutcomes.length,
    } : null,
    comparisons,
    protocolCoverage: {
      evaluated: ["H1", "H2", "H3"],
      notEvaluated: ["H4", "H5", "H6"],
      note: "No executable claim for non-inferiority, quantization, or answer generation.",
    },
    overallDecision: bundle.studyMode === "confirmatory" && comparisons.every((item) => item.decision === "confirmed")
      ? "retrieval_h1_h2_h3_confirmed"
      : bundle.studyMode === "smoke" ? "smoke_only_no_scientific_claim" : "retrieval_h1_h2_h3_not_demonstrated",
  };
}

if (require.main === module) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: tsx evaluate.ts <frozen-evaluation-bundle.json>");
    process.exitCode = 2;
  } else {
    const bundle = JSON.parse(fs.readFileSync(inputPath, "utf8")) as EvaluationBundle;
    console.log(JSON.stringify(evaluateBundle(bundle), null, 2));
  }
}
