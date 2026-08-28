#!/usr/bin/env node

import prompts from "prompts";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { MemoryEngine } from "../src/core/engine";
import { AstDependencyMapper } from "../src/ast/mapper";
import { runDoctor } from "../src/cli/doctor";
import { runDashboard } from "../src/cli/dashboard";
import { serveWebDashboard } from "../src/server/web_dashboard";

function printBanner() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║         🌌 ANTIGRAVITY MEMORY OS — STANDALONE CLI                 ║
║   Pure JS Cosine • On-Device Llama.cpp RAG • Multi-Project Hive   ║
╚═══════════════════════════════════════════════════════════════════╝
`);
}

function resolveUltraPython(): string {
  const configured = process.env.ULTRA_PYTHON?.trim();
  if (configured) return configured;
  const isolated = "/root/.local/share/hybrid-graph-memory/ultra-venv/bin/python";
  return fs.existsSync(isolated) ? isolated : "python3";
}

function resolveUltraBridgePath(): string {
  const candidates = [
    path.resolve(__dirname, "../src/python/ultra_bridge.py"),
    path.resolve(__dirname, "../../src/python/ultra_bridge.py"),
  ];
  const bridge = candidates.find((candidate) => fs.existsSync(candidate));
  if (!bridge) throw new Error("Packaged ULTRA bridge not found");
  return bridge;
}

function runSystem2Worker(engine?: MemoryEngine, checkOnly = false): number {
  const python = resolveUltraPython();
  const args = [resolveUltraBridgePath()];
  if (checkOnly) {
    args.push("--check");
  } else {
    const config = (engine as any).config;
    args.push(
      "--db", config.dbPath,
      "--workspace", config.workspace,
      "--project", config.projectName,
    );
  }
  const optional = [
    ["--model-path", process.env.ULTRA_MODEL_PATH],
    ["--model-version", process.env.ULTRA_MODEL_VERSION],
    ["--model-checksum", process.env.ULTRA_MODEL_SHA256],
  ] as const;
  for (const [flag, value] of optional) {
    if (value?.trim()) args.push(flag, value.trim());
  }
  const result = spawnSync(python, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  const status = result.status ?? 1;
  if (status === 0 && !checkOnly) (engine as any).broadcastGraphUpdate?.();
  return status;
}

async function handleInteractiveMenu(engine: MemoryEngine) {
  printBanner();

  let keepRunning = true;
  let dashboardHandle: ReturnType<typeof serveWebDashboard> | undefined;

  try {
  while (keepRunning) {
    const response = await prompts({
      type: "select",
      name: "action",
      message: "Select Memory OS Operation:",
      choices: [
        { title: "🔍 [ Search Memory ]", value: "search" },
        { title: "🤖 [ Local On-Device RAG Answer ]", value: "rag" },
        { title: "⚡ [ Incremental Index Workspace ]", value: "index" },
        { title: "📝 [ Ingest Session / Note ]", value: "ingest-text" },
        { title: "🕸️ [ Graph Inspector ]", value: "graph" },
        { title: "📊 [ Memory Database Statistics ]", value: "stats" },
        { title: "🗺️ [ Generate AST Relations (.ctx) ]", value: "map:ast" },
        { title: "🩺 [ Memory Doctor (Ripple Decay Review) ]", value: "doctor" },
        { title: "🧠 [ System 2 Worker (ULTRA Bridge) ]", value: "system2" },
        { title: "🎛️ [ Dashboard (Causal Memory & Receipts) ]", value: "dashboard" },
        { title: "🌐 [ Serve Visual Web Timeline ]", value: "serve" },
        { title: "🌌 [ Export 3D Visual Graph ]", value: "visualize" },
        { title: "🚪 [ Exit ]", value: "exit" },
      ],
      initial: 0,
    });

    if (!response.action || response.action === "exit") {
      keepRunning = false;
      console.log("\n👋 Exiting Antigravity Memory OS. Goodbye!");
      break;
    }

    console.log("");

    switch (response.action) {
      case "search": {
        const p = await prompts({
          type: "text",
          name: "query",
          message: "Enter Search Query:",
          validate: (v) => (v.trim().length > 0 ? true : "Query cannot be empty"),
        });

        if (p.query) {
          console.log(`\n🔎 Searching memory for: "${p.query}"...\n`);
          const results = await engine.search(p.query, { limit: 5 });
          if (results.length === 0) {
            console.log("No matching memory chunks found.\n");
          } else {
            results.forEach((r, i) => {
              console.log(`[${i + 1}] ${r.symbol || r.heading || r.filepath || r.id}`);
              console.log(`    Source: ${r.filepath || r.sourceType} | Score: ${(r.finalScore).toFixed(4)}`);
              console.log(`    Reason: ${r.reason}`);
              console.log(`    Preview:\n${r.content.slice(0, 200)}...\n`);
            });
          }
        }
        break;
      }

      case "rag": {
        const p = await prompts({
          type: "text",
          name: "prompt",
          message: "Enter Question for Local LLM (Qwen / Phi-4 / Llama / Gemma):",
          validate: (v) => (v.trim().length > 0 ? true : "Prompt cannot be empty"),
        });

        if (p.prompt) {
          console.log(`\n🤖 Executing Local On-Device RAG Generation...\n`);
          try {
            const res = await engine.generateRAGAnswer(p.prompt);
            console.log(`🧠 Local Model Used: ${res.modelUsed}\n`);
            console.log(`📝 Generated Answer:\n${res.answer}\n`);
            console.log(`📚 Referenced ${res.contexts.length} Grounded Context Chunks.\n`);
          } catch (err: any) {
            console.error(`❌ Local RAG generation failed: ${err.message}\n`);
          }
        }
        break;
      }

      case "index": {
        console.log("🧠 Starting Incremental Indexing for Project Memory Engine...\n");
        const res = await engine.index((status) => {
          if (status.file) {
            process.stdout.write(`\r[${status.current}/${status.total}] ${status.file.slice(0, 45).padEnd(45)} `);
          }
        });
        console.log(`\n\n✅ Indexing complete: ${res.indexed} indexed, ${res.unchanged} unchanged, ${res.deleted} deleted. Total chunks: ${res.totalChunks}\n`);
        break;
      }

      case "ingest-text": {
        const p = await prompts([
          {
            type: "text",
            name: "title",
            message: "Enter Memory Title:",
            validate: (v) => (v.trim().length > 0 ? true : "Title cannot be empty"),
          },
          {
            type: "text",
            name: "content",
            message: "Enter Memory Content / Note:",
            validate: (v) => (v.trim().length > 0 ? true : "Content cannot be empty"),
          },
        ]);

        if (p.title && p.content) {
          const id = await engine.ingestText(p.content, p.title);
          console.log(`\n✅ Successfully ingested text memory into SQLite: ${id}\n`);
        }
        break;
      }

      case "graph": {
        const rels = engine.getAllRelations();
        console.log(`\n🕸️ Active Architectural Graph Relations (${rels.length} edges):`);
        rels.forEach((r) => {
          console.log(`  • ${r.fromId} --(${r.relation})--> ${r.toId} [Weight: ${r.weight.toFixed(1)}]`);
        });
        console.log("");
        break;
      }

      case "stats": {
        const stats = engine.getStats();
        console.log("\n📊 Local Multimodal Project Memory Statistics:");
        console.log(`   - Indexed Files:           ${stats.filesCount}`);
        console.log(`   - Semantic Chunks:         ${stats.chunksCount}`);
        console.log(`   - Experiential Memories:   ${stats.memoriesCount}`);
        console.log(`   - Architectural Relations: ${stats.relationsCount}`);
        console.log(`   - SQLite Database Size:    ${(stats.dbSizeBytes / (1024 * 1024)).toFixed(2)} MB\n`);
        break;
      }

      case "map:ast": {
        console.log("🔍 Scanning Next.js / TypeScript AST dependencies...\n");
        const mapper = new AstDependencyMapper();
        const content = mapper.generateCtxContent();
        console.log(content);
        break;
      }

      case "doctor": {
        await runDoctor(engine);
        break;
      }

      case "system2": {
        console.log("\n🧠 Launching System 2 ULTRA Worker...");
        const status = runSystem2Worker(engine);
        if (status !== 0) console.error("System 2 process exited with error.");
        break;
      }

      case "dashboard": {
        await runDashboard(engine);
        break;
      }

      case "serve": {
        if (dashboardHandle) {
          console.log("The web dashboard is already running.");
        } else {
          dashboardHandle = serveWebDashboard(engine);
          await dashboardHandle.ready;
        }
        break;
      }

      case "visualize": {
        const { GraphExporter } = require("../src/visualization/exporter");
        const exporter = new GraphExporter(engine);
        const ts = new Date().toISOString().replace(/[:.]/g, "-"); const outputPath = require("path").resolve(process.cwd(), `graph_3d_${ts}.html`);
        console.log(`\n🌌 Exporting 3D Graph Visualization to ${outputPath}...\n`);
        await exporter.exportToHtml(outputPath);
        console.log(`✅ Visualization exported successfully. Open file://${outputPath} in your browser.\n`);
        break;
      }
    }
  }
  } finally {
    await dashboardHandle?.close();
  }
}

