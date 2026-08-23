import readline from "node:readline";
import { MemoryEngine } from "../core/engine";

export class MemoryMcpServer {
  private engine: MemoryEngine;
  private rl: readline.Interface;

  constructor() {
    this.engine = new MemoryEngine();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });
  }

  public start() {
    this.rl.on("line", async (line) => {
      if (!line.trim()) return;

      try {
        const request = JSON.parse(line);
        const response = await this.handleRequest(request);
        process.stdout.write(JSON.stringify(response) + "\n");
      } catch (err: any) {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: err.message },
          }) + "\n"
        );
      }
    });
  }

  private async handleRequest(req: any): Promise<any> {
    const { id, method, params } = req;

    if (method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "agy_memory_search",
              description: "Perform hybrid semantic, lexical, and GraphRAG search over the codebase memory",
              inputSchema: {
                type: "object",
                properties: {
                  query: { type: "string", description: "Search query" },
                  limit: { type: "number", description: "Maximum chunks to return" },
                  intent: { type: "string", description: "Optional retrieval intent" },
                },
                required: ["query"],
              },
            },
            {
              name: "agy_local_rag_generate",
              description: "Generate an end-to-end grounded answer using local on-device LLM (Qwen / Phi-4 / Llama-3.2 / Gemma-4)",
              inputSchema: {
                type: "object",
                properties: {
                  prompt: { type: "string", description: "User question/prompt" },
                  model: { type: "string", description: "Target local model name" },
                },
                required: ["prompt"],
              },
            },
            {
              name: "agy_graph_inspect",
              description: "Inspect GraphRAG architectural relations",
              inputSchema: {
                type: "object",
                properties: {
                  nodeId: { type: "string", description: "Optional component name to filter edges" },
                },
              },
            },
          ],
        },
      };
    }

    if (method === "tools/call") {
      const { name, arguments: args } = params;

      if (name === "agy_memory_search") {
        const results = await this.engine.search(args.query, {
          limit: args.limit || 5,
          intent: args.intent,
        });
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          },
        };
      }

      if (name === "agy_local_rag_generate") {
        const ragRes = await this.engine.generateRAGAnswer(args.prompt, args.model);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: ragRes.answer }],
            modelUsed: ragRes.modelUsed,
          },
        };
      }

      if (name === "agy_graph_inspect") {
        const rels = this.engine.getAllRelations();
        const filtered = args?.nodeId
          ? rels.filter((r) => r.fromId === args.nodeId || r.toId === args.nodeId)
          : rels;
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }],
          },
        };
      }
    }

    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }
}

if (require.main === module) {
  const server = new MemoryMcpServer();
  server.start();
}
