/**
 * Q4_0 vs Q8_0 embedding A/B, crossed with EmbeddingGemma's prompt prefixes.
 *
 *   npx tsx research/embedder-quantization/run_quantization_ab.ts
 *   npx tsx research/embedder-quantization/run_quantization_ab.ts --limit 40
 *
 * DIAGNOSTIC, NOT CONFIRMATORY. No hypothesis was declared before this ran and
 * it decides nothing. It may not be cited for a ledger row. If a claim is ever
 * to rest on a quantization result, a hypothesis and bounds go into PROTOCOL.md
 * first, as H7 did -- see research/disambiguation-gate/ for the shape that takes.
 *
 * The 2x2 exists because two candidate explanations for the narrow in-domain /
 * out-of-domain margin are live at once, and separating them needs both factors
 * varied together:
 *
 *                   | current format      | EmbeddingGemma prefixes
 *   ----------------+---------------------+------------------------
 *   Q4_0  (:8145)   | production today    | prefix effect at Q4
 *   Q8_0  (:8146)   | quantization effect | both
 *
 * Requires the optional Q8 tenant from rag-loader.sh:
 *   EMBED_Q8_ENABLED=1 ./rag-loader.sh start
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadMemoryConfig } from "../../src/core/config";

const ROOT = path.resolve(__dirname, "../..");
const TOP_K = 10;
/** Matches LocalLlamaEmbeddingProvider.callLocalEmbedding, so the "current" cell
 *  is what production actually sends. Content is truncated BEFORE a prefix is
 *  added, so the two format cells carry identical content and differ only by the
 *  prefix -- otherwise the prefix would silently displace ~20 chars of text. */
const MAX_CHARS = 1200;
/**
 * MUST stay 1. Both servers run -np 4 -cb, and continuous batching makes a vector
 * depend on which other requests shared its batch: the same text embedded 8 times
 * with 4 in flight returned 4 distinct vectors (worst self-cosine 0.997556), while
 * sequential requests are bit-identical. At 4 this run is not reproducible -- a
 * repeat moved every band by 1e-3..5e-3, enough to swamp the head-only effect.
 * Raising this trades away the only determinism available without an -np 1 server.
 */
const CONCURRENCY = 1;

type Format = "current" | "prefixed";
type Arm = "q4" | "q8";

interface Endpoint { arm: Arm; url: string; alias: string; ftype?: string; dim?: number; params?: number }
interface Chunk { id: string; content: string }
interface Query { text: string; klass: string; answerable: boolean }

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// ---- embedding -------------------------------------------------------------

function applyFormat(text: string, format: Format, kind: "doc" | "query"): string {
  const clean = text && text.trim().length > 0 ? text.trim() : "empty";
  const truncated = clean.length > MAX_CHARS ? clean.slice(0, MAX_CHARS) : clean;
  if (format === "current") return truncated;
  // Google's published EmbeddingGemma prompt formats. The server does not add
  // these; embed-server.sh's own usage text says so explicitly.
  return kind === "query"
    ? `task: search result | query: ${truncated}`
    : `title: none | text: ${truncated}`;
}

async function embedOne(endpoint: Endpoint, text: string): Promise<Float32Array> {
  const res = await fetch(endpoint.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: text, model: endpoint.alias }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${endpoint.arm} HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as any;
  const vector = data.data?.[0]?.embedding;
  if (!vector?.length) throw new Error(`${endpoint.arm} returned an empty vector`);
  return new Float32Array(vector);
}

