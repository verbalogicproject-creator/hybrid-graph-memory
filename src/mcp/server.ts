import readline from "node:readline";
import { MemoryEngine } from "../core/engine";

export interface MemoryMcpServerOptions {
  /** Local-only escape hatch. Default mode blocks content/admin mutations; reads update access telemetry. */
  mutationMode?: boolean;
}

export class MemoryMcpServer {
  private engine: MemoryEngine;
  private rl?: readline.Interface;
  private mutationMode: boolean;

  constructor(engine?: MemoryEngine, options: MemoryMcpServerOptions | boolean = {}) {
    this.engine = engine || new MemoryEngine();
    this.mutationMode =
      typeof options === "boolean" ? options : options.mutationMode === true;
  }

  public async start() {
    await this.engine.init();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });
    this.rl.on("line", async (line) => {
      if (!line.trim()) return;
      const response = await this.processLine(line);
      if (response !== undefined) {
        process.stdout.write(JSON.stringify(response) + "\n");
      }
    });
  }

  public async processLine(line: string): Promise<any | undefined> {
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch {
      return this.error(null, -32700, "Parse error");
    }
    return this.handleRequest(request);
  }

  public async handleRequest(request: unknown): Promise<any | undefined> {
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      return this.error(null, -32600, "Invalid Request");
    }
    const req = request as Record<string, unknown>;
    const hasId = Object.prototype.hasOwnProperty.call(req, "id");
    const id = hasId && (typeof req.id === "string" || typeof req.id === "number" || req.id === null)
      ? req.id
      : null;
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string" || (hasId && id === null && req.id !== null)) {
      return this.error(null, -32600, "Invalid Request");
    }
    try {
      const response = await this.dispatchValidated(req as any);
      return hasId ? response : undefined;
    } catch {
      return hasId ? this.error(id, -32603, "Internal error") : undefined;
    }
  }

  private error(id: unknown, code: number, message: string, data?: unknown) {
    return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
  }

  private invalidParams(id: unknown, message: string) {
    return this.error(id, -32602, message);
  }

  private validateToolArguments(name: string, args: unknown): string | undefined {
    if (!args || typeof args !== "object" || Array.isArray(args)) return "Tool arguments must be an object";
    const value = args as Record<string, unknown>;
    const nonblank = (key: string) => typeof value[key] === "string" && (value[key] as string).trim().length > 0;
    const optionalString = (key: string) => value[key] === undefined || typeof value[key] === "string";
    switch (name) {
      case "agy_memory_search":
        if (!nonblank("query")) return "query must be a non-empty string";
        if (value.limit !== undefined && (!Number.isInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > 100)) return "limit must be an integer from 1 to 100";
        if (!optionalString("intent")) return "intent must be a string";
        return;
      case "agy_local_rag_generate":
        if (!nonblank("prompt")) return "prompt must be a non-empty string";
        if (!optionalString("model")) return "model must be a string";
        return;
      case "agy_graph_inspect":
        return optionalString("nodeId") ? undefined : "nodeId must be a string";
      case "agy_memory_receipts":
        return optionalString("incidentType") ? undefined : "incidentType must be a string";
      case "agy_load_operational_asset":
        if (!nonblank("triggerTag")) return "triggerTag must be a non-empty string";
        if (value.includeCandidates !== undefined && typeof value.includeCandidates !== "boolean") return "includeCandidates must be a boolean";
        return;
      case "agy_ingest_operational_asset": {
        if (!["prompt", "workflow", "skill", "rule"].includes(String(value.type))) return "type is invalid";
        for (const key of ["title", "content", "targetFramework", "author"]) if (!nonblank(key)) return `${key} must be a non-empty string`;
        if (!Array.isArray(value.triggerTags) || value.triggerTags.length === 0 || value.triggerTags.some((tag) => typeof tag !== "string" || !tag.trim())) return "triggerTags must be a non-empty string array";
        return;
      }
      case "agy_admit_operational_asset":
        if (!nonblank("assetId") || !nonblank("reviewedBy")) return "assetId and reviewedBy must be non-empty strings";
        if (!optionalString("notes")) return "notes must be a string";
        return;
      case "agy_quarantine_operational_asset":
        if (!nonblank("assetId") || !nonblank("reason") || !nonblank("reviewedBy")) return "assetId, reason, and reviewedBy must be non-empty strings";
        if (value.status !== undefined && !["quarantined", "rejected"].includes(String(value.status))) return "status must be quarantined or rejected";
        return;
      case "agy_list_operational_assets":
        if (value.status !== undefined && !["candidate", "admitted", "quarantined", "rejected"].includes(String(value.status))) return "status is invalid";
        if (!optionalString("workspace")) return "workspace must be a string";
        return;
      default:
        return `Unknown tool: ${name}`;
    }
  }

  private async dispatchValidated(req: any): Promise<any> {
    const { id, method, params } = req;

    if (method !== "tools/list" && method !== "tools/call") {
      return this.error(id, -32601, `Method not found: ${method}`);
    }
    if (method === "tools/list" && params !== undefined && (typeof params !== "object" || params === null || Array.isArray(params))) {
      return this.invalidParams(id, "tools/list params must be an object when provided");
    }

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
      if (!params || typeof params !== "object" || Array.isArray(params) || typeof params.name !== "string") {
        return this.invalidParams(id, "tools/call requires object params with a tool name");
      }
      const { name, arguments: args } = params;
      const validationError = this.validateToolArguments(name, args);
      if (validationError) return this.invalidParams(id, validationError);

      if (name === "agy_memory_search") {
        const results = await this.engine.search(args.query, {
          limit: args.limit ?? 5,
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
          return this.error(id, -32001, "Content/admin mutations are disabled in default mode");
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
          return this.error(id, -32001, "Content/admin mutations are disabled in default mode");
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
          return this.error(id, -32001, "Content/admin mutations are disabled in default mode");
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

    return this.error(id, -32601, `Method not found: ${method}`);
  }
}

if (require.main === module) {
  const server = new MemoryMcpServer();
  server.start();
}
