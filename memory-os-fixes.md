# Memory OS — two fixes in the provider-fallback path

**For:** Antigravity (Gemini)
**Repo:** `/root/antigravity-memory-os`
**Written:** 2026-08-23
**Scope:** two defects, both in the local↔cloud embedding fallback path. Nothing else.

---

## Why this matters

The design intent is: **cloud (Gemini) is the floor that works for everyone; local models are the
upgrade for people with the hardware.** `providerMode: "auto"` is the mechanism that makes that
true. Right now that mechanism is broken in two independent ways, and neither fails loudly.

Both bugs are invisible in the happy path (local stack up, index built locally). Both bite exactly
when a user has no local models — the case the fallback exists to serve.

---

## Defect 1 — the auto-fallback can never fire

**Location:** `src/core/engine.ts`, the `else` branch beginning at line 59.

**Current code:**

```ts
} else {
  // Auto mode: Check if local llama embedder is responding, else fallback to Gemini
  try {
    this.embeddingProvider = new LocalLlamaEmbeddingProvider(
      this.config.local.embedderUrl,
      "embeddinggemma-300m-q4",
      this.config.local.dimensions
    );
  } catch (e) {
    this.embeddingProvider = new GeminiEmbeddingProvider(
      this.config.cloud.apiKey,
      this.config.cloud.embeddingModel,
      this.config.cloud.dimensions
    );
  }
}
```

**The bug:** the comment says "check if the local llama embedder is responding." No check happens.
The `try` wraps only the constructor, and `LocalLlamaEmbeddingProvider`'s constructor
(`src/vector/providers/local_llama.ts:13-21`) is three field assignments:

```ts
constructor(embedderUrl = "...", modelName = "...", dimensions = 768) {
  this.embedderUrl = embedderUrl;
  this.modelName = modelName;
  this.dimensions = dimensions;
}
```

It cannot throw. **The `catch` branch is unreachable.** With the llama.cpp stack down, auto mode
still selects the local provider, then fails later at `embedDocument`/`embedQuery` with a raw
fetch error — instead of falling back to Gemini as designed.

**Follow the pattern this repo already has.** `LocalBgeReranker` (`src/retrieval/reranker.ts:5-20`)
and `LocalLlamaGenerator` (`src/retrieval/generator.ts:7-34`) both expose `isAvailable` and probe a
`/health` endpoint derived from their service URL:

```ts
const res = await fetch(this.rerankerUrl.replace("/v1/rerank", "/health"), { ... });
this.isAvailable = res.ok;
```

The embedding provider is the only local provider missing this. Add it the same way.

### Required behaviour

1. Give `LocalLlamaEmbeddingProvider` an `isAvailable` field and an async probe against
   `embedderUrl.replace("/v1/embeddings", "/health")`, with a short timeout (2s is enough — the
   server is on localhost). Mirror the existing two providers' shape so the codebase stays uniform.
2. A constructor cannot await, so provider selection must become async. Add an
   `async init()` on `MemoryEngine` (or an async static factory) that performs the probe and
   resolves the provider. Every entry point in `bin/agy-memory.ts` and `src/mcp/server.ts` must
   await it before first use.
3. In `auto` mode: probe local first. If it responds, use local. If it does not, use Gemini.
4. **Log which provider was selected and why**, at every startup. One line, e.g.
   `[memory] embedder: gemini-embedding-2 (cloud) — local probe failed: connect ECONNREFUSED 127.0.0.1:8145`.
   A silent switch between vector spaces is the thing that makes Defect 2 dangerous.
5. If local is unavailable **and** no `cloud.apiKey` is configured, fail immediately with a clear,
   actionable error naming both causes. Do not construct a provider that will throw later.

---

## Defect 2 — a provider switch silently corrupts retrieval

**Location:** `src/retrieval/hybrid_retriever.ts`, the semantic scoring loops (~lines 52-82).

**Current code:**

```ts
const chunks = this.db.getAllChunksWithEmbeddings();
const memories = this.db.getAllMemoriesWithEmbeddings();

for (const chunk of chunks) {
  if (!chunk.embedding) continue;
  const score = cosineSimilarity(queryVector, chunk.embedding);
  ...
}
```

