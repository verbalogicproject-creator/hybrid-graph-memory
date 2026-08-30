/**
 * Replays a labelled query set through the live disambiguation gate and reports,
 * per class, the observed score bands and the gate's actual verdicts.
 *
 * This is measurement plumbing, not an evaluator. It issues no verdict about
 * whether the gate is good; it reports what the gate did. Whether a given run
 * supports a claim is governed by the set's own `provenance` field and by
 * CLAIMS.md row C11 -- a set authored by the tuner can never support one.
 *
 *   npx tsx research/disambiguation-gate/run_gate_set.ts <set.json> [--json]
 *
 * Requires a live embedder, because the semantic arm is part of what is being
 * measured. It reads the index in place and mutates nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { MemoryEngine } from "../../src/core/engine";

interface QueryClass {
  answerable: boolean;
  queries: string[];
}

interface QuerySet {
  setId: string;
  provenance: string;
  classes: Record<string, QueryClass>;
}

interface Observation {
  className: string;
  query: string;
  answerable: boolean;
  semantic?: number;
  coverage?: number;
  accepted: boolean;
}

function band(values: number[]): string {
  if (values.length === 0) return "none";
  return `${Math.min(...values).toFixed(3)}-${Math.max(...values).toFixed(3)}`;
}

export async function runGateSet(set: QuerySet): Promise<Observation[]> {
  const engine = new MemoryEngine();
  await engine.init();
  const observations: Observation[] = [];

  for (const [className, group] of Object.entries(set.classes)) {
    for (const query of group.queries) {
      const results = await engine.search(query);
      const gate = (engine as any).retriever?.lastSearchStats?.gate;
      observations.push({
        className,
        query,
        answerable: group.answerable,
        semantic: gate?.topSemanticScore,
        coverage: gate?.topLexicalScore,
        // An empty result set is not an acceptance. The gate has three outcomes,
      // not two: substantive results, an explicit disambiguation request, or
      // nothing clearing minSimilarityThreshold. Treating the third as an
      // acceptance inflates false accepts and, worse, hides false rejects --
      // an answerable query that returns nothing was scored as answered.
      accepted:
        results.length > 0 &&
        !(results.length === 1 && results[0].id === "DISAMBIGUATION_REQUIRED"),
      });
    }
  }
  return observations;
}

function summarize(set: QuerySet, observations: Observation[]) {
  const classes = Object.keys(set.classes).map((className) => {
    const rows = observations.filter((o) => o.className === className);
    const semantic = rows.map((r) => r.semantic).filter((v): v is number => v !== undefined);
    const coverage = rows.map((r) => r.coverage).filter((v): v is number => v !== undefined);
    return {
      className,
      answerable: set.classes[className].answerable,
      count: rows.length,
      semanticBand: band(semantic),
      coverageBand: band(coverage),
      withoutLexicalSignal: rows.length - coverage.length,
      accepted: rows.filter((r) => r.accepted).length,
      refused: rows.filter((r) => !r.accepted).length,
    };
  });

  const answerable = observations.filter((o) => o.answerable);
  const negative = observations.filter((o) => !o.answerable);
  return {
    setId: set.setId,
    classes,
    // Reported, deliberately without a verdict: the decision rule for these two
    // rates lives in PROTOCOL.md (H7), not here.
    falseAcceptRate: negative.length ? negative.filter((o) => o.accepted).length / negative.length : null,
    falseRejectRate: answerable.length ? answerable.filter((o) => !o.accepted).length / answerable.length : null,
  };
}

if (require.main === module) {
  const setPath = process.argv[2];
  if (!setPath) {
    console.error("Usage: tsx run_gate_set.ts <set.json> [--json]");
    process.exitCode = 2;
  } else {
    const set = JSON.parse(fs.readFileSync(path.resolve(setPath), "utf8")) as QuerySet;
    runGateSet(set).then((observations) => {
      const summary = summarize(set, observations);
      if (process.argv.includes("--json")) {
        console.log(JSON.stringify({ summary, observations }, null, 2));
        return;
      }
      console.log(`\nset: ${summary.setId}`);
      console.log(`provenance: ${set.provenance}\n`);
      for (const row of summary.classes) {
        console.log(`${row.className} (n=${row.count}, answerable=${row.answerable})`);
        console.log(`  semantic  ${row.semanticBand}`);
        console.log(`  coverage  ${row.coverageBand}  (${row.withoutLexicalSignal}/${row.count} with no lexical signal)`);
        console.log(`  verdicts  accepted ${row.accepted}, refused ${row.refused}`);
      }
      const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
      console.log(`\nfalse accept (negative answered): ${pct(summary.falseAcceptRate)}`);
      console.log(`false reject (answerable refused): ${pct(summary.falseRejectRate)}`);
      console.log(`\nNo verdict is issued here. See PROTOCOL.md H7 and CLAIMS.md C11.`);
    }).catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  }
}
