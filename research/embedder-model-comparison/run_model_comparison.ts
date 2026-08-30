/**
 * Compare two DIFFERENT embedding models on this corpus, each addressed in its
 * own trained prompt format.
 *
 * This is deliberately NOT `research/embedder-quantization/run_quantization_ab.ts`
 * with the guards removed. That runner answers "same model, two precisions?",
 * where per-chunk cos(a, b) is the primary metric and a value near 1.0 is the
 * expected result. This one answers "two different models", where per-chunk
 * cos(a, b) is MEANINGLESS -- two independently trained encoders do not share a
 * coordinate system, so their cosine is an arbitrary number with no scale. The
 * last run of the quantization harness returned median -0.023 across arms and
 * that reading is what exposed a defective GGUF; reporting the same statistic
 * here, where it carries no information, would invite exactly that misreading in
 * reverse. It is not computed, and the omission is the point.
 *
 * What IS comparable across models:
 *   - within-arm separation (each model judged in its own space)
 *   - rank agreement, which compares orderings of shared chunk ids, not vectors
 *
 * Diagnostic only. This produces no verdict about retrieval quality and none may
 * be inferred from it -- see CLAIMS.md C4-C6, all "not demonstrated". Separation
 * on a 35-query calibration set is not nDCG on a held-out set.
 */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMemoryConfig } from "../../src/core/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const TOP_K = 10;

/**
 * Held at the production value so this measures the MODEL, not the context
 * budget. Qwen3-Embedding advertises 32768 tokens against EmbeddingGemma's 2048,
 * which is a real potential advantage -- and it is deliberately not measured
 * here, because letting one arm read more of each chunk than the other would
 * confound the two effects. Raising this is a separate experiment.
 */
const MAX_CHARS = 1200;

/** See run_quantization_ab.ts: -np 4 -cb makes a vector depend on which other
 *  requests shared its batch. Same text x8 with 4 in flight returned 4 distinct
 *  vectors (worst self-cosine 0.997556); sequential requests are bit-identical. */
const CONCURRENCY = 1;

type Format = "none" | "embeddinggemma" | "qwen3";
type ArmId = "a" | "b";

interface Endpoint {
  arm: ArmId; url: string; alias: string; format: Format;
  ftype?: string; dim?: number; params?: number;
}
interface Chunk { id: string; content: string }
interface Query { text: string; klass: string; answerable: boolean }

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const FORMATS: readonly Format[] = ["none", "embeddinggemma", "qwen3"];

/** A typo in --b-format would otherwise fall through applyFormat's switch and
 *  return undefined, embedding the string "undefined" for every document. */
function formatArg(name: string, fallback: Format): Format {
  const value = arg(name, fallback);
  if (!FORMATS.includes(value as Format)) {
    throw new Error(`${name}="${value}" is not a known format. Use one of: ${FORMATS.join(", ")}.`);
  }
  return value as Format;
}

// ---- prompt formats --------------------------------------------------------

/**
 * Each model is addressed the way its authors trained it. Getting this wrong is
 * not a detail: on this same corpus, feeding EmbeddingGemma bare text instead of
 * its prefixes cost 0.046 of separation, and a comparison that applied one
 * model's format to the other would be measuring the mismatch, not the model.
 */
const QWEN3_TASK = "Given a web search query, retrieve relevant passages that answer the query";

function applyFormat(text: string, format: Format, kind: "doc" | "query"): string {
  const clean = text && text.trim().length > 0 ? text.trim() : "empty";
  const body = clean.length > MAX_CHARS ? clean.slice(0, MAX_CHARS) : clean;
  switch (format) {
    case "none":
      return body;
    case "embeddinggemma":
      // Google's published EmbeddingGemma prompts. The server does not add them.
      return kind === "query"
        ? `task: search result | query: ${body}`
        : `title: none | text: ${body}`;
    case "qwen3":
      // Qwen3-Embedding instructs queries only; documents are passed bare.
      return kind === "query" ? `Instruct: ${QWEN3_TASK}\nQuery:${body}` : body;
  }
}

// ---- embedding -------------------------------------------------------------

async function embedOne(endpoint: Endpoint, text: string): Promise<Float32Array> {
  const res = await fetch(endpoint.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: text, model: endpoint.alias }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${endpoint.arm} HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const vector = ((await res.json()) as any)?.data?.[0]?.embedding as number[] | undefined;
  if (!vector?.length) throw new Error(`${endpoint.arm} returned an empty vector`);
  return Float32Array.from(vector);
}

