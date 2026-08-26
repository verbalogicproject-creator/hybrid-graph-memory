# Memory OS — Fixes and Upgrade Path

**For:** Antigravity (Gemini)
**Repo:** `/root/antigravity-memory-os`
**Written:** 2026-08-23
**Scope:** Two critical bug fixes in the fallback path, followed by an architectural roadmap for upgrading the system to a production-grade Agentic Memory OS with on-demand context and workflow injection.

---

## Phase 1: Critical Fixes

The immediate design intent is: **cloud (Gemini) is the floor; local models are the upgrade.** `providerMode: "auto"` should handle this, but currently fails in two ways when local models are unavailable.

### Defect 1 — The auto-fallback can never fire
**The Bug:** The system attempts to wrap the `LocalLlamaEmbeddingProvider` constructor in a `try/catch` to fall back to Gemini. However, the constructor only assigns fields and cannot throw. When local models are down, the system proceeds with the local provider and crashes later with a fetch error.
**Required Behaviour:**
1. Implement an async `isAvailable` probe (`/health`) on the local embedding provider, matching the reranker and generator patterns.
2. Make provider initialization async via an `init()` method.
3. In `auto` mode, probe local first; fallback to Gemini if it fails.
4. Log the selected provider and reason at startup.
5. Fail fast and explicitly if neither provider is available.

### Defect 2 — A provider switch silently corrupts retrieval
**The Bug:** The `hybrid_retriever.ts` calculates cosine similarity against all stored chunks, regardless of the model that generated them. Because `embeddinggemma-300m-q4` and `gemini-embedding-2` both output 768-dimensional vectors, no error is thrown, but the vector spaces are completely different, resulting in corrupted retrieval.
**Required Behaviour:**
1. **Filter, never mix:** The retriever must skip records whose composite identity (`providerType:modelName:dimensions`) does not match the active provider.
2. **Report exclusions:** Log exactly how many chunks were skipped due to embedding mismatch.
3. **Fail closed:** If zero records match the active space but the index has data, throw a distinct error demanding a re-index, rather than returning an empty success.
4. Add a metadata manifest table to track index identity.

---

## Phase 2: Production Upgrade Path (The Next Level)

Currently, the system is a basic semantic search engine loading a flat list of chunks into a JavaScript memory loop. To evolve this into a production-grade **Memory OS with on-demand context injection**, the architecture must be expanded across four vectors.

### 1. Operational Assets & Intent-Driven Injection
The system must handle structured procedures, not just raw knowledge.
* **Differentiated Asset Types:** Move beyond generic "chunks." Create explicit schemas for `Prompts` (variables, output formats) and `Workflows/Runbooks` (triggers, sequential steps, required tools).
* **Deterministic Retrieval:** Semantic search is for knowledge discovery. Workflows require deterministic retrieval. Tag operational docs with explicit triggers (e.g., `trigger: deployment`). When the user intent matches, inject the entire workflow deterministically.
* **Active Tool-Based Loading:** Equip the LLM agent with tools like `list_workflows()` and `load_workflow(name)`. Allow the agent to actively fetch its own standard operating procedures when it recognizes a task, rather than guessing what to inject beforehand.
* **Workflow State Tracking:** Implement a "Working Memory" scratchpad. If a multi-step workflow is injected, the system must track and inject the current state: *"Active Workflow: X. Current Step: 2 of 5. Next Step: 3 of 5."*

### 2. Advanced Data Modeling & Provenance
* **Knowledge Graphs (GraphRAG):** Extract entities and relationships during ingestion. A hybrid Vector + Graph database answers complex, multi-hop architectural questions more effectively than vectors alone.
* **Temporal Tracking:** Record `created_at`, `last_accessed_at`, and `access_count`. Implement a "forgetting curve" to decay obsolete chunks and prioritize frequently used operational knowledge.
* **Granular Provenance:** Store exact file paths, line numbers, and commit hashes so the agent can properly cite, update, or modify the source of its injected context.

### 3. Categorization & Namespaces
* **LLM Auto-Tagging:** Utilize a lightweight local model or fast cloud model during the ingestion pipeline to automatically classify data (e.g., `Architecture_Decision`, `Bug_Fix`, `API_Spec`).
* **Strict Hierarchical Namespaces:** Context injection must be heavily scoped by `Workspace -> Project -> Module` to prevent cross-contamination of context between distinct projects or domains.

### 4. Vector Architecture & Clustering
* **Dedicated Vector Engine:** Eliminate the `getAllChunksWithEmbeddings()` JS loop. Migrate to a lightweight, dedicated vector extension like `sqlite-vec` or an external store (Milvus/Qdrant) utilizing HNSW indexing for instant similarity search at scale.
* **Meta-Summaries:** Run periodic clustering algorithms (e.g., HDBSCAN) over embeddings. Generate an LLM-authored "Meta-Summary" for each cluster. During retrieval, search the Meta-Summaries first. If relevant, dive into the cluster; if not, skip it. This drastically reduces token consumption.
* **Dynamic Token Budgeting:** Implement a context manager that dynamically budgets tokens for system instructions, conversation history, and high-priority retrieved memories, utilizing the Reranker to maximize signal-to-noise ratio in the context window.