/** Bounded pool; -np 4 means anything beyond that just waits in the server. */
async function embedAll(
  endpoint: Endpoint, texts: string[], label: string
): Promise<Float32Array[]> {
  const out = new Array<Float32Array>(texts.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= texts.length) return;
      out[i] = await embedOne(endpoint, texts[i]);
      if (++done % 25 === 0 || done === texts.length) {
        process.stdout.write(`\r  ${label}: ${done}/${texts.length}   `);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write("\n");
  return out;
}

// ---- geometry --------------------------------------------------------------

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denominator = Math.sqrt(na) * Math.sqrt(nb);
  return denominator === 0 ? 0 : dot / denominator;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Kendall tau-b, the tie-corrected form. PROTOCOL.md's quantization section asks
 * for tau-b "on the union (absent rank K+1)", and that convention creates a large
 * tie group at K+1, which tau-a would mis-handle.
 */
function kendallTauB(x: number[], y: number[]): number {
  let concordant = 0, discordant = 0, tiedX = 0, tiedY = 0;
  for (let i = 0; i < x.length; i++) {
    for (let j = i + 1; j < x.length; j++) {
      const dx = Math.sign(x[i] - x[j]);
      const dy = Math.sign(y[i] - y[j]);
      if (dx === 0 && dy === 0) continue;
      if (dx === 0) { tiedX++; continue; }
      if (dy === 0) { tiedY++; continue; }
      if (dx === dy) concordant++; else discordant++;
    }
  }
  const denominator = Math.sqrt((concordant + discordant + tiedX) * (concordant + discordant + tiedY));
  return denominator === 0 ? NaN : (concordant - discordant) / denominator;
}

function topK(scores: number[], k: number): number[] {
  return scores
    .map((score, index) => ({ score, index }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((r) => r.index);
}

// ---- preflight -------------------------------------------------------------

async function describe(endpoint: Endpoint): Promise<Endpoint> {
  const base = endpoint.url.replace("/v1/embeddings", "");
  let res: Response;
  try {
    res = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(5000) });
  } catch (e: any) {
    throw new Error(
      `${endpoint.arm} embedder unreachable at ${base}: ${e.message}\n` +
      `  Start the Q8 tenant with:  EMBED_Q8_ENABLED=1 ./rag-loader.sh start`
    );
  }
  const meta = ((await res.json()) as any).data?.[0];
  return {
    ...endpoint,
    alias: meta?.id ?? endpoint.alias,
    ftype: meta?.meta?.ftype,
    dim: meta?.meta?.n_embd,
    params: meta?.meta?.n_params,
  };
}

// ---- main ------------------------------------------------------------------

async function main() {
  const limit = Number(arg("--limit", "0")) || 0;
  const outPath = arg("--out", path.join(__dirname, "ab_result.json"));

  const endpoints: Endpoint[] = [
    { arm: "q4", url: arg("--q4-url", "http://127.0.0.1:8145/v1/embeddings"), alias: "embeddinggemma-300m-q4" },
    { arm: "q8", url: arg("--q8-url", "http://127.0.0.1:8146/v1/embeddings"), alias: "embeddinggemma-300m-q8" },
  ];
  const described = await Promise.all(endpoints.map(describe));
  for (const e of described)
    console.log(`  ${e.arm}: ${e.alias}  ftype=${e.ftype}  n_embd=${e.dim}  n_params=${e.params}  ${e.url}`);

  // A comparison of a model against itself would silently report perfect
  // agreement, which reads like a clean result rather than a mistake.
  if (described[0].ftype === described[1].ftype) {
    throw new Error(
      `Both endpoints report ftype=${described[0].ftype}. They are the same quantization; ` +
      `there is nothing to compare. Check that :8146 is serving the Q8_0 GGUF.`
    );
  }
  if (described[0].dim !== described[1].dim) {
    throw new Error(`Dimension mismatch: ${described[0].dim} vs ${described[1].dim}.`);
  }

  // Quantization changes file size, never parameter count. A difference here
  // means the two GGUFs are structurally different models and any delta between
  // them is not attributable to quantization. This fired on the first real run:
  // the Q4_0 file was missing dense_2/dense_3 (768x3072 + 3072x768 = 4,718,592
  // parameters), EmbeddingGemma's projection head, so it emitted raw mean-pooled
  // transformer output and cross-arm cosine was ~0 instead of >0.99.
  if (described[0].params !== described[1].params) {
    const delta = Math.abs((described[0].params ?? 0) - (described[1].params ?? 0));
    const message =
      `Parameter-count mismatch: ${described[0].params} vs ${described[1].params} ` +
      `(difference ${delta}). Quantization never changes parameter count, so these ` +
      `are different models and a delta between them is NOT a quantization effect. ` +
      `Diff the GGUF tensor tables before interpreting anything.`;
    if (!process.argv.includes("--allow-model-mismatch")) {
      throw new Error(`${message}\n  Pass --allow-model-mismatch to measure the difference anyway.`);
    }
    console.warn(`\n  WARNING: ${message}\n  Proceeding under --allow-model-mismatch.\n`);
  }

  const config = loadMemoryConfig(ROOT);
  const db = new DatabaseSync(path.resolve(ROOT, config.dbPath), { readOnly: true });
  let chunks = db
    .prepare("SELECT id, content FROM chunks WHERE workspace = ? AND project = ? ORDER BY id")
    .all(config.workspace, config.projectName) as unknown as Chunk[];
  db.close();
  if (chunks.length === 0) throw new Error("No chunks indexed for this scope -- run `agy-memory index` first.");
  if (limit > 0) chunks = chunks.slice(0, limit);

  const calibration = JSON.parse(
    fs.readFileSync(path.join(ROOT, "research/disambiguation-gate/calibration_queries.json"), "utf8")
  );
  const queries: Query[] = Object.entries(calibration.classes).flatMap(
    ([klass, cls]: [string, any]) =>
      cls.queries.map((text: string) => ({ text, klass, answerable: cls.answerable }))
  );

  console.log(`\n  corpus: ${chunks.length} chunks   queries: ${queries.length}   cells: 4\n`);

  // ---- run the 2x2 ---------------------------------------------------------
  const cells: Record<string, { docs: Float32Array[]; queries: Float32Array[] }> = {};
  for (const endpoint of described) {
    for (const format of ["current", "prefixed"] as Format[]) {
      const key = `${endpoint.arm}:${format}`;
      cells[key] = {
        docs: await embedAll(endpoint, chunks.map((c) => applyFormat(c.content, format, "doc")), `${key} docs`),
        queries: await embedAll(endpoint, queries.map((q) => applyFormat(q.text, format, "query")), `${key} queries`),
      };
    }
  }

  // ---- 1. per-chunk agreement between quantizations, format held fixed -----
  const agreement: Record<string, unknown> = {};
  for (const format of ["current", "prefixed"] as Format[]) {
    const sims = chunks
      .map((_, i) => cosine(cells[`q4:${format}`].docs[i], cells[`q8:${format}`].docs[i]))
      .sort((a, b) => a - b);
    agreement[format] = {
      n: sims.length,
      min: Number(sims[0].toFixed(6)),
      p5: Number(quantile(sims, 0.05).toFixed(6)),
      median: Number(quantile(sims, 0.5).toFixed(6)),
    };
  }

  // ---- 2. rank agreement, in PROTOCOL.md's declared quantization format ----
  const rank: Record<string, unknown> = {};
  for (const format of ["current", "prefixed"] as Format[]) {
    const jaccards: number[] = [];
    const taus: number[] = [];
    for (let qi = 0; qi < queries.length; qi++) {
      const scoresFor = (arm: Arm) =>
        cells[`${arm}:${format}`].docs.map((d) => cosine(cells[`${arm}:${format}`].queries[qi], d));
      const a = topK(scoresFor("q4"), TOP_K);
      const b = topK(scoresFor("q8"), TOP_K);
      const setA = new Set(a), setB = new Set(b);
      const intersection = [...setA].filter((i) => setB.has(i)).length;
      jaccards.push(intersection / (setA.size + setB.size - intersection));
      // Union, with anything outside a system's top-K given rank K+1.
      const union = [...new Set([...a, ...b])];
      const rankIn = (list: number[], id: number) => {
        const r = list.indexOf(id);
        return r === -1 ? TOP_K + 1 : r + 1;
      };
      taus.push(kendallTauB(union.map((id) => rankIn(a, id)), union.map((id) => rankIn(b, id))));
    }
    const sortedJ = [...jaccards].sort((x, y) => x - y);
    const finiteTaus = taus.filter((t) => Number.isFinite(t)).sort((x, y) => x - y);
    rank[format] = {
      topK: TOP_K,
      jaccard: { median: Number(quantile(sortedJ, 0.5).toFixed(4)), min: Number(sortedJ[0].toFixed(4)) },
      kendallTauB: {
        median: Number(quantile(finiteTaus, 0.5).toFixed(4)),
        min: finiteTaus.length ? Number(finiteTaus[0].toFixed(4)) : null,
        undefinedCount: taus.length - finiteTaus.length,
      },
    };
  }

  // ---- 3. the margin -- the number the experiment is actually about --------
  const margins: Record<string, unknown> = {};
  for (const key of Object.keys(cells)) {
    const bands: Record<string, { min: number; max: number; n: number }> = {};
    for (let qi = 0; qi < queries.length; qi++) {
      // Max cosine over the whole corpus: the same max-over-N statistic the gate
      // reads, so this band is comparable to the one quoted in README.md.
      const best = Math.max(...cells[key].docs.map((d) => cosine(cells[key].queries[qi], d)));
      const klass = queries[qi].klass;
      const band = bands[klass] ?? (bands[klass] = { min: Infinity, max: -Infinity, n: 0 });
      band.min = Math.min(band.min, best);
      band.max = Math.max(band.max, best);
      band.n++;
    }
    for (const b of Object.values(bands)) {
      b.min = Number(b.min.toFixed(4));
      b.max = Number(b.max.toFixed(4));
    }
    const inDomain = bands["in_domain"];
    const offTopic = bands["out_of_domain"];
    margins[key] = {
      bands,
      // Positive = the classes separate. This is the 0.024 in README.md.
      inDomainMinusOutOfDomain:
        inDomain && offTopic ? Number((inDomain.min - offTopic.max).toFixed(4)) : null,
    };
  }

  const result = {
    kind: "diagnostic",
    disclaimer:
      "Exploratory. No preregistered hypothesis; decides nothing and may not be cited for a ledger row.",
    generatedAt: new Date().toISOString(),
    corpus: {
      repository: "hybrid-graph-memory",
      workspace: config.workspace,
      project: config.projectName,
      chunks: chunks.length,
      truncatedAtChars: MAX_CHARS,
      note:
        "Stored chunk content is embedded verbatim. embedDocument()'s optional " +
        "'source: | symbol: | context:' header is not reconstructed, so the 'current' " +
        "cell is production's text for chunks indexed without that header and a close " +
        "floor for the rest.",
    },
    endpoints: described.map(({ arm, alias, ftype, dim, params, url }) => ({ arm, alias, ftype, dim, params, url })),
    armsAreSameModel: described[0].params === described[1].params,
    queries: { source: "research/disambiguation-gate/calibration_queries.json", n: queries.length },
    perChunkAgreement: agreement,
    rankAgreement: rank,
    margins,
  };

  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");

  console.log("\n  Per-chunk agreement  cos(q4, q8), format held fixed");
  for (const [format, stats] of Object.entries(agreement)) {
    const s = stats as any;
    console.log(`    ${format.padEnd(9)}  median ${s.median}   p5 ${s.p5}   min ${s.min}`);
  }
  console.log("\n  Rank agreement  top-10 over the corpus");
  for (const [format, stats] of Object.entries(rank)) {
    const s = stats as any;
    console.log(`    ${format.padEnd(9)}  Jaccard median ${s.jaccard.median}   tau-b median ${s.kendallTauB.median}`);
  }
  console.log("\n  Margin  min(in_domain) - max(out_of_domain), max-cosine over corpus");
  for (const [key, value] of Object.entries(margins)) {
    const m = value as any;
    const bandText = Object.entries(m.bands)
      .map(([k, b]: [string, any]) => `${k} ${b.min}-${b.max}`)
      .join("   ");
    console.log(`    ${key.padEnd(13)} margin ${String(m.inDomainMinusOutOfDomain).padStart(8)}   ${bandText}`);
  }
  console.log(`\n  Wrote ${path.relative(ROOT, outPath)}`);
  console.log("  Diagnostic only -- no verdict is issued and none may be inferred.\n");
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  process.exitCode = 1;
});
