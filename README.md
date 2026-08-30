# Hybrid Graph Memory

A local-first TypeScript memory and retrieval engine for source code, documents,
explicit architecture relations, and review-gated operational assets. The project
combines cosine similarity, SQLite FTS5, reciprocal-rank fusion, time decay, and
bounded graph expansion. It is an engineering system, not a proof that software
repositories are manifolds or that graph-aware retrieval is universally superior.

## Current evidence boundary

The repository supports these implementation claims:

- indexing is bounded and deterministic;
- a completed index update is committed as one SQLite transaction;
- malformed configuration fails closed;
- malformed stored JSON is not treated as trusted metadata;
- graph relations carry origin and admission state;
- default retrieval excludes model-inferred and legacy-unknown edges;
- model-inferred edges remain candidates until independently reviewed;
- the MCP server blocks content/admin mutations unless mutation mode is enabled;
  successful reads still update access-count and last-access telemetry;
- the web dashboard binds to `127.0.0.1` by default and escapes stored values.

The repository does **not** currently establish these research claims:

- that the indexed graph is a topological manifold;
- that motion reveals an additional spatial dimension;
- that low-dimensional topology implies a model of physical spacetime;
- that persistence lifespan measures semantic importance;
- that graph/topology-aware retrieval beats neutral baselines.

The former `src/evaluation/prove_topology.ts` result is withdrawn. It did not run a
real k-nearest-neighbor baseline, hard-coded a noise result, and printed an
unconditional conclusion. The replacement protocol and claim ledger live under
`research/vector-topology-primitives/canonical/`.

Root-level concept documents such as `ultra-50g.md`, `killer-features.md`,
`implementation-roadmap.md`, `generalization-active.md`, and
`upgrade-directions.md` are historical design/roadmap records. They are not
evidence of current behavior. When wording conflicts, executable tests and the
canonical claim ledger/protocol take precedence.

## Requirements

- Node.js 22 or newer (the database uses `node:sqlite`)
- npm
- optional local embedding, reranking, and generation HTTP services on loopback
- optional Gemini API key for cloud mode

```sh
npm install
npm run typecheck
npm run build
npm test
npm run test:alignment
npm run test:production
npm run test:package
```

## CLI

```sh
agy-memory --help
agy-memory index
agy-memory search "transaction boundary"
agy-memory rag "Why is this edge trusted?"
agy-memory ingest-text "A reviewed local note"
agy-memory ingest-image ./screenshot.png "UI state"
agy-memory graph
agy-memory stats
agy-memory system2 --check
agy-memory system2
agy-memory serve
```

`ingest-image` accepts an existing regular PNG, JPEG, or WebP file up to 20 MiB.
It does not interpret an arbitrary missing path as base64. Unknown commands and
invalid inputs are rejected before the database engine is initialized.

The dashboard is loopback-only by default. It has no authentication layer, so do
not place it behind a public bind or proxy without adding an explicit security
boundary. Its live graph currently loads a browser dependency from `unpkg.com` as
permitted by its Content Security Policy.

The graph renderer and standalone HTML exporter provide an inspectable view of
admitted relations and community assignments. Colors are deterministic and stored
labels are serialized defensively. The force-directed 3D layout is a visualization;
its display coordinates are not evidence of an intrinsic three-dimensional space.

## Optional ULTRA System 2

ULTRA link prediction runs only through a dedicated Python environment. The checked
configuration pins the downloaded `ultra_50g` Git commit and model checksum, uses
the Hugging Face `UltraForKnowledgeGraphReasoning` wrapper, and keeps every output
as a `model_inferred/candidate` relation until independent review. Sigmoid-transformed
logits are ranking scores, not calibrated truth probabilities.

```sh
python3 -m venv --system-site-packages /root/.local/share/hybrid-graph-memory/ultra-venv
/root/.local/share/hybrid-graph-memory/ultra-venv/bin/python -m pip install -r src/python/requirements-ultra.txt
agy-memory system2 --check
agy-memory system2
```

The virtual environment isolates ULTRA's Transformers 4.x and PyG 2.4 requirements
from the system Python. A custom interpreter or verified model can be supplied with
`ULTRA_PYTHON`, `ULTRA_MODEL_PATH`, `ULTRA_MODEL_VERSION`, and
`ULTRA_MODEL_SHA256`. The first forward pass may compile ULTRA's local `rspmm`
extension and take longer than later runs.