**The bug:** the schema is correct — `chunks.embedding_model` and `memories.embedding_model` are
`TEXT NOT NULL`, `embedding_dimension` is stored alongside, and both surface on the records as
`embeddingModel` / `embeddingDimension` (`src/core/types.ts:57-58, 73-74`). **The retriever never
reads either field.** It cosine-scores the query vector against every stored vector regardless of
which model produced it.

`embeddinggemma-300m-q4` and `gemini-embedding-2` are **both 768-dimensional but occupy different
vector spaces.** Cosine similarity across them is meaningless. Critically, it does not throw and
does not produce a dimension error — the arrays are the same length. Retrieval quality collapses
silently and there is no signal anywhere that it happened.

This is a layer mismatch: the cheap available check (dimensions match) is not measuring the real
question (same vector space). Same length is not same meaning.

### Required behaviour

1. **Filter, never mix.** In both semantic loops, skip any record whose embedding provenance does
   not match the active provider. Match on a composite identity, not dimensions alone:
   `${providerType}:${modelName}:${dimensions}`. `EmbeddingProvider` already exposes `modelName`,
   `dimensions`, and `providerType` (`src/core/types.ts:108-115`), so the active side needs no new
   plumbing.
2. **Report what was excluded — do not silently return fewer results.** Count skipped records by
   their `embeddingModel` and surface it on the search result and in the CLI output, e.g.
   `2,145 chunks skipped — embedded with embeddinggemma-300m-q4, active embedder is gemini-embedding-2. Re-index to use them.`
3. **Fail closed when the active space is empty.** If zero records match the active provider but
   the index is non-empty, do not return an empty result set as if nothing matched the query.
   Raise a distinct, named condition telling the user the index was built with a different embedder
   and must be re-indexed. An empty success is the failure mode to avoid here.
4. **Record the index's embedding identity.** Add a small metadata/manifest row (a `meta` table or
   a row in an existing one) holding the model, provider type, and dimensions the index was built
   with. Check it at startup so a mismatch is reported once, up front, rather than discovered
   per-query.
5. **Do not auto-re-embed.** Re-indexing a large corpus through the cloud provider is a real cost
   and must be an explicit user action (a flag or a command), never an implicit consequence of the
   local stack being down.

---

## Constraints

- **Do not change the stored dimension (768).** It is deliberate and shared: the local embedder,
  the cloud config, and the sibling `nlke-declarum-model-02-codio` corpus are all 768d.
  `gemini-embedding-2` supports 768 natively via Matryoshka Representation Learning.
- **Do not break existing databases.** Any schema addition must be additive with a safe default for
  rows written before this change.
- **Do not change the retrieval algorithm.** RRF fusion, the lexical scorer, the reranker stage, and
  time decay all stay exactly as they are. This is provider correctness only.
- **Keep the reranker and generator untouched.** Their `isAvailable` pattern is the reference; do
  not modify them.

---

## Verification

Each of these must be demonstrated, not asserted.

1. **Fallback actually fires.** With the llama.cpp stack stopped, run a search. Expect: a log line
   naming Gemini and the reason, and a working result. Before this fix, it raises a fetch error.
2. **Fallback fails cleanly with no key.** Stack stopped and `cloud.apiKey` unset: expect one clear
   error naming both causes, thrown at init, not at first embed.
3. **No cross-space mixing.** Index a handful of files with the local embedder, switch
   `providerMode` to `cloud`, and search. Expect: the skip report from requirement 2, and the
   fail-closed condition from requirement 3 — never a ranked list scored across both spaces.
4. **Happy path unchanged.** Stack running, `providerMode: "auto"`, index and search as normal.
   Results and ordering should be identical to before the change.
5. Add cases for 1, 2, and 3 to `tests/audit_suite.ts` (`npm test`).

---

## Out of scope — noted, do not fix here

`getAllChunksWithEmbeddings()` loads the entire index into memory and scores it in a JS loop. That
is a scaling concern worth addressing later; it is not one of these two defects. Leave it alone so
this change stays reviewable.
