# Fractal Memory Integration Guide

This guide demonstrates how external agents like Codio or Aria can integrate with Fractal Memory to obtain scoped contextual awareness *without* granting application authority, mutating data, or asserting evidence.

## Overview
Fractal Memory is the local-first project-memory and contextual-intelligence member of the Fractal family. It does **not** manage users, authentication, jobs, or evidence receipts (which belong to SAG/Fractal Runtime and Fractal Base). Instead, it securely provides read-only, strict-namespace bounded memory retrieval.

## Using `FractalMemoryPort`

The `FractalMemoryPort` is the explicit boundary for bounded integration. By using this port, Codio can query context safely:

```typescript
import { MemoryEngine, FractalMemoryPort } from "antigravity-memory-os";

// 1. Initialize the underlying engine
const engine = new MemoryEngine();
await engine.init();

// 2. Wrap it with the typed bounded port specifying the strict namespace
const memoryPort = new FractalMemoryPort(engine, "my-workspace", "my-project");

// 3. Perform a scoped, read-only search
// The engine will strictly fail closed if a record is missing identity or mismatched.
const context = await memoryPort.scopedSearch("How is the authentication token generated?");

// 4. Retrieve a bounded context packet for the current question.
const packet = await memoryPort.getContextPacket(
  "How is the authentication token generated?"
);

// 5. Look up Evidence References
// Note: Legacy causal receipts are returned as unverified evidence references. 
// Fractal Memory cannot independently grant L3/L4/L5 SAG evidence levels.
const historicalReferences = memoryPort.getEvidenceReferences("AuthenticationFailure");

console.log(historicalReferences.map(ref => ref.evidenceStatus)); // "unverified_legacy"
```

The port only searches the engine namespace it was constructed for. A caller
cannot turn a port search into a federated search, admit an asset, or turn a
memory reference into a SAG receipt. Legacy evidence references are available
only through the explicit lookup methods and are never injected into a scoped
context packet.

## Explicit federation

The underlying engine defaults to strict scope. A cross-project search must opt
in with `retrievalMode: "federated"` and provide a non-empty local admission
record (`approvedBy`, `purpose`, and `allowedWorkspaces`, with optional
`allowedProjects`). Missing identities and non-admitted workspaces are excluded;
there is no hive fallback for a strict query.

## MCP Boundary

Fractal Memory exposes an MCP server (`MemoryMcpServer`). By default, it operates in **read-only mode**. 
To allow Codio/Aria to read context without risking accidental mutations:

```typescript
import { MemoryMcpServer } from "antigravity-memory-os";

// Create server with mutationMode = false (the default)
const server = new MemoryMcpServer(engine); 
await server.start();
```

When connected to this MCP server, tools like `agy_memory_search` will work normally, but mutation tools (`agy_ingest_operational_asset`, `agy_admit_operational_asset`, `agy_quarantine_operational_asset`) will return an explicit error rejecting the mutation attempt.

For a deliberately local maintenance session, pass
`{ mutationMode: true }` to the constructor. MCP ingestion still records a
model-proposed asset as a candidate; a separately reviewed manual admit call is
required before it becomes retrievable.
