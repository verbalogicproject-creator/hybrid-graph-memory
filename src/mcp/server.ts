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

  public async start() {
    await this.engine.init();
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
            {
              name: "agy_load_operational_asset",
              description: "Retrieve an operational asset (prompt, workflow, skill, or rule) by its trigger tag or query (Retrieval only — state tracking managed by agent)",
              inputSchema: {
                type: "object",
                properties: {
                  triggerTag: { type: "string", description: "Trigger tag (e.g. 'deploy_flow', 'code_review_prompt')" },
                  assetType: {
                    type: "string",
                    enum: ["prompt", "workflow", "skill", "rule"],
                    description: "Optional asset type filter",
                  },
                },
                required: ["triggerTag"],
              },
            },
            {
              name: "agy_ingest_operational_asset",
              description: "Ingest a prompt, workflow, skill, or rule operational asset with exact trigger tags",
              inputSchema: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    enum: ["prompt", "workflow", "skill", "rule"],
                    description: "Type of operational asset",
                  },
                  title: { type: "string", description: "Title / Name of the operational asset" },
                  content: { type: "string", description: "Prompt markdown or workflow procedure specification" },
                  triggerTags: {
                    type: "array",
                    items: { type: "string" },
                    description: "Exact trigger tags (e.g. ['@deploy', 'release_checklist'])",
                  },
                },
                required: ["type", "title", "content"],
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

      if (name === "agy_load_operational_asset") {
        const asset = await this.engine.getOperationalAssetByTrigger(args.triggerTag);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: asset ? JSON.stringify(asset, null, 2) : "null" }],
            found: !!asset,
          },
        };
      }

      if (name === "agy_ingest_operational_asset") {
        const assetId = await this.engine.ingestOperationalAsset({
          type: args.type,
          title: args.title,
          content: args.content,
          triggerTags: args.triggerTags,
        });
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `Operational asset ingested successfully: ${assetId}` }],
            assetId,
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
