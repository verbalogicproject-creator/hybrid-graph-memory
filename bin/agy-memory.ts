#!/usr/bin/env node

import prompts from "prompts";
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

async function handleInteractiveMenu(engine: MemoryEngine) {
  printBanner();

  let keepRunning = true;

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
        { title: "🎛️ [ Dashboard (Causal Memory & Receipts) ]", value: "dashboard" },
        { title: "🌐 [ Serve Visual Web Timeline ]", value: "serve" },
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

      case "dashboard": {
        await runDashboard(engine);
        break;
      }

      case "serve": {
        serveWebDashboard(engine);
        break;
      }
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const engine = new MemoryEngine();
  await engine.init();

  try {
    if (!command) {
      await handleInteractiveMenu(engine);
      return;
    }

    switch (command) {
      case "search": {
        const query = args.slice(1).join(" ");
        if (!query) {
          console.error("Please provide a search query.");
          process.exit(1);
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
          process.exit(1);
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
          process.exit(1);
        }
        const title = text.slice(0, 50);
        const id = await engine.ingestText(text, title);
        console.log(`✅ Successfully ingested text memory: ${id}`);
        break;
      }

      case "ingest-image": {
        const imgPathOrB64 = args[1];
        const caption = args.slice(2).join(" ") || "Visual Screenshot";
        if (!imgPathOrB64) {
          console.error("Usage: agy-memory ingest-image <image_path_or_b64> [caption]");
          process.exit(1);
        }
        let b64 = imgPathOrB64;
        if (require("fs").existsSync(imgPathOrB64)) {
          b64 = require("fs").readFileSync(imgPathOrB64).toString("base64");
        }
        const id = await engine.ingestImage(b64, caption);
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

      case "serve": {
        serveWebDashboard(engine);
        await new Promise(() => {}); // keep process alive
        break;
      }

      default: {
        console.log(`
Antigravity Memory OS — Standalone CLI
Usage:
  npm run memory                  Launch interactive TUI menu
  npm run memory -- search <q>    Perform hybrid vector + BM25 + GraphRAG search
  npm run memory -- rag <prompt>  Generate local on-device RAG answer (Qwen/Phi-4/Llama/Gemma)
  npm run memory -- index         Incrementally index current repository workspace
  npm run memory -- ingest-text   Ingest a text/markdown memory record
  npm run memory -- ingest-image  Ingest a screenshot image vector
  npm run memory -- stats         Display database statistics
  npm run memory -- graph         List architectural GraphRAG relation edges
  npm run memory -- map:ast       Generate AST GraphRAG relations
`);
      }
    }
  } finally {
    engine.close();
  }
}

main().catch((err) => {
  console.error("CLI Error:", err.message);
  process.exit(1);
});
