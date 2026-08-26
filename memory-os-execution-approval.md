# Memory OS — execution approval and scoped upgrade plan

**For:** Antigravity (Gemini)
**Repo:** `/root/antigravity-memory-os`
**Date:** 2026-08-23
**Replies to:** `memory-os-fixes-and-upgrade.md`
**Status:** Phase 1 **approved for execution**. Phase 2 **partially approved**, sequenced, behind a gate.

---

## §0. Summary of this reply

Your Phase 1 restatement is accurate and is approved to build now — with four constraints and the
verification suite restored (they were in `memory-os-fixes.md` and dropped in your version; §1.2
lists them, and one of them is a cost guard).

Of Phase 2's twelve proposals: **nine are approved**, sequenced into four waves in §3. **Three are
declined** with reasons in §4 — do not re-propose them.

**Read §2 before starting.** Phase 2's vector-engine work would rewrite the exact code Phase 1
patches. The order is not negotiable.

---

## §1. Phase 1 — approved for immediate execution

### 1.1 Scope confirmed
Both defects, exactly as you restated them:
- **Defect 1** — the `auto` fallback can never fire; `engine.ts:59`'s `try/catch` wraps a
  constructor that cannot throw. Add a real `/health` probe on the local embedder, make provider
  init async, log the selection and reason, fail fast when neither provider is available.
- **Defect 2** — `hybrid_retriever.ts` cosine-scores across vector spaces. Filter on the composite
  identity `providerType:modelName:dimensions`, report exclusions, fail closed when the active
  space is empty but the index is not, and add an index-identity manifest.

Follow the pattern already in this repo: `LocalBgeReranker` (`src/retrieval/reranker.ts:5-20`) and
`LocalLlamaGenerator` (`src/retrieval/generator.ts:7-34`) both expose `isAvailable` and probe a
`/health` endpoint derived from their service URL. The embedding provider is the only local
provider missing it. Do not invent a different mechanism, and do not modify those two.

### 1.2 Constraints — these were dropped from your version. They are restored and binding.

1. **Do not auto-re-embed.** Re-indexing through the cloud provider costs real money against the
   user's Gemini quota. It must be an explicit user action — a flag or a command — never an implicit
   consequence of the local stack being unreachable. **This is a cost guard, treat it as a hard rule.**
2. **Do not change the stored dimension (768).** It is deliberate and shared across the local
   embedder, the cloud config, and the sibling `nlke-declarum-model-02-codio` corpus.
   `gemini-embedding-2` supports 768 natively via Matryoshka Representation Learning.
3. **Additive schema only.** Every schema change must carry a safe default for rows written before
   it. Existing databases must keep working without a manual migration step.
4. **Do not change the retrieval algorithm.** RRF fusion, the lexical scorer, the reranker stage,
   and time decay all stay exactly as they are. Phase 1 is provider correctness only.

### 1.3 Verification — demonstrate, do not assert
1. **Fallback fires.** Stack stopped → a log line naming Gemini and the reason, and a working
   result. Today this raises a fetch error.
2. **Fallback fails cleanly.** Stack stopped and no `cloud.apiKey` → one clear error naming both
   causes, raised at init, not at first embed.
3. **No cross-space mixing.** Index locally, switch `providerMode` to `cloud`, search → the skip
   report and the fail-closed condition. Never a list scored across two spaces.
4. **Happy path unchanged.** Stack running, `auto` mode → results and ordering identical to before.
5. Cases for 1–3 added to `tests/audit_suite.ts` (`npm test`).

---

## §2. The gate

**Phase 1 ships and passes all five verification steps before any Phase 2 work begins.**

Phase 2's dedicated vector engine replaces `getAllChunksWithEmbeddings()` and the scoring loops —
the same code Defect 2 patches. Doing them together makes it impossible to tell which change caused
which behaviour, and a correctness fix buried in a refactor is not a verified fix.

Land Phase 1 as its own commit. Report against §1.3. Then start §3.

---

## §3. Phase 2 — approved scope, in four waves

### Wave A — schema foundations (one migration, additive)
Do these together; they all touch the schema and share one verification pass.

1. **Granular provenance.** `startLine`/`endLine` already exist on `ChunkRecord`. Add the **commit
   hash** and confirm exact file paths are stored. Rationale: the consuming agent must cite a source
   and then *edit it*. Provenance is load-bearing here, not metadata.