const KNOWN_COMMANDS = new Set([
  "search", "rag", "index", "ingest-text", "ingest-image", "graph", "stats",
  "map:ast", "doctor", "dashboard", "serve", "visualize", "system2",
]);

function printUsage() {
  console.log(`
Antigravity Memory OS — Standalone CLI
Usage:
  agy-memory                         Launch interactive TUI menu
  agy-memory search <q>              Perform hybrid vector + BM25 + GraphRAG search
  agy-memory rag <prompt>            Generate a local RAG answer
  agy-memory index                   Incrementally index the current workspace
  agy-memory ingest-text <text>      Ingest a text memory
  agy-memory ingest-image <path>     Ingest a PNG, JPEG, or WebP file
  agy-memory stats                   Display database statistics
  agy-memory graph                   List admitted observed/declared graph edges
  agy-memory map:ast                 Generate AST relations
  agy-memory system2 [--check]       Run or validate the review-gated ULTRA worker
  agy-memory visualize               Export a 3D HTML graph visualization
  agy-memory serve [port]            Serve the loopback-only web dashboard
`);
}

function readSupportedImage(imagePath: string): string {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(imagePath);
  } catch {
    throw new Error(`Image path does not exist: ${imagePath}`);
  }
  if (!stat.isFile()) throw new Error(`Image path is not a regular file: ${imagePath}`);
  const maxImageBytes = 20 * 1024 * 1024;
  if (stat.size <= 0 || stat.size > maxImageBytes) {
    throw new Error(`Image must be between 1 byte and ${maxImageBytes} bytes.`);
  }
  const bytes = fs.readFileSync(imagePath);
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp = bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (!isPng && !isJpeg && !isWebp) {
    throw new Error("Unsupported image format. Expected a PNG, JPEG, or WebP file.");
  }
  return bytes.toString("base64");
}

