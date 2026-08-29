# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`antigravity-memory-os` — a local-first TypeScript memory/retrieval engine over
SQLite (`node:sqlite`, so **Node 22+ is mandatory**). It indexes source, docs,
`.ctx` architecture declarations, and review-gated operational assets, then
retrieves via cosine similarity + FTS5 BM25 + provenance-filtered graph
expansion, fused with weighted RRF.

## Commands

```sh
npm install
npm run typecheck      # tsc --noEmit (src/ + bin/ only — tests/ are excluded from tsconfig)
npm run build          # tsc -> dist/, then scripts/copy-ultra-bridge.mjs copies the Python bridge
npm test               # tests/audit_suite.ts
npm run test:alignment # tests/fractal_alignment.ts  — namespace/federation isolation
npm run test:production# tests/production_regressions.ts — config, MCP, dashboard, CLI hardening
npm run test:science   # tests/scientific_evaluator.ts — canonical evaluator smoke
npm run test:package   # tests/package_smoke.ts — requires `npm run build` first
npm run test:ultra     # python3 tests/ultra_bridge_contract.py
```

There is **no test framework and no test filter**. Each suite is a standalone
`tsx` script that throws on failure and exits nonzero. To run one, run its
npm script or `npx tsx tests/<file>.ts` directly; to run one case, edit or copy
the script. `tests/package_smoke.ts` shells out to `npm pack` + an `--offline`
install, so it needs a warm npm cache.

Dev CLI (no build step needed):

```sh
npx tsx bin/agy-memory.ts --help      # or: npm run memory -- <args>
npx tsx bin/agy-memory.ts index
npx tsx bin/agy-memory.ts search "transaction boundary"
npx tsx bin/agy-memory.ts serve [port]   # loopback-only web dashboard, default :3000
npx tsx bin/agy-memory.ts visualize      # writes graph_3d_<ts>.html (gitignored)
npm run mcp                              # stdio MCP server, read-only by default
```

Running `agy-memory` with no command opens an interactive `prompts` TUI menu —
avoid it in non-interactive contexts; pass an explicit subcommand instead.

## Architecture

Everything funnels through one facade, `MemoryEngine` (`src/core/engine.ts`).
The CLI, MCP server, web dashboard, visualization exporter, and
`FractalMemoryPort` are all thin callers of it; they must not reach into
`MemoryDatabase` directly.

```
bin/agy-memory.ts ─┐
src/mcp/server.ts  ├─> MemoryEngine ─> MemoryDatabase (node:sqlite + FTS5)
src/server/…       │        │
src/core/fractal_port.ts    ├─> chunkers/{code,ctx,markdown,text}
                            ├─> ast/{scanner,mapper}
                            ├─> vector/providers/{local_llama,gemini}
                            └─> retrieval/HybridRetriever ─> lexical + rank_fusion + reranker
```

**Provider selection** happens once in `MemoryEngine.init()` from
`providerMode` (`local` | `cloud` | `auto`); `auto` health-probes the local
embedder and falls back to Gemini only if `GEMINI_API_KEY` exists. `init()` is
idempotent and guarded by `initPromise`.

**The trust model is the load-bearing invariant of this codebase.** Every
`relations` row carries `origin` (`declared` | `observed_ast` | `model_inferred`
| `legacy_unknown`) and `admission_status` (`candidate` | `admitted` |
`quarantined` | `rejected`). Default reads return only
`declared`/`observed_ast` **and** `admitted`; callers must pass
`includeInferredRelations: true` to see candidates. The same admission gate
applies to operational assets (prompt/workflow/skill/rule) — model-proposed
input is always persisted as a candidate and can never self-admit; admission
requires a non-empty reviewer, quarantine/rejection requires a reason. When
touching `src/core/database.ts`, `src/retrieval/hybrid_retriever.ts`, or the
MCP tools, preserve this default-deny behavior; `tests/production_regressions.ts`
and `tests/fractal_alignment.ts` assert it.

**Namespacing:** every table is scoped by `workspace`/`project`/`module`.
Retrieval is `strict` by default; `federated` mode requires an explicit
`FederatedSearchAdmission` (approver, purpose, allowed workspaces).
`FractalMemoryPort` hard-asserts that its scope matches the engine's.

**Schema migrations** are additive `ALTER TABLE … ` statements wrapped in
`try {} catch {}` inside `MemoryDatabase.initSchema()` — that is the established
pattern; there is no version table. Pre-provenance relation rows migrate to
`legacy_unknown/candidate`, so an existing DB needs a re-index before those
edges reappear in default reads.