## Configuration

Create `.antigravityrc.json` in the project root. Unknown fields are ignored;
known fields are type- and range-checked. Local service URLs must use HTTP(S) on a
loopback host.

```json
{
  "workspace": "local",
  "projectName": "example",
  "providerMode": "local",
  "local": {
    "embedderUrl": "http://127.0.0.1:8145/v1/embeddings",
    "rerankerUrl": "http://127.0.0.1:8144/v1/rerank",
    "generatorUrl": "http://127.0.0.1:8147/v1/chat/completions",
    "dimensions": 768
  },
  "candidateLimit": 40,
  "defaultResultLimit": 6,
  "rrfConstant": 60,
  "halfLifeDays": 14,
  "minSimilarityThreshold": 0.25,
  "disambiguationThreshold": 0.32,
  "lexicalEvidenceThreshold": 0.7,
  "maxFileBytes": 2097152,
  "maxFiles": 50000,
  "maxTotalBytes": 536870912,
  "maxScanDepth": 64
}
```

An incomplete scan aborts indexing rather than deleting records for unread or
unvisited files. Files skipped only because of the per-file size limit remain in
the seen set, preventing accidental deletion of their prior records.

## Retrieval model

For nonzero vectors `q` and `d`, cosine similarity is

```text
cos(q,d) = (q · d) / (||q||₂ ||d||₂).
```

Semantic, lexical, and admitted graph rankings are combined by weighted
reciprocal-rank fusion:

```text
RRF(d) = Σ_m w_m / (k + rank_m(d) + 1).
```

The lexical ranking is SQLite FTS5 BM25 over the maintained virtual tables, with
column weights preserving a symbol-over-heading-over-body emphasis. Query text is
never interpolated into the MATCH expression: terms are stripped to word
characters and quoted individually, so FTS5 operators typed by a caller are
treated as literal text. The MATCH builder and the in-memory scorer share one
tokenizer (`src/core/text.ts`) so they cannot disagree about which terms are
meaningful; stop words are dropped on both sides. When FTS5 is unavailable in the
SQLite build — or the caller supplies a database without the lexical query
methods — retrieval degrades to scanning with an in-memory overlap scorer rather
than losing the arm.

The scorer reports two numbers. Its field-weighted `score` ranks results and
deliberately is not a fraction of the query. Its `coverage` is the fraction of the
query's discriminative terms present at all, and that is what the gate reads.
Symbols match as substrings, because an identifier is a deliberate compound and
`retriever` should reach `HybridRetriever`; body text and headings match at word
starts, so a short term cannot harvest matches from inside unrelated words.
Compound identifiers are split at camelCase humps first, so `maxFileBytes` still
matches `file`.

Time decay is a ranking policy, not a truth score:

```text
decay(ageDays) = max(0.10, 2^(-ageDays / halfLifeDays)).
```

The disambiguation gate accepts results when any independent arm vouches for them:
exact trigger/symbol/heading evidence, a best raw semantic score meeting
`disambiguationThreshold`, or a best lexical coverage meeting
`lexicalEvidenceThreshold`. The arms are a disjunction — a query worded like the
corpus is well evidenced even when the embedder scores it modestly, and a
paraphrase that barely overlaps it is well evidenced by cosine. When no arm
clears its bar the gate fails closed and returns a disambiguation request naming
both scores. It does not compare an RRF score to a cosine threshold.

The semantic arm additionally requires a lexical anchor before it may vouch alone:
at least one query term must occur inside the caller's namespace. Content-free
input embeds near the corpus centroid and scores as highly as a real question, so
cosine separates off-topic text but not gibberish. On the H7 attempt-2 development
split content-free input reached a semantic score of 0.419 while the lowest
answerable query scored 0.378: the classes overlap, so **no** semantic threshold
can both admit answerable queries and refuse gibberish, and the anchor is what
holds content-free input out at any threshold. The anchor is evaluated against
namespace scope rather than admissibility - a term appearing only in a quarantined
record still proves the query is meaningful, though that record is never returned.

The embedder is `embeddinggemma-300m-q8`, and the provider applies EmbeddingGemma's
trained prompt formats — `task: search result | query: ` for queries and
`title: none | text: ` for documents. Both matter more than they look. The GGUF
previously served here was a conversion missing the model's two dense projection
layers, so it emitted raw mean-pooled transformer output instead of the trained
embedding space, and the prefixes were absent as well. Together those two defects
cost roughly six times the separation between answerable and unanswerable queries.
`research/embedder-quantization/` carries the measurements and the tensor-level
diagnosis.

