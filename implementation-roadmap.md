# Antigravity Memory OS: Implementation Roadmap

**Vision:** A standalone, persistent, external Causal Memory Engine that acts as the "System 2 Frontal Lobe" for external coding agents (Claude Code, Codex, Antigravity). 

**Core Principle:** *Separation of Concerns.* The Memory OS does not write code. It indexes reality, analyzes graph topology, runs background simulations, and perfectly serves highly-scoped Context Windows to external autonomous agents via an API.

---

## Phase 1: ULTRA Integration & Graph Formalization (Immediate)
* **Goal:** Connect the TypeScript SQLite engine to the Python-based ULTRA foundation model.
* **Architecture:** 
  1. Create an inference script (`ultra_bridge.py`) that reads the `relations` table from SQLite.
  2. Map our custom relation strings (e.g., `calls`, `imports`) into a standardized edge format for `ultra_50g`.
  3. Run zero-shot link prediction to find missing edges.
  4. Write these back to SQLite with a `source = "ultra_inferred"` flag.

## Phase 2: Active Memory Worker (System 2 Loop)
* **Goal:** Make the OS autonomous.
* **Architecture:**
  1. Implement a background worker (or `cron`) that triggers the ULTRA bridge periodically.
  2. Broadcast inferred edges via the existing WebSocket infrastructure.
  3. Update the 3D Renderer to display AI-inferred edges in a distinct style (e.g., pulsating neon pink), allowing the human to visually see the AI "thinking" and finding hidden architectural couplings.

## Phase 3: The "Checkout" API for External Agents
* **Goal:** Serve perfectly scoped context to external LLMs.
* **Architecture:**
  1. Expose a REST API or MCP (Model Context Protocol) server via the Express dashboard.
  2. Endpoint: `GET /api/context?node=src/auth.ts`
  3. Instead of naive text search, the API uses ULTRA's structural ranking to extract the optimal Sub-Graph, preventing the LLM from hallucinating while staying strictly within its token limits.

## Phase 4: Generalized Epistemology Plugins
* **Goal:** Move beyond code into universal knowledge representation.
* **Architecture:**
  1. Abstract the `AstDependencyMapper` into a plugin system.
  2. Build `LegalContractMapper`, `InfrastructureMapper`, and `SlackMapper` to ingest cross-domain data into the exact same SQLite graph structure, instantly unlocking cross-domain vulnerability detection via ULTRA.
