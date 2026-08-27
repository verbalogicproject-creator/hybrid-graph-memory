import readline from "node:readline";
import { MemoryEngine } from "../core/engine";

export interface MemoryMcpServerOptions {
  /** Local-only escape hatch. The default server exposes a read-only boundary. */
  mutationMode?: boolean;
}

export class MemoryMcpServer {
  private engine: MemoryEngine;
  private rl: readline.Interface;
  private mutationMode: boolean;

  constructor(engine?: MemoryEngine, options: MemoryMcpServerOptions | boolean = {}) {
    this.engine = engine || new MemoryEngine();
    this.mutationMode =
      typeof options === "boolean" ? options : options.mutationMode === true;
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
              description: "Retrieve an operational asset (prompt, workflow, skill, or rule) with full trust, targeting, provenance, and staleness metadata by its trigger tag",
              inputSchema: {
                type: "object",
                properties: {
                  triggerTag: { type: "string", description: "Trigger tag (e.g. '@commit', 'deploy_flow', 'code_review_prompt')" },
                  includeCandidates: { type: "boolean", description: "Whether to include unadmitted candidate assets (default: false)" },
                },
                required: ["triggerTag"],
              },
            },
            {
              name: "agy_ingest_operational_asset",
              description: "[LOCAL MUTATION MODE REQUIRED] Propose an operational asset as a candidate; model output is never admitted automatically",
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
                  targetFramework: {
                    type: "string",
                    description: "Target framework/language/runtime (e.g. 'next@15.x', 'react@19.x', 'stripe-node@17.x')",
                  },
                  author: {
                    type: "string",
                    description: "Author / creator (e.g. 'developer', 'architect', 'evidence_gate')",
                  },
                  sourceDoc: { type: "string", description: "Optional source document filepath" },
                  commitHash: { type: "string", description: "Optional source commit hash" },
                  workflowSteps: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        order: { type: "number" },
                        action: { type: "string" },
                        requiredTools: { type: "array", items: { type: "string" } },
                        description: { type: "string" },
                      },
                      required: ["order", "action"],
                    },
                    description: "Ordered steps for workflow assets (Required for workflow)",
                  },
                  promptVariables: {
                    type: "array",
                    items: { type: "string" },
                    description: "Template variables for prompt assets (Required for prompt)",
                  },
                  promptOutputShape: {
                    type: "string",
                    description: "Expected output format/schema for prompt assets (Required for prompt)",
                  },
                },
                required: ["type", "title", "content", "triggerTags", "targetFramework", "author"],
              },
            },
            {
              name: "agy_admit_operational_asset",
              description: "[LOCAL MUTATION MODE REQUIRED] Manually admit a candidate after local review",
              inputSchema: {
                type: "object",
                properties: {
                  assetId: { type: "string", description: "Asset ID to admit" },
                  reviewedBy: { type: "string", description: "Reviewer identifier" },
                  notes: { type: "string", description: "Optional review notes" },
                },
                required: ["assetId", "reviewedBy"],
              },
            },
            {
              name: "agy_quarantine_operational_asset",
              description: "[LOCAL MUTATION MODE REQUIRED] Quarantine or reject an operational asset after local review",
              inputSchema: {
                type: "object",
                properties: {
                  assetId: { type: "string", description: "Asset ID to quarantine or reject" },
                  reason: { type: "string", description: "Reason for quarantine or rejection" },
                  reviewedBy: { type: "string", description: "Reviewer identifier" },
                  status: {
                    type: "string",
                    enum: ["quarantined", "rejected"],
                    description: "Disposition status (default: 'quarantined')",
                  },
                },
                required: ["assetId", "reason", "reviewedBy"],
              },
            },
            {
              name: "agy_list_operational_assets",
              description: "List operational assets with optional status and workspace filtering",
              inputSchema: {
                type: "object",
                properties: {
                  status: {
                    type: "string",
                    enum: ["candidate", "admitted", "quarantined", "rejected"],
                    description: "Optional admission status filter",
                  },
                  workspace: { type: "string", description: "Optional workspace filter" },
                },
              },
            },
            {
              name: "agy_memory_receipts",
              description: "Read unverified legacy evidence references. These are local memory references, not SAG receipts or evidence levels.",
              inputSchema: {
                type: "object",
                properties: {
                  incidentType: { type: "string", description: "Optional incident type to filter" }
                }
              }
            }
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

      if (name === "agy_memory_receipts") {
        const incidentType = args.incidentType;
        const references = this.engine.getLegacyEvidenceReferences(incidentType);
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(references, null, 2) }] } };
      }

      if (name === "agy_load_operational_asset") {
        const asset = await this.engine.getOperationalAssetByTrigger(args.triggerTag, {
          includeCandidates: args.includeCandidates,
        });
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: asset ? JSON.stringify(asset, null, 2) : "null" }],
            found: !!asset,
            asset,
          },
        };
      }

      if (name === "agy_ingest_operational_asset") {
        if (!this.mutationMode) {
          return { jsonrpc: "2.0", id, error: { code: -32600, message: "Mutation operations are disabled in read-only mode" } };
        }
        try {
          const assetId = await this.engine.ingestOperationalAsset({
            type: args.type,
            title: args.title,
            content: args.content,
            triggerTags: args.triggerTags,
            targetFramework: args.targetFramework,
            author: args.author,
            sourceDoc: args.sourceDoc,
            commitHash: args.commitHash,
            workflowSteps: args.workflowSteps,
            promptVariables: args.promptVariables,
            promptOutputShape: args.promptOutputShape,
            modelProposed: true,
          });
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: `Operational asset ingested as candidate: ${assetId}` }],
              assetId,
              status: "candidate",
            },
          };
        } catch (err: any) {
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32602,
              message: err.message,
              data: {
                missingFields: err.missingFields,
                invalidFields: err.invalidFields,
              },
            },
          };
        }
      }

      if (name === "agy_admit_operational_asset") {
        if (!this.mutationMode) {
          return { jsonrpc: "2.0", id, error: { code: -32600, message: "Mutation operations are disabled in read-only mode" } };
        }
        const success = await this.engine.admitOperationalAsset(
          args.assetId,
          args.reviewedBy,
          args.notes
        );
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: success
                  ? `Asset '${args.assetId}' promoted to ADMITTED by ${args.reviewedBy}`
                  : `Failed to admit asset '${args.assetId}'`,
              },
            ],
            success,
          },
        };
      }

      if (name === "agy_quarantine_operational_asset") {
        if (!this.mutationMode) {
          return { jsonrpc: "2.0", id, error: { code: -32600, message: "Mutation operations are disabled in read-only mode" } };
        }
        const isReject = args.status === "rejected";
        const success = isReject
          ? await this.engine.rejectOperationalAsset(args.assetId, args.reason, args.reviewedBy)
          : await this.engine.quarantineOperationalAsset(args.assetId, args.reason, args.reviewedBy);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: success
                  ? `Asset '${args.assetId}' status updated to ${isReject ? "REJECTED" : "QUARANTINED"}: ${args.reason}`
                  : `Failed to update status for asset '${args.assetId}'`,
              },
            ],
            success,
          },
        };
      }

      if (name === "agy_list_operational_assets") {
        const assets = await this.engine.listOperationalAssets({
          status: args.status,
          workspace: args.workspace,
        });
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(assets, null, 2) }],
            count: assets.length,
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
