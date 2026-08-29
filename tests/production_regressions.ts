import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { loadMemoryConfig } from "../src/core/config";
import { MemoryDatabase } from "../src/core/database";
import { ProjectScanner } from "../src/ast/scanner";
import { enforceDisambiguationGate } from "../src/retrieval/disambiguation";
import { LexicalScorer } from "../src/retrieval/lexical";
import { tokenizeQuery } from "../src/core/text";
import { HybridRetriever } from "../src/retrieval/hybrid_retriever";
import { MemoryMcpServer } from "../src/mcp/server";
import { serveWebDashboard } from "../src/server/web_dashboard";
import { runCli } from "../bin/agy-memory";
import { ThreeJSGraphRenderer } from "../src/visualization/threejs_renderer";

function writeJson(target: string, value: unknown) {
  fs.writeFileSync(target, JSON.stringify(value), "utf8");
}

async function getPage(port: number): Promise<{ body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: "/" }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ body, headers: response.headers }));
    }).on("error", reject);
  });
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "memory-production-"));
  try {
    const configRoot = path.join(tempRoot, "config");
    fs.mkdirSync(configRoot);
    const configPath = path.join(configRoot, ".antigravityrc.json");

    fs.writeFileSync(configPath, "{broken", "utf8");
    assert.throws(() => loadMemoryConfig(configRoot), /Invalid configuration/);
    writeJson(configPath, { cloud: { dimensions: 0 } });
    assert.throws(() => loadMemoryConfig(configRoot), /cloud\.dimensions/);
    writeJson(configPath, { local: { embedderUrl: "https://example.com/collect" } });
    assert.throws(() => loadMemoryConfig(configRoot), /loopback host/);
    writeJson(configPath, { excludedPathPrefixes: ["../outside"] });
    assert.throws(() => loadMemoryConfig(configRoot), /project-relative paths/);
    writeJson(configPath, { minSimilarityThreshold: 0, disambiguationThreshold: 0 });
    const zeroConfig = loadMemoryConfig(configRoot);
    assert.equal(zeroConfig.minSimilarityThreshold, 0);
    assert.equal(zeroConfig.disambiguationThreshold, 0);

    const scanRoot = path.join(tempRoot, "scan");
    fs.mkdirSync(scanRoot);
    fs.writeFileSync(path.join(scanRoot, "b.ts"), "12");
    fs.writeFileSync(path.join(scanRoot, "a.ts"), "12345");
    fs.writeFileSync(path.join(scanRoot, "c.ts"), "34");
    fs.writeFileSync(path.join(scanRoot, "withdrawn.ts"), "unsupported historical claim");
    fs.mkdirSync(path.join(scanRoot, "legacy"));
    fs.writeFileSync(path.join(scanRoot, "legacy", "false.ts"), "unsupported historical claim");
    writeJson(path.join(scanRoot, ".antigravityrc.json"), {
      supportedExtensions: [".ts"],
      excludedPathPrefixes: ["legacy", "withdrawn.ts"],
      maxFileBytes: 4,
      maxFiles: 1,
      maxTotalBytes: 100,
    });
    const scan = new ProjectScanner(loadMemoryConfig(scanRoot)).scanDetailed();
    assert.deepEqual(scan.files.map((file) => file.filepath), ["b.ts"]);
    assert.deepEqual(scan.seenFilepaths, ["a.ts", "b.ts", "c.ts"]);
    assert.deepEqual(scan.skipped.map((skip) => [skip.filepath, skip.reason]), [
      ["a.ts", "too_large"],
      ["c.ts", "file_limit"],
    ]);
    assert.equal(scan.complete, false);
    assert.equal(scan.files.some((file) => file.filepath.includes("legacy") || file.filepath === "withdrawn.ts"), false);
    assert.equal(scan.seenFilepaths.some((filepath) => filepath.includes("legacy") || filepath === "withdrawn.ts"), false);

    const result: any = { id: "x", sourceType: "code", modality: "text", content: "x", finalScore: 0.9, reason: "test" };
    const rejected = enforceDisambiguationGate([result], { exactEvidence: false, topSemanticScore: 0.4, threshold: 0.6 });
    assert.equal(rejected[0]?.id, "DISAMBIGUATION_REQUIRED");
    assert.deepEqual(enforceDisambiguationGate([result], { exactEvidence: true, threshold: 1 }), []);
    assert.throws(() => enforceDisambiguationGate([result], { exactEvidence: false, threshold: 2 }), RangeError);

    // Gate evidence arms are a disjunction: any one arm clearing its bar admits the
    // result, and the gate still fails closed when none of them do.
    const gate = (evidence: any) => enforceDisambiguationGate([result], evidence);
    const gated = (evidence: any) => gate(evidence)[0]?.id === "DISAMBIGUATION_REQUIRED";

    // Lexical evidence alone admits a result the semantic arm would have refused.
    assert.deepEqual(
      gate({ exactEvidence: false, topSemanticScore: 0.31, topLexicalScore: 0.9, threshold: 0.5, lexicalThreshold: 0.5 }),
      []
    );
    // Semantic evidence admits a paraphrase that merely shares a term with the
    // corpus, well below the lexical bar.
    assert.deepEqual(
      gate({ exactEvidence: false, topSemanticScore: 0.72, topLexicalScore: 0.1, threshold: 0.5, lexicalThreshold: 0.5 }),
      []
    );
    // But a content-free query embeds near the corpus centroid and scores like a
    // real one, so semantic similarity with no lexical anchor at all is refused.
    assert.equal(
      gated({ exactEvidence: false, topSemanticScore: 0.9, topLexicalScore: 0, threshold: 0.5, lexicalThreshold: 0.5 }),
      true
    );
    assert.equal(
      gated({ exactEvidence: false, topSemanticScore: 0.9, threshold: 0.5, lexicalThreshold: 0.5 }),
      true
    );
    // The anchor never overrides an exact hit.
    assert.deepEqual(
      gate({ exactEvidence: true, topSemanticScore: 0.9, topLexicalScore: 0, threshold: 0.5, lexicalThreshold: 0.5 }),
      []
    );
    // A refusal caused by the missing anchor says so.
    assert.match(
      gate({ exactEvidence: false, topSemanticScore: 0.9, topLexicalScore: 0, threshold: 0.5, lexicalThreshold: 0.5 })[0].content,
      /No term in the query occurs anywhere in the indexed corpus/
    );
    // Callers that never engage the lexical arm keep unanchored semantic evidence.
    assert.deepEqual(
      gate({ exactEvidence: false, topSemanticScore: 0.9, threshold: 0.5 }),
      []
    );
    // An explicit anchor overrides the score-derived default in both directions:
    // the anchor asks whether the query touches the namespace at all, which is a
    // different question from whether an *admissible* record scored above zero.
    assert.deepEqual(
      gate({ exactEvidence: false, topSemanticScore: 0.9, topLexicalScore: 0, lexicalAnchor: true, threshold: 0.5, lexicalThreshold: 0.5 }),
      []
    );
    assert.equal(
      gated({ exactEvidence: false, topSemanticScore: 0.9, topLexicalScore: 0.9, lexicalAnchor: false, threshold: 0.5, lexicalThreshold: 0.5 }),
      false, // still admitted, because the lexical arm itself cleared its bar
    );
    // Both arms below their bar still fails closed.
    assert.equal(
      gated({ exactEvidence: false, topSemanticScore: 0.31, topLexicalScore: 0.2, threshold: 0.5, lexicalThreshold: 0.5 }),
      true
    );
    // Thresholds are inclusive, so a score exactly at the bar counts as evidence.
    assert.deepEqual(
      gate({ exactEvidence: false, topSemanticScore: 0.5, topLexicalScore: 0.1, threshold: 0.5, lexicalThreshold: 0.5 }),
      []
    );
    assert.deepEqual(
      gate({ exactEvidence: false, topSemanticScore: 0, topLexicalScore: 0.5, threshold: 0.5, lexicalThreshold: 0.5 }),
      []
    );
    // Omitting lexicalThreshold preserves pre-lexical-arm semantics: overlap cannot
    // satisfy the gate on its own, so callers that predate the arm are unchanged.
    assert.equal(
      gated({ exactEvidence: false, topSemanticScore: 0.4, topLexicalScore: 1, threshold: 0.6 }),
      true
    );
    // The lexical threshold is range-checked exactly like the semantic one.
    assert.throws(
      () => gate({ exactEvidence: false, topSemanticScore: 0.9, threshold: 0.5, lexicalThreshold: 2 }),
      RangeError
    );
    // A refusal reports both arms so the caller can see which evidence was missing.
    const refusal = gate({ exactEvidence: false, topSemanticScore: 0.31, topLexicalScore: 0.2, threshold: 0.5, lexicalThreshold: 0.5 })[0];
    assert.match(refusal.content, /Semantic: 0\.310 \(needs 0\.500\)/);
    assert.match(refusal.content, /Lexical: 0\.200 \(needs 0\.500\)/);

    // The shipped defaults are the calibrated pair; drift here is a silent recall change.
    const gateRoot = path.join(tempRoot, "gate-defaults");
    fs.mkdirSync(gateRoot, { recursive: true });
    writeJson(path.join(gateRoot, ".antigravityrc.json"), {});
    const gateDefaults = loadMemoryConfig(gateRoot);
    assert.equal(gateDefaults.disambiguationThreshold, 0.5);
    assert.equal(gateDefaults.lexicalEvidenceThreshold, 0.7);
    // And the new field is validated, not silently coerced.
    writeJson(path.join(gateRoot, ".antigravityrc.json"), { lexicalEvidenceThreshold: 4 });
    assert.throws(() => loadMemoryConfig(gateRoot), /lexicalEvidenceThreshold must be a finite number/);

    // The FTS match builder and the lexical scorer must agree on what a term is.
    // When they disagreed, a content-free query still produced FTS hits on function
    // words, which satisfied the gate's lexical anchor and let the semantic arm
    // vouch for gibberish on its own.
    assert.deepEqual(tokenizeQuery("of in on at by"), []);
    // Coverage is a ratio, so one surviving term scores 1.0 and admits the query on
    // the lexical arm alone. "without" was missing from the stop-word class, was the
    // only token to survive this query, and let seven content-free queries through
    // the gate on a development split. A missing function word is a gate defect.
    assert.deepEqual(tokenizeQuery("to from with without the and or but"), []);
    assert.deepEqual(tokenizeQuery("although within upon whereas"), []);
    assert.deepEqual(tokenizeQuery("the the the"), []);
    assert.deepEqual(tokenizeQuery("how to change a car tire"), ["change", "car", "tire"]);
    assert.deepEqual(tokenizeQuery("FTS5, lexical-search"), ["fts5", "lexical", "search"]);

    // Coverage is the fraction of query terms found, independent of the field
    // weights used for ranking. A single symbol hit must not look like broad
    // coverage: it drove the weighted score to 0.75 on a two-term query and let
    // out-of-domain text clear the lexical bar.
    const scorer = new LexicalScorer();
    const oneOfThree = scorer.scoreText("change car tire", "c1", "nothing relevant here", "hasChanged");
    assert.ok(oneOfThree, "expected a symbol hit");
    assert.equal(oneOfThree!.coverage, 1 / 3);
    assert.ok(oneOfThree!.score > oneOfThree!.coverage, "weighted score still emphasises symbols");
    assert.ok(oneOfThree!.coverage < gateDefaults.lexicalEvidenceThreshold);

    // Body text matches at word starts, so a short term cannot harvest matches from
    // inside unrelated words - but compound identifiers are still split into parts.
    assert.equal(scorer.scoreText("tire", "c2", "the entire file was rewritten"), null);
    assert.equal(scorer.scoreText("card", "c3", "discard the buffer"), null);
    assert.ok(scorer.scoreText("file bytes", "c4", "const maxFileBytes = 1;")?.coverage === 1);
    assert.ok(scorer.scoreText("retriev", "c5", "see the HybridRetriever class")?.coverage === 1);

    const db = new MemoryDatabase(path.join(tempRoot, "database", "memory.db"));
    const now = Date.now();
    db.insertRelation({ id: "trusted", fromId: "a", relation: "imports", toId: "b", source: "a.ts", weight: 1, origin: "observed_ast", admissionStatus: "admitted", createdAt: now });
    db.insertRelation({ id: "predicted", fromId: "a", relation: "imports", toId: "c", source: "model", weight: 1, origin: "model_inferred", admissionStatus: "candidate", modelName: "test", modelChecksum: "a".repeat(64), createdAt: now });
    assert.deepEqual(db.getAllRelations().map((edge) => edge.id), ["trusted"]);
    assert.deepEqual(new Set(db.getAllRelations({ includeInferredRelations: true }).map((edge) => edge.id)), new Set(["trusted", "predicted"]));
    assert.throws(() => db.runInTransaction(() => {
      db.insertRelation({ id: "rolled-back", fromId: "x", relation: "imports", toId: "y", source: "x.ts", weight: 1, origin: "declared", admissionStatus: "admitted", createdAt: now });
      throw new Error("forced failure");
    }), /forced failure/);
    assert.equal(db.getAllRelations({ includeInferredRelations: true }).some((edge) => edge.id === "rolled-back"), false);

    db.upsertMemory({ id: "asset", memoryType: "rule", modality: "text", title: "Rule", content: "Candidate", embeddingModel: "test", embeddingDimension: 2, admissionStatus: "candidate", createdAt: now, updatedAt: now });
    assert.equal(db.updateOperationalAssetAdmission("asset", "admitted", ""), false);
    assert.equal(db.updateOperationalAssetAdmission("asset", "admitted", "reviewer"), true);
    assert.equal(db.updateOperationalAssetAdmission("asset", "admitted", "reviewer"), false);

    const scopedMemory = (id: string, admissionStatus: "admitted" | "candidate" | "quarantined" | "rejected", content: string) => ({
      id,
      memoryType: "rule" as const,
      modality: "text" as const,
      title: id,
      content,
      embedding: new Float32Array([1, 0]),
      embeddingModel: "trust-test",
      embeddingDimension: 2,
      providerType: "local_llama" as const,
      workspace: zeroConfig.workspace,
      project: zeroConfig.projectName,
      admissionStatus,
      createdAt: now,
      updatedAt: now,
    });
    db.upsertMemory(scopedMemory("trusted-memory", "admitted", "safe admitted record"));
    db.upsertMemory(scopedMemory("candidate-memory", "candidate", "candidate semantic poison"));
    db.upsertMemory(scopedMemory("quarantined-memory", "quarantined", "poisonlexical quarantined record"));
    db.upsertMemory(scopedMemory("rejected-memory", "rejected", "poisonlexical rejected record"));
    const trustRetriever = new HybridRetriever(db, {
      providerType: "local_llama",
      modelName: "trust-test",
      dimensions: 2,
      isAvailable: true,
      embedQuery: async () => new Float32Array([1, 0]),
      embedDocument: async () => new Float32Array([1, 0]),
    } as any, { ...zeroConfig, minSimilarityThreshold: 0, defaultResultLimit: 10, candidateLimit: 10 });
    const defaultTrustResults = await trustRetriever.search("poisonlexical", { limit: 10 });
    assert(defaultTrustResults.some((result) => result.id === "trusted-memory"));
    assert.equal(defaultTrustResults.some((result) => ["candidate-memory", "quarantined-memory", "rejected-memory"].includes(result.id)), false);
    const candidateInspection = await trustRetriever.search("poisonlexical", { limit: 10, includeCandidates: true });
    assert(candidateInspection.some((result) => result.id === "candidate-memory"));
    assert.equal(candidateInspection.some((result) => ["quarantined-memory", "rejected-memory"].includes(result.id)), false);
    const quarantineInspection = await trustRetriever.search("poisonlexical", { limit: 10, filterAdmissionStatuses: ["quarantined"] });
    assert.deepEqual(quarantineInspection.filter((result) => result.id !== "DISAMBIGUATION_REQUIRED").map((result) => result.id), ["quarantined-memory"]);
    assert.throws(() => db.consolidateToGlobalHive(), /disabled/);
    db.close();

    const mcp = new MemoryMcpServer({} as any);
    assert.equal((await mcp.processLine("{"))?.error.code, -32700);
    assert.equal((await mcp.handleRequest([]))?.error.code, -32600);
    assert.equal((await mcp.handleRequest({ jsonrpc: "2.0", id: 0, method: "missing" }))?.error.code, -32601);
    assert.equal((await mcp.handleRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "agy_memory_search", arguments: {} } }))?.error.code, -32602);
    assert.equal((await mcp.handleRequest({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "agy_admit_operational_asset", arguments: { assetId: "a", reviewedBy: "r" } } }))?.error.code, -32001);
    assert.equal(await mcp.handleRequest({ jsonrpc: "2.0", method: "tools/list" }), undefined);
    assert.equal((await mcp.handleRequest({ jsonrpc: "2.0", id: 0, method: "tools/list" }))?.id, 0);

    let factoryCalls = 0;
    assert.equal(await runCli(["not-a-command"], () => { factoryCalls += 1; return {} as any; }), 2);
    assert.equal(await runCli(["ingest-image", path.join(tempRoot, "missing.png")], () => { factoryCalls += 1; return {} as any; }), 2);
    assert.equal(await runCli(["serve", "0"], () => { factoryCalls += 1; return {} as any; }), 2);
    assert.equal(await runCli(["system2", "invalid"], () => { factoryCalls += 1; return {} as any; }), 2);
    assert.equal(factoryCalls, 0);

    const fakeUltraPython = path.join(tempRoot, "fake-ultra-python");
    fs.writeFileSync(fakeUltraPython, "#!/bin/sh\nexit 0\n", "utf8");
    fs.chmodSync(fakeUltraPython, 0o755);
    const previousUltraPython = process.env.ULTRA_PYTHON;
    process.env.ULTRA_PYTHON = fakeUltraPython;
    let system2Broadcasts = 0;
    let system2Closes = 0;
    try {
      const system2Exit = await runCli(["system2"], () => ({
        init: async () => undefined,
        close: () => { system2Closes += 1; },
        config: { dbPath: path.join(tempRoot, "system2.db"), workspace: "test", projectName: "test" },
        broadcastGraphUpdate: () => { system2Broadcasts += 1; },
      } as any));
      assert.equal(system2Exit, 0);
      assert.equal(system2Broadcasts, 1);
      assert.equal(system2Closes, 1);
    } finally {
      if (previousUltraPython === undefined) delete process.env.ULTRA_PYTHON;
      else process.env.ULTRA_PYTHON = previousUltraPython;
    }

    const dashboardEngine = {
      getLegacyEvidenceReferences: () => [{
        id: "<script>alert(1)</script>", incidentType: "<img src=x onerror=alert(1)>",
        targetFramework: "test", createdAt: now, evidenceStatus: "unverified_legacy",
      }],
    } as any;
    const dashboard = serveWebDashboard(dashboardEngine, 0);
    const dashboardAddress = await dashboard.ready;
    const address = dashboard.server.address();
    assert(address && typeof address === "object");
    assert.equal(dashboardAddress.port, address.port);
    assert.equal(dashboardAddress.origin, `http://127.0.0.1:${address.port}`);
    const page = await getPage(address.port);
    assert.match(page.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(page.body, /<script>alert\(1\)<\/script>/);
    assert.match(String(page.headers["content-security-policy"]), /default-src 'self'/);
    await dashboard.close();
    await dashboard.close();

    const occupiedServer = http.createServer();
    await new Promise<void>((resolve, reject) => {
      occupiedServer.once("error", reject);
      occupiedServer.listen(0, "127.0.0.1", resolve);
    });
    const occupiedAddress = occupiedServer.address();
    assert(occupiedAddress && typeof occupiedAddress === "object");
    let occupiedEngineCloseCount = 0;
    const occupiedExit = await runCli(["serve", String(occupiedAddress.port)], () => ({
      init: async () => undefined,
      close: () => { occupiedEngineCloseCount += 1; },
      getLegacyEvidenceReferences: () => [],
    } as any));
    assert.equal(occupiedExit, 1);
    assert.equal(occupiedEngineCloseCount, 1);
    await new Promise<void>((resolve, reject) => occupiedServer.close((error) => error ? reject(error) : resolve()));

    const renderer = new ThreeJSGraphRenderer();
    const graphData = {
      nodes: [{ id: "</script><script>alert(1)</script>", name: "node", type: "custom<type>", description: "unsafe" }],
      edges: [],
    };
    const graphOne = path.join(tempRoot, "graph-one.html");
    const graphTwo = path.join(tempRoot, "graph-two.html");
    renderer.generateHtml(graphData, graphOne, "<Graph>");
    renderer.generateHtml(graphData, graphTwo, "<Graph>");
    const graphHtmlOne = fs.readFileSync(graphOne, "utf8");
    const graphHtmlTwo = fs.readFileSync(graphTwo, "utf8");
    assert.equal(graphHtmlOne, graphHtmlTwo);
    assert.match(graphHtmlOne, /&lt;Graph&gt;/);
    assert.match(graphHtmlOne, /\\u003c\/script\\u003e/);
    assert.doesNotMatch(graphHtmlOne, /<script>alert\(1\)<\/script>/);

    console.log("production regressions: pass");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