**Indexing is atomic and fails closed.** A partial/aborted scan must not delete
records for unvisited files, and a completed index update commits as one SQLite
transaction. Files skipped only for exceeding `maxFileBytes` stay in the seen
set so their prior records survive.

**ULTRA System 2** (`agy-memory system2`) shells out to
`src/python/ultra_bridge.py` in a separate venv
(`/root/.local/share/hybrid-graph-memory/ultra-venv`, overridable via
`ULTRA_PYTHON`). It pins a model commit and verifies a SHA-256 of
`model.safetensors` before loading. Every prediction lands as
`model_inferred/candidate`; sigmoid logits are ranking scores, not probabilities.
The bridge is plain Python copied into `dist/` by the build script — it is not
compiled, so changes there need `npm run build` to reach `dist/`.

## Configuration

`.antigravityrc.json` at the project root, loaded by `src/core/config.ts`.
Unknown fields are ignored; known fields are type/range-checked and a malformed
file throws `MemoryConfigError` rather than falling back to defaults. Local
service URLs must be HTTP(S) on a loopback host. `excludedPathPrefixes` is how
historical/promotional docs are kept out of the index.

Default local services: embedder `:8145`, reranker `:8144`, generator `:8147`.
When they are down, `npm test` **fails** — the health probes degrade to
`⚠️ WARN`, but the first real embedding call throws
(`Failed to call local embedder: fetch failed`, from `MemoryEngine.ingestText`),
so the audit suite exits 1. A green audit run therefore does imply the embedder
was reachable. `test:alignment`, `test:production`, `test:science` and
`test:ultra` use stubs or pure functions and were observed passing with the
stack down. DB defaults to
`.memory/project_memory.db` (gitignored). `GEMINI_API_KEY` comes from the
environment or a `GEMINI_API_KEY=` line in `.env.local`.

## Evidence discipline (repo-specific, non-negotiable)

This repository was deliberately de-scoped from research claims to
implementation claims. `README.md` states an explicit evidence boundary and
`research/vector-topology-primitives/canonical/{CLAIMS.md,PROTOCOL.md}` is the
authoritative claim ledger and frozen evaluation protocol.

- Do not reintroduce manifold/topology/spacetime/relativity claims, or claims
  that graph-aware retrieval beats neutral baselines. Those are ledger entries
  C4–C10, all "not demonstrated" or "unsupported; excluded".
- `src/evaluation/prove_topology.ts` is a deliberate withdrawal stub that throws
  and exits 2. Do not "fix" it into a working evaluator — the replacement is the
  canonical protocol.
- Root-level docs (`ultra-50g.md`, `killer-features.md`,
  `implementation-roadmap.md`, `generalization-active.md`,
  `upgrade-directions.md`, `Autonomous-Engineering-Department.md`,
  `Multi-Agent-Case-Study.md`, `Topological-Proof-Transcript.md`) are historical
  design records, not evidence of current behavior. Executable tests and the
  canonical ledger win any wording conflict.
- The 3D force-directed layout is a visualization; its coordinates are not
  evidence of an intrinsic dimensionality.

## Security posture already in place

Preserve these when editing — regressions here are silent:

- MCP server (`src/mcp/server.ts`) blocks content/admin mutations unless
  `mutationMode` is enabled; successful reads still update access telemetry.
- Web dashboard binds `127.0.0.1` only, has **no auth layer**, and escapes
  stored values before rendering. Its live graph loads a browser dep from
  `unpkg.com` under its CSP.
- Stored JSON (relation metadata, community assignments) is parsed defensively
  with size/shape caps and is never treated as trusted metadata.
- `ingest-image` validates PNG/JPEG/WebP magic bytes and a 20 MiB cap; unknown
  CLI commands and invalid inputs are rejected before the engine initializes.
- Global-hive export is intentionally disabled; historical `receipts` rows are
  exposed only as unverified legacy evidence references.

## Repo-local skill

`skills/codex-spark-router/SKILL.md` bounds delegation to GPT-5.3-Codex-Spark to
single-objective, fixed-target, minimal-diff edits (UI polish, mechanical
type/syntax repair, narrow fixture edits, drift-only docs). Architecture,
security, schema/migration, and scientific-claim work is explicitly out of
scope for that route.