async function embedAll(endpoint: Endpoint, texts: string[], label: string): Promise<Float32Array[]> {
  const out: Float32Array[] = new Array(texts.length);
  for (let i = 0; i < texts.length; i += CONCURRENCY) {
    for (let j = i; j < Math.min(i + CONCURRENCY, texts.length); j++) {
      out[j] = await embedOne(endpoint, texts[j]);
    }
    if ((i + CONCURRENCY) % 25 < CONCURRENCY || i + CONCURRENCY >= texts.length) {
      process.stdout.write(`\r  ${label}: ${Math.min(i + CONCURRENCY, texts.length)}/${texts.length}   `);
    }
  }
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

function topK(scores: number[], k: number): number[] {
  return scores
    .map((score, index) => ({ score, index }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((r) => r.index);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Kendall tau-b, tie-corrected: the union-with-rank-(K+1) convention creates a
 *  large tie group that tau-a mishandles. */
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

// ---- preflight -------------------------------------------------------------

async function describe(endpoint: Endpoint): Promise<Endpoint> {
  const base = endpoint.url.replace("/v1/embeddings", "");
  let res: Response;
  try {
    res = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(5000) });
  } catch (e: any) {
    throw new Error(`arm ${endpoint.arm} unreachable at ${base}: ${e.message}`);
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
  const outPath = arg("--out", path.join(__dirname, "comparison_result.json"));

  const endpoints: Endpoint[] = [
    {
      arm: "a",
      url: arg("--a-url", "http://127.0.0.1:8145/v1/embeddings"),
      alias: arg("--a-alias", "embeddinggemma-300m-q8"),
      format: formatArg("--a-format", "embeddinggemma"),
    },
    {
      arm: "b",
      url: arg("--b-url", "http://127.0.0.1:8146/v1/embeddings"),
      alias: arg("--b-alias", "qwen3-embedding-0.6b-q4km"),
      format: formatArg("--b-format", "qwen3"),
    },
  ];
  const described = await Promise.all(endpoints.map(describe));
  console.log();
  for (const e of described) {
    console.log(
      `  arm ${e.arm}: ${e.alias}\n` +
      `        format=${e.format}  ftype=${e.ftype}  n_embd=${e.dim}  n_params=${e.params}\n` +
      `        ${e.url}`
    );
  }

  // Comparing a model against itself would report perfect rank agreement, which
  // reads like a clean result rather than a misconfiguration.
  if (described[0].alias === described[1].alias) {
    throw new Error(
      `Both arms report alias "${described[0].alias}". They are the same served model; ` +
      `there is nothing to compare. Check that the second tenant is actually running.`
    );
  }
  // The inverse of the quantization runner's guard. There, equal parameter counts
  // were required; here, EQUAL counts mean the "two models" are one model and the
  // comparison is vacuous.
  if (described[0].params && described[0].params === described[1].params) {
    throw new Error(
      `Both arms report n_params=${described[0].params}. Two different models with ` +
      `identical parameter counts is possible but improbable; verify the tenants.`
    );
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

  console.log(`\n  corpus: ${chunks.length} chunks   queries: ${queries.length}   arms: 2\n`);

  const cells: Record<ArmId, { docs: Float32Array[]; queries: Float32Array[] }> = {} as any;
  for (const endpoint of described) {
    cells[endpoint.arm] = {
      docs: await embedAll(endpoint, chunks.map((c) => applyFormat(c.content, endpoint.format, "doc")), `${endpoint.arm} docs`),
      queries: await embedAll(endpoint, queries.map((q) => applyFormat(q.text, endpoint.format, "query")), `${endpoint.arm} queries`),
    };
  }

  // ---- 1. within-arm separation -------------------------------------------
  // Each model judged only against itself. max-cosine over the corpus is what the
  // disambiguation gate's semantic arm actually thresholds on.
  const separation: Record<string, unknown> = {};
  for (const e of described) {
    const byClass: Record<string, number[]> = {};
    for (let qi = 0; qi < queries.length; qi++) {
      const best = Math.max(...cells[e.arm].docs.map((d) => cosine(cells[e.arm].queries[qi], d)));
      (byClass[queries[qi].klass] ??= []).push(best);
    }
    const answerableScores = Object.entries(byClass)
      .filter(([k]) => queries.find((q) => q.klass === k)?.answerable)
      .flatMap(([, v]) => v);
    const unanswerableScores = Object.entries(byClass)
      .filter(([k]) => !queries.find((q) => q.klass === k)?.answerable)
      .flatMap(([, v]) => v);
    if (answerableScores.length === 0 || unanswerableScores.length === 0) {
      throw new Error(
        `The calibration set has ${answerableScores.length} answerable and ` +
        `${unanswerableScores.length} unanswerable queries. A margin needs both.`
      );
    }
    const bands = Object.fromEntries(
      Object.entries(byClass).map(([k, v]) => [k, { min: Number(Math.min(...v).toFixed(4)), max: Number(Math.max(...v).toFixed(4)), n: v.length }])
    );
    separation[e.arm] = {
      alias: e.alias,
      format: e.format,
      margin: Number((Math.min(...answerableScores) - Math.max(...unanswerableScores)).toFixed(4)),
      lowestAnswerable: Number(Math.min(...answerableScores).toFixed(4)),
      highestUnanswerable: Number(Math.max(...unanswerableScores).toFixed(4)),
      bands,
    };
  }

  // ---- 2. rank agreement ---------------------------------------------------
  // Valid across models: this compares orderings of shared chunk ids, never
  // vectors from the two spaces against each other.
  const jaccards: number[] = [];
  const taus: number[] = [];
  for (let qi = 0; qi < queries.length; qi++) {
    const scoresFor = (arm: ArmId) => cells[arm].docs.map((d) => cosine(cells[arm].queries[qi], d));
    const a = topK(scoresFor("a"), TOP_K);
    const b = topK(scoresFor("b"), TOP_K);
    const setA = new Set(a), setB = new Set(b);
    const intersection = [...setA].filter((i) => setB.has(i)).length;
    jaccards.push(intersection / (setA.size + setB.size - intersection));
    const union = [...new Set([...a, ...b])];
    const rankIn = (list: number[], id: number) => {
      const r = list.indexOf(id);
      return r === -1 ? TOP_K + 1 : r + 1;
    };
    taus.push(kendallTauB(union.map((i) => rankIn(a, i)), union.map((i) => rankIn(b, i))));
  }
  jaccards.sort((x, y) => x - y);
  const finiteTaus = taus.filter(Number.isFinite).sort((x, y) => x - y);

  // ---- report --------------------------------------------------------------
  console.log("\n  Within-arm separation  margin = min(answerable) - max(unanswerable)");
  for (const e of described) {
    const s = separation[e.arm] as any;
    console.log(`    ${e.arm}: ${s.alias.padEnd(28)} margin ${String(s.margin).padStart(8)}   [${s.lowestAnswerable} answerable floor vs ${s.highestUnanswerable} unanswerable ceiling]`);
    for (const [k, v] of Object.entries(s.bands as Record<string, any>)) {
      console.log(`         ${k.padEnd(18)} ${v.min}-${v.max}  (n=${v.n})`);
    }
  }
  console.log("\n  Rank agreement  top-10 over the corpus, orderings only");
  console.log(`    Jaccard median ${quantile(jaccards, 0.5).toFixed(4)}   tau-b median ${quantile(finiteTaus, 0.5).toFixed(4)}`);

  fs.writeFileSync(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    note: "Diagnostic only. Cross-arm per-chunk cosine is deliberately not computed: two independently trained encoders do not share a coordinate system. No retrieval-quality verdict may be inferred (CLAIMS.md C4-C6).",
    maxChars: MAX_CHARS,
    concurrency: CONCURRENCY,
    topK: TOP_K,
    corpusChunks: chunks.length,
    queries: queries.length,
    endpoints: described.map(({ arm, alias, format, ftype, dim, params, url }) => ({ arm, alias, format, ftype, dim, params, url })),
    separation,
    rankAgreement: {
      jaccardMedian: Number(quantile(jaccards, 0.5).toFixed(4)),
      tauBMedian: Number(quantile(finiteTaus, 0.5).toFixed(4)),
    },
  }, null, 2) + "\n");
  console.log(`\n  Wrote ${path.relative(ROOT, outPath)}`);
  console.log("  Diagnostic only -- no verdict is issued and none may be inferred.\n");
}

main().catch((e) => { console.error(`\n  ${e.message}\n`); process.exit(1); });
