/**
 * Generates the H7 query pool mechanically, so that no query in it is composed by
 * whoever tunes the gate thresholds. See PROTOCOL.md section "H7" for the declared
 * sources, split rule, and decision rule; this file only implements them.
 *
 *   npx tsx research/disambiguation-gate/generate_queries.ts
 *
 * Answerable queries are drawn only from files the database reports as indexed, so
 * the source text is guaranteed to be in the corpus. Negative queries are produced
 * from fixed vocabulary and a fixed seed. Output is deterministic.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { MemoryDatabase } from "../../src/core/database";
import { loadMemoryConfig } from "../../src/core/config";

const ROOT = path.resolve(__dirname, "../..");
const SEED = 20260829;
/**
 * Answerable queries are extracted from the repository as it stood BEFORE any gate
 * work began. The tuner wrote commit subjects and doc comments during this session,
 * and H7 requires queries the tuner did not author, so drawing from HEAD would have
 * fed the evaluation its own prose. Content that was since edited is still labelled
 * answerable, which biases against confirmation.
 */
const BASELINE_COMMIT = "984fa09bb5c3bc30d7b5cda05a5f6d9b437c18e8";
// Sampling rule, fixed before any gate run. The two prose sources are scarce in a
// repository this small, so taking a fixed target from each would have let verbatim
// markdown headings dominate the answerable class and make confirmation easier.
// Headings are therefore capped at the combined size of the prose sources, giving a
// roughly even split between verbatim and paraphrase phrasing. This was chosen from
// pool composition alone -- no query had been run through the gate -- and it lowers
// the share of the easy case, so it biases against confirmation.
const TARGET = { offTopic: 100, contentFree: 100 };

/** Deterministic PRNG (mulberry32) so a regenerated pool is byte-identical. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleDeterministic<T>(items: T[], count: number, random: () => number): T[] {
  const pool = [...items];
  const picked: T[] = [];
  while (pool.length > 0 && picked.length < count) {
    picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  return picked;
}

/** Queries must be usable as queries: not empty, not a single token, not enormous. */
function isUsable(text: string): boolean {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/);
  return words.length >= 2 && words.length <= 12 && trimmed.length >= 8 && trimmed.length <= 90;
}

function indexedFiles(): string[] {
  const config = loadMemoryConfig(ROOT);
  const db = new MemoryDatabase(config.dbPath);
  const files = db.getAllFiles().map((file) => file.filepath);
  db.close();
  return files;
}

