#!/usr/bin/env node

import { MemoryEngine } from "../src/core/engine";
import { AstDependencyMapper } from "../src/ast/mapper";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const engine = new MemoryEngine();

  try {
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

      default: {
        console.log(`
Antigravity Memory OS — Standalone CLI
Usage:
  agy-memory search <query>       Perform hybrid vector + BM25 + GraphRAG search
  agy-memory rag <prompt>         Generate local on-device RAG answer (Qwen/Phi-4/Llama/Gemma)
  agy-memory ingest-text <text>   Ingest a text/markdown memory record
  agy-memory stats                Display database statistics
  agy-memory map:ast              Generate AST GraphRAG relations
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
