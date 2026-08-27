import assert from "node:assert/strict";

import { HybridRetriever } from "../src/retrieval/hybrid_retriever";
import type { MemoryConfig } from "../src/core/config";
import type { EmbeddingProvider } from "../src/core/types";
import { MemoryMcpServer } from "../src/mcp/server";

const embeddingProvider: EmbeddingProvider = {
  modelName: "offline-test",
  dimensions: 1,
  providerType: "local_llama",
  embedDocument: async () => new Float32Array([1]),
  embedQuery: async () => new Float32Array([1]),
};

const config: MemoryConfig = {
  workspace: "workspace-a",
  projectName: "project-a",
  projectRoot: ".",
  providerMode: "local",
  cloud: { embeddingModel: "unused", generatorModel: "unused", dimensions: 1 },
  local: {
    embedderUrl: "offline",
    rerankerUrl: "offline",
    generatorUrl: "offline",
    generatorModels: [],
    activeGenerator: "offline",
    dimensions: 1,
  },
  dbPath: ":memory:",
  sharedHivePath: ":memory:",
  supportedExtensions: [],
  excludedDirectories: [],
  excludedFiles: [],
  candidateLimit: 20,
  defaultResultLimit: 20,
  rrfConstant: 60,
  halfLifeDays: 14,
  disambiguationThreshold: 0,
  minSimilarityThreshold: -1,
};

function record(id: string, workspace?: string, project?: string, admissionStatus?: string) {
  return {
    id,
    fileId: id,
    filepath: id + ".ts",
    chunkIndex: 0,
    content: "scoped federated retrieval " + id,
    contentHash: id,
    sourceType: "code",
    embedding: new Float32Array([1]),
    embeddingModel: "offline-test",
    embeddingDimension: 1,
    providerType: "local_llama" as const,
    workspace,
    project,
    admissionStatus,
    createdAt: 1,
    updatedAt: 1,
  };
}

const records = [
  record("local", "workspace-a", "project-a", "admitted"),
  record("cross-workspace", "workspace-b", "project-a", "admitted"),
  record("cross-project", "workspace-a", "project-b", "admitted"),
  record("missing-identity", undefined, undefined, "admitted"),
  record("federated-admitted", "workspace-f", "project-f", "admitted"),
  record("federated-candidate", "workspace-f", "project-f", "candidate"),
];

const database = {
  getAllChunksWithEmbeddings: () => records,
  getAllMemoriesWithEmbeddings: () => [],
  getAllRelations: () => [],
  getRelationsForNode: () => [],
  recordAccess: () => undefined,
};

async function main() {
  const retriever = new HybridRetriever(database as any, embeddingProvider, config);

  const strict = await retriever.search("scoped", { useLocalReranker: false });
  assert.deepEqual(strict.map((item) => item.id), ["local"]);

  await assert.rejects(
    retriever.search("scoped", { strictNamespace: false, useLocalReranker: false }),
    /Unscoped retrieval is disabled/,
  );
  await assert.rejects(
    retriever.search("federated", { retrievalMode: "federated", useLocalReranker: false }),
    /Federated retrieval requires/,
  );

  const federated = await retriever.search("federated", {
    retrievalMode: "federated",
    federatedAdmission: {
      approvedBy: "local-reviewer",
      purpose: "cross-project architecture comparison",
      allowedWorkspaces: ["workspace-f"],
      allowedProjects: ["project-f"],
    },
    useLocalReranker: false,
  });
  assert.deepEqual(federated.map((item) => item.id), ["federated-admitted"]);

  const readOnlyMcp = new MemoryMcpServer({} as any);
  const mutationAttempt = await (readOnlyMcp as any).handleRequest({
    jsonrpc: "2.0",
    id: "read-only-control",
    method: "tools/call",
    params: { name: "agy_ingest_operational_asset", arguments: {} },
  });
  assert.equal(mutationAttempt.error?.code, -32600);
  (readOnlyMcp as any).rl.close();

  console.log("fractal alignment: strict and federated controls pass");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
