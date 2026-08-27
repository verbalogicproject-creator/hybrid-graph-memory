# 🌌 Fractal Memory — powered by Antigravity Memory OS

**Document Version:** `4.0.0-SELF-AWARENESS`  
**Target Audience:** Novice Developers, Seasoned Engineers, Cold-Started AI Agents, and Peer Assistants  
**System Classification:** Local Multimodal Project Memory OS & Multi-Project Hive-Mind Engine  
**Runtime Constraints:** Linux Termux Android (ARM64), Node.js `v24.18.0`, Pure JS Zero-C++ Mandate  

---

## 📑 Table of Contents

1. [The Grand Vision & Identity (System Self-Awareness)](#1-the-grand-vision--identity-system-self-awareness)
2. [Section 1: The Intuitive Primer (ELI5 & Zero-Knowledge Primer)](#2-section-1-the-intuitive-primer-eli5--zero-knowledge-primer)
3. [Section 2: Mathematical Foundations & Algorithms](#3-section-2-mathematical-foundations--algorithms)
4. [Section 3: GraphRAG & AST Static Dependency Mapping](#4-section-3-graphrag--ast-static-dependency-mapping)
5. [Section 4: The Agentic Loop & Proactive Hooks](#5-section-4-the-agentic-loop--proactive-hooks)
6. [Section 5: SQLite Database Schema & Cross-Modal Storage](#6-section-5-sqlite-database-schema--cross-modal-storage)
7. [Section 6: CLI, Tooling & Workflow Reference](#7-section-6-cli-tooling--workflow-reference)
8. [Section 7: Standalone Extraction Blueprint (`antigravity-memory-os`)](#8-section-7-standalone-extraction-blueprint-antigravity-memory-os)
9. [Section 8: Multi-Project "Hive-Mind" Federated Intelligence](#9-section-8-multi-project-hive-mind-federated-intelligence)
10. [Section 9: Core Architectural Invariants & Golden Rules](#10-section-9-core-architectural-invariants--golden-rules)

---

## 1. The Grand Vision & Identity (System Self-Awareness)

> **Fractal family boundary (current).** This package is **Fractal Memory —
> powered by Antigravity Memory OS**: local-first project indexing, topology,
> decisions, retrieval and non-authoritative experiential memory. Codio builds
> applications. SAG/Fractal Runtime owns authority, actions, observations,
> evidence levels and receipts. Fractal Base will own users, workspaces,
> application data, auth, storage, realtime, secrets and jobs. Memory does not
> own any of those surfaces and never promotes a local record to SAG evidence.

### What Am I?
I am **Antigravity Memory OS**: an autonomous, local, multimodal memory engine and collective intelligence layer. I bridge the gap between large language models (LLMs) and rapidly evolving codebases by providing:
1. **Sub-second semantic, lexical, and topological retrieval** without sending entire codebases over the wire.
2. **Episodic and experiential recording** that automatically captures architectural decisions, git commits, and runtime generations.
3. **Multi-Project Hive-Mind capabilities** that allow isolated project databases to share distilled universal engineering heuristics without leaking proprietary secrets.

### Why Do I Exist?
Traditional AI coding assistants suffer from **Context Amnesia**:
* Every time a conversation window resets or context is truncated, the agent forgets project invariants, historical bug fixes, and system topology.
* Pumping hundreds of files into an LLM context window causes high latency, high API costs, and "lost-in-the-middle" attention degradation.
* Traditional vector databases (Pinecone, Chroma, Milvus) or native C++ SQLite extensions (`sqlite-vss`, `faiss`) are heavy, fragile, and fail to compile on mobile environments like **Termux on Android**.

Antigravity Memory OS solves this by combining **Pure JavaScript Float32 vector math**, **SQLite FTS5 BM25 lexical search**, **TypeScript Compiler API static AST mapping**, and **Elo-style temporal decay** into a self-contained, mobile-native engine that performs over **560,000 vector comparisons per second** with **zero native C++ dependencies**.

---

## 2. Section 1: The Intuitive Primer (ELI5 & Zero-Knowledge Primer)

> *This section is written for anyone with zero prior background in vector search or AI memory systems.*

### 📚 The Giant Library Analogy
Imagine an AI assistant is a brilliant detective entering a massive library containing 100,000 pages of code, notes, and rules:
* **The Old Way (Without Memory OS):** Every time you ask a question, the detective must read all 100,000 pages from scratch before answering. By page 5,000, they start forgetting what they read on page 10, and they take 2 minutes just to respond.
* **The Memory OS Way:** The library has an ultra-fast automated index card system:
  1. **Semantic Search (The Meaning Finder):** You ask *"How do we make luxury perfume bottles?"*, and it finds cards about *"Glass droppers and gold foil labels"*, even if you didn't say the word "perfume".
  2. **Lexical Search (The Exact Word Finder):** You ask for `useStudioStore`, and it instantly locates the exact line of code where that word appears.
  3. **GraphRAG (The Map of Connections):** It looks at a subway-style architectural map and sees: *`StudioTab` connects to `PromptCompiler`, which connects to `GeminiNanoBanana`*. It brings along the map so the detective understands the whole neighborhood, not just one isolated house.
  4. **Time Decay (The Freshness Filter):** Rules written today are given priority over notes from 3 months ago that might be outdated.

```
                      YOUR QUESTION / PROMPT
                                 │
         ┌───────────────────────┼───────────────────────┐
         ▼                       ▼                       ▼
   [ Meaning Search ]     [ Exact Keyword ]      [ Architecture Map ]
    (Vector Cosine)         (SQLite FTS5)            (GraphRAG)
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 ▼
                     [ Freshness Decay Filter ]
                   (14-Day Half-Life Multiplier)
                                 │
                                 ▼
              🎯 Top 3 Perfect Context Cards (Sub-Second)
```

---

### 🧠 The Three Kinds of Memory
Memory OS organizes all project knowledge into three distinct layers:

| Memory Layer | Real-World Analogy | What It Stores | Example |
| :--- | :--- | :--- | :--- |
| **1. Source Memory** | The Blueprint | Raw code files (`.ts`, `.tsx`, `.js`, `.py`) | Functions, React components, CSS classes |
| **2. Architectural Memory** | The Map & Rules | System constraints and component relations (`.ctx`) | *"`OrchestratorTab` controls `LightingDirective`"* |
| **3. Experiential Memory** | The Diary | Past generation runs, git commit logs, user feedback | *"`Commit 1f6cc99`: Implemented Disambiguation Gate"* |

---

## 3. Section 2: Mathematical Foundations & Algorithms

### 📐 1. Pure JS Cosine Similarity Engine
Vector search translates text chunks into 768-dimensional numerical vectors (via `gemini-embedding-2`). To calculate similarity between query vector $\mathbf{A}$ and chunk vector $\mathbf{B}$:

$$\text{Cosine Similarity}(\mathbf{A}, \mathbf{B}) = \frac{\mathbf{A} \cdot \mathbf{B}}{\|\mathbf{A}\|_2 \|\mathbf{B}\|_2} = \frac{\sum_{i=1}^{768} A_i B_i}{\sqrt{\sum_{i=1}^{768} A_i^2} \sqrt{\sum_{i=1}^{768} B_i^2}}$$

* **Zero-Loss BLOB Packing:** Stored in SQLite as raw `Float32Array` binary buffers (`768 * 4 = 3,072 bytes` per vector) with zero string or JSON serialization overhead.
* **Termux ARM64 Benchmark:** Executes **560,582 comparisons/sec** in single-threaded pure V8 JavaScript.

---

### ⏳ 2. Elo-Style 14-Day Exponential Half-Life Time Decay
Codebases evolve. A design decision made 6 months ago shouldn't outrank code written this morning. During the final ranking phase, chunk scores are multiplied by an exponential half-life time decay factor:

$$\text{Decay Factor}(\Delta t) = \max\left(\text{Floor}, \, 2^{-\frac{\Delta t}{T_{\text{half}}}}\right)$$

Where:
* $\Delta t = \text{age in days} = \frac{t_{\text{now}} - t_{\text{updated}}}{86,400,000\text{ ms}}$
* $T_{\text{half}} = 14\text{ days}$
* $\text{Floor} = 0.10$ (guarantees historical foundations are never 100% starved out)

```
Decay Multiplier
  1.0 ┼─────────╮ (Fresh chunk: 1.00x)
  0.8 │          ╲
  0.6 │           ╲
  0.5 │────────────● (14 days: 0.50x)
  0.4 │             ╲
  0.25│──────────────● (28 days: 0.25x)
  0.1 │               ╰────────────────── (Floor: 0.10x)
  0.0 ┴─────┬─────┬─────┬─────┬─────┬─────▶ Age in Days
      0     7    14    21    28    35
```

---

### 🔀 3. Reciprocal Rank Fusion (RRF $k=60$)
To merge Semantic, Lexical, and Graph topological scores without normalization distortion:

$$\text{RRF Score}(d) = \sum_{m \in \{\text{semantic}, \text{lexical}, \text{graph}\}} \frac{W_m}{k + \text{Rank}_m(d) + 1} \times \text{Decay Factor}(d)$$

* $k = 60$ (smoothing constant preventing top-rank monopoly).
* $W_{\text{semantic}} = 1.0$, $W_{\text{lexical}} = 1.0$ (boosted to $2.5$ for exact symbol lookups), $W_{\text{graph}} = 1.2$ (boosted to $2.2$ for architectural queries).

---

### 🛑 4. The Disambiguation Gate Heuristic
Prevents hallucination cascades when an incoming prompt has low similarity or violates system topology:

$$\text{Confidence} = (0.7 \times \text{TopCosineScore}) + \left(0.3 \times \frac{\text{MatchedRelations}}{\text{RequiredRelations}}\right)$$

* If $\text{RequiredRelations} = 0$ (general prompt with no mentioned components), $\text{Confidence} = \text{TopCosineScore}$.
* **Hard Halt Threshold:** If $\text{Confidence} < 0.60$, execution short-circuits and outputs a structured `<antigravity_disambiguation_request>` XML payload asking the user to clarify intent.

---

## 4. Section 3: GraphRAG & AST Static Dependency Mapping

### 🕸️ 1. The `.ctx` Graph Specification Format
Architecture specifications are stored in `.ctx` files with explicit weighted directional edges:

```ctx
@component OrchestratorTab {
  file: "components/OrchestratorTab.tsx"
  state_dependencies: ["useStudioStore.domain", "useStudioStore.lighting"]
  renders: ["Orchestrator3DCanvas", "ColorPickerInput", "PromptPreview"]
}

@module PromptCompiler {
  file: "lib/compiler.ts"
  exports: ["compileStudioPrompt"]
}

@relation OrchestratorTab controls MasterPipeline (weight=1.5)
@relation StudioTab triggers PromptCompiler (weight=1.5)
@relation PromptCompiler produces CompiledPrompt (weight=1.5)
@relation GenerateApiRoute calls GeminiNanoBanana (weight=1.5)
```

---

### 🔍 2. Automated AST Dependency Mapper (`memory/ast_dependency_mapper.ts`)
Instead of manually typing architecture graphs, the **AST Dependency Mapper** uses the TypeScript Compiler API (`typescript`) to scan the codebase:
1. Parses AST abstract syntax trees for `.ts` and `.tsx` files.
2. Identifies exported symbols, imported dependencies, JSX component rendering trees, and `useStudioStore` state subscriptions.
3. Maps function invocations (`fetch('/api/generate')`, `compileStudioPrompt()`).
4. Generates standard GraphRAG `.ctx` specifications containing **42 components/modules and 101 directional relations**.

Command to run:
```bash
npm run map:ast
```

---

## 5. Section 4: The Agentic Loop & Proactive Hooks

```
                   USER PROMPT INCOMING
                            │
                            ▼
          [ Proactive Pre-Flight RAG Hook ]
       • Regex scan for @tags & architectural symbols
       • Cross-reference AST GraphRAG dictionary
                            │
                            ▼
               [ Disambiguation Gate ]
        • Is (0.7*Cosine + 0.3*GraphDensity) >= 0.60?
              │                            │
             YES                           NO
              │                            │
              ▼                            ▼
   [ Augmented System Prompt ]   [ Short-Circuit XML Output ]
   <antigravity_proactive_ctx>   <antigravity_disambiguation_req>
              │
              ▼
   [ AI Generation / Response ]
              │
              ▼
    (On Git Commit Trigger)
   [ Git-Observer Daemon ]
   • Diffstat + 768d Vector
   • Episodic SQLite Entry
```

---

## 6. Section 5: SQLite Database Schema & Cross-Modal Storage

Database is managed via Node.js native `node:sqlite` (synchronous WAL mode):

```sql
-- 1. Source Files Registry
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  filepath TEXT UNIQUE NOT NULL,
  file_type TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  size INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL
);

-- 2. Semantic Code & Doc Chunks
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source_type TEXT NOT NULL,
  modal_type TEXT DEFAULT 'code', -- 'code' | 'text' | 'image'
  b64_source TEXT,                -- Optional raw base64 string
  symbol_name TEXT,
  symbol_kind TEXT,
  heading TEXT,
  start_line INTEGER,
  end_line INTEGER,
  embedding BLOB,                 -- 768d Float32Array packed binary buffer
  embedding_model TEXT NOT NULL,
  embedding_dimension INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 3. Experiential & Multimodal Memories
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  memory_type TEXT NOT NULL,       -- 'generation_history' | 'user_interaction' | 'architecture_spec'
  modality TEXT NOT NULL,          -- 'text' | 'image' | 'generation'
  modal_type TEXT DEFAULT 'text',  -- 'code' | 'text' | 'image'
  b64_source TEXT,                 -- UI Screenshot Base64 payload
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,                   -- Serialized JSON metadata
  embedding BLOB,
  embedding_model TEXT NOT NULL,
  embedding_dimension INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 4. Architectural Relations (GraphRAG Edges)
CREATE TABLE IF NOT EXISTS relations (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  to_id TEXT NOT NULL,
  source TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  confidence REAL DEFAULT 1.0,
  metadata TEXT,
  created_at INTEGER NOT NULL
);

-- 5. Full-Text Search (FTS5 BM25 Lexical Index)
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_id UNINDEXED,
  filepath UNINDEXED,
  content,
  symbol_name,
  heading,
  tokenize = 'porter unicode61'
);
```

---

## 7. Section 6: CLI, Tooling & Workflow Reference

### 💻 Command Reference Table

| Task | Shell Command | Description |
| :--- | :--- | :--- |
| **Interactive TUI** | `npm run memory` | Launches interactive prompt for search, indexing, stats, graph, and cron setup. |
| **Hybrid Search** | `npm run memory -- search "<query>"` | Performs sub-second Rank Fusion search across vectors, BM25, and GraphRAG. |
| **Text Ingestion** | `npm run memory -- ingest-text "<note>"` | Encodes and logs a markdown note or handoff into experiential memory. |
| **Image Ingestion** | `npm run memory -- ingest-image <path_or_b64> "[caption]"` | Encodes UI screenshots and terminal captures into cross-modal vectors. |
| **Incremental Index**| `npm run memory -- index` | Scans workspace and indexes modified/new files into SQLite vectors. |
| **AST Map Refresh** | `npm run map:ast` | Traverses Next.js AST trees and updates `image-studio.autogen.ctx`. |
| **Database Stats** | `npm run memory -- stats` | Displays file counts, vector chunks, graph edges, and SQLite file size. |
| **Graph Inspection**| `npm run memory -- graph` | Lists all active architectural GraphRAG relation edges. |
| **Audit Test Suite** | `npm run test:phase1` | Runs 100% automated regression and vector math benchmark tests. |

---

## 8. Section 7: Standalone Extraction Blueprint (`antigravity-memory-os`)

To extract the memory engine into a standalone, reusable package:

### 📦 Repository Layout
```
antigravity-memory-os/
├── bin/
│   └── agy-memory.ts             # Global CLI executable (npm link / npx)
├── src/
│   ├── index.ts                  # Public SDK exports
│   ├── core/
│   │   ├── engine.ts             # MemoryEngine facade
│   │   ├── database.ts           # SQLite multi-database manager
│   │   ├── config.ts             # Dynamic .antigravityrc.json loader
│   │   └── types.ts              # Core contracts & schema interfaces
│   ├── vector/
│   │   ├── math.ts               # Pure JS cosine math
│   │   └── providers/
│   │       └── gemini.ts         # Google Gemini embedding provider
│   ├── ast/
│   │   ├── mapper.ts             # Generic TypeScript/JavaScript AST parser
│   │   └── analyzers/            # Pluggable language parsers (Python, Rust, Go)
│   ├── retrieval/
│   │   ├── hybrid_retriever.ts
│   │   ├── rank_fusion.ts        # Elo time decay + RRF
│   │   └── disambiguation.ts     # Disambiguation confidence gate
│   ├── mcp/
│   │   └── server.ts             # Model Context Protocol (MCP stdio)
│   └── hooks/
│       └── git_observer.ts       # Post-commit observer
├── package.json
└── tsconfig.json
```

### ⚙️ Dynamic Configuration (`.antigravityrc.json`)
The config loader traverses upward from `process.cwd()` until it finds `.antigravityrc.json`:
```json
{
  "projectName": "my-project",
  "embeddingModel": "gemini-embedding-2",
  "dimensions": 768,
  "dbPath": ".memory/project_memory.db",
  "halfLifeDays": 14,
  "disambiguationThreshold": 0.60,
  "supportedExtensions": [".ts", ".tsx", ".js", ".jsx", ".py", ".md", ".ctx"]
}
```

### 🔌 Model Context Protocol (MCP) Server
Exposes memory operations to any MCP-compatible agent via `stdio`:
* `agy_memory_search(query: string, scope?: string, limit?: number)`
* `agy_graph_inspect(nodeId?: string, depth?: number)`
* `agy_memory_ingest(content: string, title?: string, modality?: string)`

---

## 9. Section 8: Multi-Project "Hive-Mind" Federated Intelligence

```
                               AI AGENT QUERY
                                     │
                                     ▼
                ┌──────────────────────────────────────────┐
                │    HIVE-MIND FEDERATED QUERY ROUTER      │
                └────────────────────┬─────────────────────┘
                                     │
             ┌───────────────────────┼───────────────────────┐
             ▼                       ▼                       ▼
   [ @local / @current ]   [ @workspace:<project> ]   [ @global / @hive ]
             │                       │                       │
             ▼                       ▼                       ▼
  ~/.antigravity/shards/  ~/.antigravity/shards/   ~/.antigravity/global/
     image-studio.db          backend-api.db           global-hive.db
  • Local UI Code         • API Endpoints          • Universal Patterns
  • Local Shaders         • Database Schemas       • Termux JS Optimizations
  • Component ASTs        • Auth Middleware        • High-DPI Canvas Math
             │                       │                       │
             └───────────────────────┼───────────────────────┘
                                     ▼
                  [ Federated Knowledge Synthesis ]
                  • Zero Cross-Project Secret Leaks
                  • Transferred Heuristic Intelligence
```

### 🛡️ Privacy & Isolation Protocol
1. **Isolated Shards:** Each workspace repository stores its proprietary code, tokens, and file paths in its own SQLite database (`~/.antigravity/shards/<project>.db`).
2. **Global Sanitization Pass (`distill-knowledge.ts`):** High-order heuristics (e.g. *"React 19 touch coordinates require `canvas.width / rect.width` scaling"*) are stripped of local variable names and API keys before being written to `global-hive.db`.

---

## 10. Section 9: Core Architectural Invariants & Golden Rules

Any agent or engineer modifying this system **MUST** preserve the following ten invariants:

1. **`@invariant ZeroNativeCpp`:** Never introduce native C++ vector dependencies (`sqlite-vss`, `faiss`, `node-gyp`). All vector math must remain in pure JavaScript using `Float32Array` buffers to guarantee 100% stability on Termux Android ARM64.
2. **`@invariant Dimension768`:** All vector embeddings are normalized to 768 dimensions matching `gemini-embedding-2`.
3. **`@invariant EloDecayConstraint`:** The 14-day exponential decay ($2^{-\Delta t/14}$) must be calculated strictly during the final RRF sorting pass without modifying raw vector extraction speed.
4. **`@invariant DisambiguationThreshold`:** If query retrieval confidence is below $0.60$, the system must halt and output `<antigravity_disambiguation_request>`.
5. **`@invariant ZeroTouchDrift`:** HTML5 Canvas pointer math must multiply client coordinates by `(canvas.width / rect.width)`.
6. **`@invariant TenLayerSync`:** Any parameter expansion across the Orchestrator must be updated synchronously across all 10 layers mapped in `ORCHESTRATOR_SPECS_SOT.md`.
7. **`@invariant ModelTarget`:** Image generation model is strictly `gemini-3.1-flash-image` via `@google/genai` `generateContent` with `responseModalities: ["IMAGE"]` and inlineData extraction.
8. **`@invariant MobileMemoryLimit`:** Process chunks in small batches (maximum 50 chunks per batch) during indexing to avoid V8 garbage collection pressure on mobile CPUs.
9. **`@invariant SecretProtection`:** `.env.local` and `.memory/*.db` are strictly gitignored. Never commit raw API keys or binary databases.
10. **`@invariant ClipboardBypass`:** For complex terminal payloads on Android devices, route text interactions through the `session-handoff-dashboard.html` textarea bypass.