The shipped thresholds are calibrated defaults, not an evaluation result. They were
set on the H7 attempt-2 development split (34 answerable, 96 negative), the only
split tuning may use. Semantic: answerable 0.378–0.684, off-topic *carrying a
lexical anchor* 0.250–0.261, content-free 0.261–0.419 with no anchor at all — so
0.32 sits near the middle of the only separating gap. Lexical coverage is computed
from the query and the stored text, so the embedder cannot move it, and it still
separates in-domain 0.667–1.000 from out-of-domain 0.250–0.500. Coverage is
quantized by query length, so the 0.7 bar reads as "every term of a two- or
three-term query, or three quarters of a four-term one" and sits in a gap rather
than on an observed value.

The gate's resulting behaviour — not its retrieval quality — was then evaluated
against a preregistered rule, H7, on a held-out split of 136 queries the tuner did
not author: 0 false accepts of 104 negatives and 0 false rejects of 32 answerable
queries, with the configuration frozen before the split was run once. An earlier
attempt confirmed the same hypothesis for the defective embedder and is superseded
rather than withdrawn. Retrieval *quality* remains unevaluated, and H7 is not
evidence for it. See `research/disambiguation-gate/` for both runs and
`research/vector-topology-primitives/canonical/{CLAIMS.md,PROTOCOL.md}` for claim
C11, the decision rule, and the rule governing repeat attempts.

A negative query whose text appears in the indexed corpus is not a negative. This
repository indexes its own evaluation sources, so the query pools, the calibration
set, and the generator holding the off-topic vocabulary are all in
`excludedPathPrefixes`. One calibration negative was retired for the same reason:
the regression test asserting that "how to change a car tire" gets refused put that
sentence into the corpus and thereby made it answerable.

Optional reranking validates returned indices, rejects duplicates and non-finite
scores, preserves the unreranked tail, and deterministically falls back to the
fused order on service failure.

## Graph trust model

Every relation has an origin:

- `declared`: explicitly stated in a `.ctx` source;
- `observed_ast`: extracted from parsed source structure;
- `model_inferred`: predicted by a model;
- `legacy_unknown`: migrated without sufficient provenance.

Default graph reads require both an origin of `declared` or `observed_ast` and an
admission state of `admitted`. Callers must explicitly request inferred relations
to inspect candidates. ULTRA predictions record model name, version, verified
checksum, workspace/project, confidence, and candidate status; they never become
authoritative automatically.

Existing databases migrate old relation rows to `legacy_unknown/candidate`, so a
re-index is required before those edges reappear in default graph retrieval.

## Operational assets and legacy evidence

Prompts, workflows, skills, and rules enter as candidates. Admission requires a
non-empty reviewer and succeeds only for an existing candidate of an operational
type. Quarantine/rejection requires a reason. Model output cannot self-admit.

Historical receipt-table rows are exposed only as **unverified legacy evidence
references**. This package does not issue evidence levels. The historical global
hive export is disabled until an allowlisted schema and privacy suite exist.

## MCP behavior

The line-delimited JSON-RPC server distinguishes parse error (`-32700`), invalid
request (`-32600`), method not found (`-32601`), invalid parameters (`-32602`),
internal error (`-32603`), and the server-defined content/admin-mutation denial
(`-32001`). Successful search/load calls update local access telemetry.
Notifications produce no response and request ID `0` is preserved.

## Scientific work

The canonical research bundle is deliberately falsifiable. A superiority claim
requires fixed retrieval budgets, held-out relevance judgments, neutral baselines,
ten declared seeds, nDCG@10, paired bootstrap confidence intervals, paired
permutation tests, multiplicity correction, and a prespecified practical effect.
If the criteria fail, the correct result is “not demonstrated.”

The executable evaluator currently covers only retrieval hypotheses H1--H3. Its
confirmatory mode requires candidate B4, the exact B0/B2/B6 roster, a complete
freeze manifest, the prespecified query counts, and candidate gate outcomes.
H4--H6 are protocol definitions, not executable or demonstrated results.

See `research/vector-topology-primitives/canonical/CLAIMS.md` and `PROTOCOL.md`.

## License

MIT. See `LICENSE`.