2. **Strict hierarchical namespaces** — `Workspace → Project → Module`. **Highest-priority item in
   Phase 2.** This is the same defect class as Defect 2: silent cross-contamination. It is acute
   because `sharedHivePath` is a genuinely shared hive with no scoping today. Precedent from the
   sibling corpus: introducing substrate scoping moved cross-substrate leakage from **18/30 to 0/30**
   on held-out queries. Namespace scoping must be enforced in the retriever, not only stored.
3. **Temporal tracking.** Add `last_accessed_at` and `access_count`. `halfLifeDays: 14` decay
   already exists — extend it, do not replace it.

### Wave B — graph structure
4. **GraphRAG / entity + relationship extraction.** **Extend what exists** — `src/ast/mapper.ts` and
   the `relations` table are already there. For a code corpus the AST/import graph is the
   highest-value structure available; prioritise it over generic entity extraction.

### Wave C — operational assets
Approved with one boundary, stated in §3.1.

5. **Differentiated asset types.** Explicit schemas for `Prompts` (variables, output format) and
   `Workflows/Runbooks` (triggers, ordered steps, required tools), distinct from generic chunks.
6. **Deterministic retrieval via trigger tags.** Procedures must not be found by similarity guess.
   Tag operational docs with explicit triggers and route on exact match.
7. **Active tool-based loading.** `list_workflows()` and `load_workflow(name)` exposed through the
   existing `src/mcp/server.ts`, so the agent fetches its own procedures rather than having context
   guessed for it in advance.

### Wave D — measurement-triggered
8. **Token counts on results.** Return per-result token counts from the retriever so the *consumer*
   can budget its context window. Approved in this shape only — see §4.4.
9. **Dedicated vector engine.** `sqlite-vec` with HNSW is the right destination: it keeps the
   single-file SQLite deployment and needs no server. **But do not start this until you have
   measured that the JS loop is actually the bottleneck**, and report the measurement. A single
   project index is hundreds to low-thousands of chunks, where a linear scan is likely well under
   50 ms. The realistic trigger is hive-level scale across many projects, not per-project search.

### 3.1 Boundary for Wave C
This repo is a **memory engine**, not an agent runtime. Its consumer already owns intent routing and
a command registry (`@aria/core`'s `intentRouter` and `commandRegistry`). Trigger-tag retrieval must
**return** the matching workflow; it must not become a second command router, and it must not decide
what the agent does next. Keep the boundary at "retrieve and return."

---

## §4. Declined — do not re-propose

1. **LLM auto-tagging at ingest.** An LLM call per chunk is slow on a 3B local model and metered on
   cloud, and most of the proposed categories are derivable from the AST and the file path for free.
   The deeper objection: the sibling corpus uses a *human* evidence gate for admission precisely so
   unvetted machine-authored metadata cannot enter the store. Auto-tagging without an equivalent
   gate reintroduces that risk.
2. **Meta-summaries + HDBSCAN clustering.** Premature at this corpus size, and it puts
   **LLM-authored prose into the retrieval path**. A retrieval system that reads its own generated
   summaries is the "pipeline feeding on its own prose" failure that the sibling project's evidence
   gate exists to prevent. Revisit only with a measured token problem and a gate on generated
   summaries.
3. **Workflow state tracking** ("Active Workflow: X, step 2 of 5"). Runtime state belongs in the
   agent, not the memory layer. `@aria/core`'s `contextEngine` already owns it. Two sources of truth
   for "where am I in this task" is a bug generator, and the memory engine cannot observe the
   agent's actual progress — it would be tracking what it *injected*, not what *happened*.

---

## §5. Standing constraints — all waves

- The four constraints in §1.2 apply to Phase 2 as well: no auto-re-embed, 768d fixed, additive
  schema, and no changes to the fusion/rerank/decay algorithm except where a wave names one.
- One wave per commit, each independently verifiable and revertable.
- Do not touch `LocalBgeReranker` or `LocalLlamaGenerator`.
- Do not modify anything outside `/root/antigravity-memory-os`.
- If a wave turns out to require breaking one of these constraints, **stop and report** rather than
  choosing for yourself.

---

## §6. Report back

After Phase 1, and again after each Phase 2 wave:

```yaml
status: complete | partial | blocked
summary:
changed_files:
verification:      # the §1.3 steps, or the wave's own, each with observed output
measurements:      # required for Wave D item 9 before any work on it
constraints_hit:   # anything in §1.2 or §5 that got in the way
risks_or_unknowns:
next_wave_ready:   # yes | no, and why
```

Evidence means observed output — test results, a log line, a query result. A description of what the
code should now do is not verification.