async function waitForTerminationSignal(): Promise<void> {
  await new Promise<void>((resolve) => {
    const done = () => {
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
      resolve();
    };
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}

export async function runCli(
  args = process.argv.slice(2),
  engineFactory: () => MemoryEngine = () => new MemoryEngine()
): Promise<number> {
  const command = args[0];

  if (command === "help" || command === "--help" || command === "-h") {
    printUsage();
    return 0;
  }
  if (command && !KNOWN_COMMANDS.has(command)) {
    console.error(`Unknown command: ${command}`);
    printUsage();
    return 2;
  }

  let validatedImageBase64: string | undefined;
  let dashboardPort = 3000;
  if (command === "ingest-image") {
    if (!args[1]) {
      console.error("Usage: agy-memory ingest-image <image_path> [caption]");
      return 2;
    }
    try {
      validatedImageBase64 = readSupportedImage(args[1]);
    } catch (error: any) {
      console.error(error.message);
      return 2;
    }
  }
  if (command === "serve" && args[1] !== undefined) {
    dashboardPort = Number(args[1]);
    if (args.length > 2 || !Number.isInteger(dashboardPort) || dashboardPort < 1 || dashboardPort > 65535) {
      console.error("Usage: agy-memory serve [port 1-65535]");
      return 2;
    }
  }
  if (command === "system2") {
    if (args.length > 2 || (args[1] !== undefined && args[1] !== "--check")) {
      console.error("Usage: agy-memory system2 [--check]");
      return 2;
    }
    if (args[1] === "--check") return runSystem2Worker(undefined, true);
  }

  const engine = engineFactory();
  let dashboardHandle: ReturnType<typeof serveWebDashboard> | undefined;

  try {
    await engine.init();
    if (!command) {
      await handleInteractiveMenu(engine);
      return 0;
    }

    switch (command) {
      case "search": {
        const query = args.slice(1).join(" ");
        if (!query) {
          console.error("Please provide a search query.");
          return 2;
        }
        console.log(`\n🔍 Searching memory for: "${query}"...\n`);
        const results = await engine.search(query, { limit: 5 });
        if (results.length === 0) {
          console.log("No matching memory chunks found.");
        } else {
          results.forEach((r, i) => {
            console.log(`[${i + 1}] ${r.symbol || r.heading || r.filepath || r.id}`);
            console.log(`    Source: ${r.filepath || r.sourceType} | Score: ${(r.finalScore).toFixed(4)}`);
            console.log(`    Reason: ${r.reason}`);
            console.log(`    Preview:\n${r.content.slice(0, 200)}...\n`);
          });
        }
        break;
      }

      case "rag": {
        const prompt = args.slice(1).join(" ");
        if (!prompt) {
          console.error("Please provide a prompt for local RAG generation.");
          return 2;
        }
        console.log(`\n🤖 Executing Local On-Device RAG Generation for: "${prompt}"...\n`);
        const res = await engine.generateRAGAnswer(prompt);
        console.log(`🧠 Local Model Used: ${res.modelUsed}\n`);
        console.log(`📝 Generated Answer:\n${res.answer}\n`);
        console.log(`📚 Referenced ${res.contexts.length} Grounded Context Chunks.`);
        break;
      }

      case "index": {
        console.log("🧠 Starting Incremental Indexing for Project Memory Engine...\n");
        const res = await engine.index((status) => {
          if (status.file) {
            process.stdout.write(`\r[${status.current}/${status.total}] ${status.file.slice(0, 45).padEnd(45)} `);
          }
        });
        console.log(`\n\n✅ Indexing complete: ${res.indexed} indexed, ${res.unchanged} unchanged, ${res.deleted} deleted. Total chunks: ${res.totalChunks}`);
        break;
      }

      case "ingest-text": {
        const text = args.slice(1).join(" ");
        if (!text) {
          console.error("Please provide text to ingest.");
          return 2;
        }
        const title = text.slice(0, 50);
        const id = await engine.ingestText(text, title);
        console.log(`✅ Successfully ingested text memory: ${id}`);
        break;
      }

      case "ingest-image": {
        const caption = args.slice(2).join(" ") || "Visual Screenshot";
        const id = await engine.ingestImage(validatedImageBase64!, caption);
        console.log(`✅ Successfully ingested image memory: ${id}`);
        break;
      }

      case "graph": {
        const rels = engine.getAllRelations();
        console.log(`\n🕸️ Active Architectural Graph Relations (${rels.length} edges):`);
        rels.forEach((r) => {
          console.log(`  • ${r.fromId} --(${r.relation})--> ${r.toId} [Weight: ${r.weight.toFixed(1)}]`);
        });
        break;
      }

      case "stats": {
        const stats = engine.getStats();
        console.log("\n📊 Antigravity Memory OS Statistics:");
        console.log(`   - Indexed Files:         ${stats.filesCount}`);
        console.log(`   - Semantic Chunks:       ${stats.chunksCount}`);
        console.log(`   - Experiential Memories: ${stats.memoriesCount}`);
        console.log(`   - Graph Relations:       ${stats.relationsCount}`);
        console.log(`   - Database Size:         ${(stats.dbSizeBytes / (1024 * 1024)).toFixed(2)} MB\n`);
        break;
      }

      case "map:ast": {
        const mapper = new AstDependencyMapper();
        const content = mapper.generateCtxContent();
        console.log(content);
        break;
      }

      case "doctor": {
        await runDoctor(engine);
        break;
      }

      case "dashboard": {
        await runDashboard(engine);
        break;
      }

      case "system2": {
        const status = runSystem2Worker(engine);
        if (status !== 0) return status;
        break;
      }

      case "serve": {
        dashboardHandle = serveWebDashboard(engine, dashboardPort);
        await dashboardHandle.ready;
        await waitForTerminationSignal();
        break;
      }

      case "visualize": {
        const { GraphExporter } = require("../src/visualization/exporter");
        const exporter = new GraphExporter(engine);
        const ts = new Date().toISOString().replace(/[:.]/g, "-"); const outputPath = require("path").resolve(process.cwd(), `graph_3d_${ts}.html`);
        console.log(`\n🌌 Exporting 3D Graph Visualization to ${outputPath}...\n`);
        await exporter.exportToHtml(outputPath);
        console.log(`✅ Visualization exported successfully. Open file://${outputPath} in your browser.\n`);
        break;
      }

    }
    return 0;
  } catch (error: any) {
    console.error("CLI Error:", error?.message || String(error));
    return 1;
  } finally {
    await dashboardHandle?.close();
    engine.close();
  }
}

if (require.main === module) {
  runCli().then((code) => {
    process.exitCode = code;
  });
}