/** Reads a path as it existed at the baseline commit, or null if absent then. */
function readIndexed(filepath: string): string | null {
  const relative = path.isAbsolute(filepath) ? path.relative(ROOT, filepath) : filepath;
  try {
    return execFileSync("git", ["show", `${BASELINE_COMMIT}:${relative}`], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/** Markdown headings: verbatim corpus phrasing, the easy case. */
function headingQueries(files: string[]): string[] {
  const out = new Set<string>();
  for (const file of files.filter((f) => f.endsWith(".md"))) {
    const text = readIndexed(file);
    if (!text) continue;
    for (const line of text.split("\n")) {
      const match = /^#{1,4}\s+(.+?)\s*$/.exec(line);
      if (!match) continue;
      const heading = match[1].replace(/[`*_#]/g, "").trim();
      if (isUsable(heading)) out.add(heading);
    }
  }
  return [...out];
}

/** Doc-comment opening sentences: intermediate phrasing. */
function docCommentQueries(files: string[]): string[] {
  const out = new Set<string>();
  for (const file of files.filter((f) => /\.(ts|js|mjs|py)$/.test(f))) {
    const text = readIndexed(file);
    if (!text) continue;
    for (const block of text.match(/\/\*\*[\s\S]*?\*\//g) ?? []) {
      const body = block
        .replace(/^\/\*\*/, "")
        .replace(/\*\/$/, "")
        .split("\n")
        .map((line) => line.replace(/^\s*\*ID?\s?/, "").replace(/^\s*\*\s?/, "").trim())
        .filter((line) => line.length > 0 && !line.startsWith("@"))
        .join(" ");
      const sentence = body.split(/(?<=[.?!])\s/)[0]?.replace(/[`*]/g, "").trim();
      if (sentence && isUsable(sentence)) out.add(sentence.replace(/\.$/, ""));
    }
  }
  return [...out];
}

/** Commit subjects: prose by the repository's authors, often without symbol names. */
function commitQueries(): string[] {
  const log: string = execFileSync("git", ["log", "--format=%s", "--no-merges", BASELINE_COMMIT], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const out = new Set<string>();
  for (const line of log.split("\n")) {
    // Drop the conventional-commit prefix; it is metadata, not a description.
    const subject = line.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, "").trim();
    if (isUsable(subject)) out.add(subject);
  }
  return [...out];
}

const OFF_TOPIC_TEMPLATES = [
  "how do I", "what is the best", "why does my", "when should I", "where can I find",
  "how much does", "what causes", "how long does it take to",
];
const OFF_TOPIC_SUBJECTS = [
  "bake sourdough bread", "prune a rose bush", "treat a sprained ankle", "tune a guitar",
  "change a bicycle tyre", "book a flight to Lisbon", "make cold brew coffee",
  "train a border collie", "read a knitting pattern", "file a rental deposit claim",
  "grow tomatoes indoors", "replace a tap washer", "learn conversational Greek",
  "score a cricket innings", "mix watercolour skin tones", "cook risotto properly",
  "identify a garden bird", "clean a cast iron pan", "plan a coastal hike",
  "choose running shoes", "store fresh basil", "wire a ceiling light",
  "recognise a vitamin deficiency", "sail into the wind", "restring a tennis racket",
];

function offTopicQueries(random: () => number, count: number): string[] {
  const combinations: string[] = [];
  for (const template of OFF_TOPIC_TEMPLATES) {
    for (const subject of OFF_TOPIC_SUBJECTS) combinations.push(`${template} ${subject}`);
  }
  return sampleDeterministic(combinations, count, random);
}

const STOP_ONLY = ["of in on at by", "the and or but", "is was were been", "to from with without", "it its this that"];

function contentFreeQueries(random: () => number, count: number): string[] {
  const out = new Set<string>();
  const punctuation = "^~#$%&*()[]{}<>|/\\+=?!";
  const consonants = "bcdfghjklmnpqrstvwxz";
  while (out.size < count) {
    const kind = out.size % 4;
    if (kind === 0) {
      const length = 3 + Math.floor(random() * 8);
      out.add(Array.from({ length }, () => punctuation[Math.floor(random() * punctuation.length)]).join(""));
    } else if (kind === 1) {
      const char = "abcdefghijklmnopqrstuvwxyz"[Math.floor(random() * 26)];
      out.add(char.repeat(5 + Math.floor(random() * 15)));
    } else if (kind === 2) {
      out.add(STOP_ONLY[Math.floor(random() * STOP_ONLY.length)] + " " + STOP_ONLY[Math.floor(random() * STOP_ONLY.length)]);
    } else {
      const words = 2 + Math.floor(random() * 3);
      out.add(Array.from({ length: words }, () => {
        const length = 4 + Math.floor(random() * 6);
        return Array.from({ length }, () => consonants[Math.floor(random() * consonants.length)]).join("");
      }).join(" "));
    }
  }
  return [...out];
}

/** Declared split rule: SHA-256 of the query, first byte even -> dev, odd -> test. */
function splitOf(query: string): "dev" | "test" {
  return crypto.createHash("sha256").update(query).digest()[0] % 2 === 0 ? "dev" : "test";
}

function main() {
  const random = makeRandom(SEED);
  const files = indexedFiles();

  const commits = commitQueries();
  const docComments = docCommentQueries(files);
  const headingCap = commits.length + docComments.length;
  const answerable = [
    ...sampleDeterministic(headingQueries(files), headingCap, random).map((q) => ({ q, source: "markdown_heading" })),
    ...commits.map((q) => ({ q, source: "commit_subject" })),
    ...docComments.map((q) => ({ q, source: "doc_comment" })),
  ];
  const negatives = [
    ...offTopicQueries(random, TARGET.offTopic).map((q) => ({ q, source: "off_topic" })),
    ...contentFreeQueries(random, TARGET.contentFree).map((q) => ({ q, source: "content_free" })),
  ];

  const seen = new Set<string>();
  const rows = [...answerable.map((r) => ({ ...r, answerable: true })), ...negatives.map((r) => ({ ...r, answerable: false }))]
    .filter((row) => (seen.has(row.q) ? false : (seen.add(row.q), true)))
    .map((row) => ({ id: crypto.createHash("sha256").update(row.q).digest("hex").slice(0, 12), query: row.q, answerable: row.answerable, source: row.source, split: splitOf(row.q) }));

  const bundle = {
    poolId: `h7-mechanical-${SEED}`,
    generatedFrom: "PROTOCOL.md section H7",
    seed: SEED,
    gitCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    baselineCommit: BASELINE_COMMIT,
    indexedFileCount: files.length,
    splitRule: "sha256(query)[0] % 2 === 0 ? dev : test",
    samplingRule: "all available commit subjects and doc comments; markdown headings capped at their combined count",
    counts: {
      total: rows.length,
      dev: rows.filter((r) => r.split === "dev").length,
      test: rows.filter((r) => r.split === "test").length,
      answerable: rows.filter((r) => r.answerable).length,
      negative: rows.filter((r) => !r.answerable).length,
    },
    queries: rows,
  };

  const outPath = path.join(__dirname, "h7_pool.json");
  fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2) + "\n");
  console.log(JSON.stringify(bundle.counts, null, 2));
  const bySource: Record<string, number> = {};
  for (const row of rows) bySource[row.source] = (bySource[row.source] ?? 0) + 1;
  console.log("by source:", JSON.stringify(bySource));
  console.log(`wrote ${outPath}`);
}

if (require.main === module) main();
