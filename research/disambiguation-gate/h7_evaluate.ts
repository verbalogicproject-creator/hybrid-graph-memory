/**
 * Executes hypothesis H7 from PROTOCOL.md against a split of the mechanical query
 * pool. The decision rule is not defined here -- it is transcribed from the
 * declaration, which was committed before the pool was generated.
 *
 *   npx tsx research/disambiguation-gate/h7_evaluate.ts --split dev
 *   npx tsx research/disambiguation-gate/h7_evaluate.ts --split test
 *
 * The test split is to be run exactly once. A failure is recorded as
 * "not demonstrated"; the thresholds may not then be retuned and this same split
 * rerun. Requires a live embedder.
 */
import fs from "node:fs";
import path from "node:path";
import { MemoryEngine } from "../../src/core/engine";
import { loadMemoryConfig } from "../../src/core/config";

const BOUNDS = {
  // H7a: safety. H7b: utility. Transcribed from PROTOCOL.md section "H7".
  falseAccept: { rate: 0.05, upper: 0.10 },
  falseReject: { rate: 0.10, upper: 0.20 },
};
const Z = 1.959963985;

interface PoolQuery {
  id: string; query: string; answerable: boolean; source: string; split: "dev" | "test";
}

/** 95% Wilson score interval; normal-approximation intervals are unusable near 0. */
function wilson(successes: number, n: number): { rate: number; lower: number; upper: number } {
  if (n === 0) return { rate: NaN, lower: NaN, upper: NaN };
  const p = successes / n;
  const denominator = 1 + (Z * Z) / n;
  const center = (p + (Z * Z) / (2 * n)) / denominator;
  const half = (Z / denominator) * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n));
  return { rate: p, lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
}

async function main() {
  const splitArgument = process.argv[process.argv.indexOf("--split") + 1];
  if (splitArgument !== "dev" && splitArgument !== "test") {
    console.error("Usage: tsx h7_evaluate.ts --split <dev|test>");
    process.exitCode = 2;
    return;
  }

  // Attempt 1's pool stays the default so its run remains reproducible; later
  // attempts pass their own bundle explicitly.
  const poolArgument = process.argv.indexOf("--pool");
  const poolFile = poolArgument >= 0 ? process.argv[poolArgument + 1] : "h7_pool.json";
  const pool = JSON.parse(fs.readFileSync(path.join(__dirname, poolFile), "utf8"));
  const queries: PoolQuery[] = pool.queries.filter((q: PoolQuery) => q.split === splitArgument);
  const config = loadMemoryConfig(path.resolve(__dirname, "../.."));

  const engine = new MemoryEngine();
  await engine.init();

  const observations: Array<PoolQuery & { accepted: boolean; semantic?: number; coverage?: number }> = [];
  for (const query of queries) {
    const results = await engine.search(query.query);
    const gate = (engine as any).retriever?.lastSearchStats?.gate;
    observations.push({
      ...query,
      // An empty result set is not an acceptance. The gate has three outcomes,
      // not two: substantive results, an explicit disambiguation request, or
      // nothing clearing minSimilarityThreshold. Treating the third as an
      // acceptance inflates false accepts and, worse, hides false rejects --
      // an answerable query that returns nothing was scored as answered.
      accepted:
        results.length > 0 &&
        !(results.length === 1 && results[0].id === "DISAMBIGUATION_REQUIRED"),
      semantic: gate?.topSemanticScore,
      coverage: gate?.topLexicalScore,
    });
  }

  const answerable = observations.filter((o) => o.answerable);
  const negative = observations.filter((o) => !o.answerable);
  const falseAccept = wilson(negative.filter((o) => o.accepted).length, negative.length);
  const falseReject = wilson(answerable.filter((o) => !o.accepted).length, answerable.length);

  const h7a = falseAccept.rate <= BOUNDS.falseAccept.rate && falseAccept.upper <= BOUNDS.falseAccept.upper;
  const h7b = falseReject.rate <= BOUNDS.falseReject.rate && falseReject.upper <= BOUNDS.falseReject.upper;
  const refuted = (endpoint: typeof falseAccept, bound: number) => endpoint.lower > bound;

  const bySource = [...new Set(observations.map((o) => o.source))].map((source) => {
    const rows = observations.filter((o) => o.source === source);
    const wrong = rows.filter((o) => (o.answerable ? !o.accepted : o.accepted)).length;
    return { source, n: rows.length, errors: wrong, errorRate: Number((wrong / rows.length).toFixed(4)) };
  });

  const report = {
    poolId: pool.poolId, split: splitArgument, gitCommit: pool.gitCommit,
    baselineCommit: pool.baselineCommit,
    thresholds: {
      disambiguationThreshold: config.disambiguationThreshold,
      lexicalEvidenceThreshold: config.lexicalEvidenceThreshold,
    },
    counts: { total: observations.length, answerable: answerable.length, negative: negative.length },
    falseAccept: { ...falseAccept, bound: BOUNDS.falseAccept, pass: h7a },
    falseReject: { ...falseReject, bound: BOUNDS.falseReject, pass: h7b },
    bySource,
    decision: splitArgument === "dev"
      ? "development_split_no_claim"
      : h7a && h7b
        ? "H7_confirmed"
        : refuted(falseAccept, BOUNDS.falseAccept.rate) || refuted(falseReject, BOUNDS.falseReject.rate)
          ? "H7_direction_refuted"
          : "H7_not_demonstrated",
    errors: observations
      .filter((o) => (o.answerable ? !o.accepted : o.accepted))
      .map((o) => ({ source: o.source, query: o.query, answerable: o.answerable, semantic: o.semantic, coverage: o.coverage })),
  };

  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
