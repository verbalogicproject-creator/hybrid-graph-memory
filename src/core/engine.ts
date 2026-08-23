import fs from "node:fs";
import path from "node:path";
import { CodeChunker, computeSha256 } from "../chunkers/code";
import { CtxChunker } from "../chunkers/ctx";
import { MarkdownChunker } from "../chunkers/markdown";
import { TextChunker } from "../chunkers/text";
import { GeminiEmbeddingProvider } from "../vector/providers/gemini";
import { LocalLlamaEmbeddingProvider } from "../vector/providers/local_llama";
import { LocalBgeReranker } from "../retrieval/reranker";
import { LocalLlamaGenerator } from "../retrieval/generator";
import { HybridRetriever } from "../retrieval/hybrid_retriever";
import { loadMemoryConfig, MemoryConfig } from "./config";
import { MemoryDatabase } from "./database";
import {
  ChunkRecord,
  EmbeddingProvider,
  FileRecord,
  IndexStats,
  MemoryModality,
  MemoryRecord,
  MemoryRelation,
  MemoryType,
  RetrievedContext,
  SearchOptions,
} from "./types";
import { ProjectScanner } from "../ast/scanner";

export class MemoryEngine {
  private config: MemoryConfig;
  private db: MemoryDatabase;
  private embeddingProvider!: EmbeddingProvider;
  private retriever!: HybridRetriever;
  private localReranker?: LocalBgeReranker;
  private localGenerator?: LocalLlamaGenerator;
  private initialized = false;
  private initPromise?: Promise<void>;

  private codeChunker = new CodeChunker();
  private mdChunker = new MarkdownChunker();
  private ctxChunker = new CtxChunker();
  private textChunker = new TextChunker();
  private scanner: ProjectScanner;

  constructor(customConfig?: Partial<MemoryConfig>) {
    this.config = { ...loadMemoryConfig(), ...(customConfig || {}) };
    this.db = new MemoryDatabase(this.config.dbPath);

    // Local Reranker & Generator
    this.localReranker = new LocalBgeReranker(this.config.local.rerankerUrl);
    this.localGenerator = new LocalLlamaGenerator(
      this.config.local.generatorUrl,
      this.config.local.generatorModels,
      this.config.local.activeGenerator
    );

    this.scanner = new ProjectScanner(this.config);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const mode = this.config.providerMode;
      let selectedProvider: EmbeddingProvider;
      let logReason = "";

      if (mode === "local") {
        const local = new LocalLlamaEmbeddingProvider(
          this.config.local.embedderUrl,
          "embeddinggemma-300m-q4",
          this.config.local.dimensions
        );
        const ok = await local.checkHealth();
        if (!ok) {
          console.warn(
            `[memory] ⚠️ Local embedder is not responding at ${this.config.local.embedderUrl}: ${local.lastHealthError || "unavailable"}`
          );
        }
        selectedProvider = local;
        logReason = "configured providerMode='local'";
      } else if (mode === "cloud") {
        const apiKey = this.config.cloud.apiKey || process.env.GEMINI_API_KEY;
        if (!apiKey) {
          throw new Error(
            "Cloud embedding provider configured (providerMode='cloud') but GEMINI_API_KEY is not set in environment or configuration."
          );
        }
        selectedProvider = new GeminiEmbeddingProvider(
          apiKey,
          this.config.cloud.embeddingModel,
          this.config.cloud.dimensions
        );
        logReason = "configured providerMode='cloud'";
      } else {
        // mode === "auto"
        const local = new LocalLlamaEmbeddingProvider(
          this.config.local.embedderUrl,
          "embeddinggemma-300m-q4",
          this.config.local.dimensions
        );
        const ok = await local.checkHealth();
        if (ok) {
          selectedProvider = local;
          logReason = "probe succeeded";
        } else {
          // Local stack is down or unreachable; check cloud credentials
          const apiKey = this.config.cloud.apiKey || process.env.GEMINI_API_KEY;
          const localError = local.lastHealthError || "connect ECONNREFUSED";
          if (!apiKey) {
            throw new Error(
              `No embedding provider available: Local embedder is not responding at ${this.config.local.embedderUrl} (${localError}) and cloud GEMINI_API_KEY is not set.`
            );
          }
          try {
            selectedProvider = new GeminiEmbeddingProvider(
              apiKey,
              this.config.cloud.embeddingModel,
              this.config.cloud.dimensions
            );
            logReason = `local probe failed: ${localError}`;
          } catch (err: any) {
            throw new Error(
              `No embedding provider available: Local embedder is not responding at ${this.config.local.embedderUrl} (${localError}) and cloud provider failed: ${err.message}`
            );
          }
        }
      }

      this.embeddingProvider = selectedProvider;
      this.retriever = new HybridRetriever(
        this.db,
        this.embeddingProvider,
        this.config,
        this.localReranker
      );
      this.initialized = true;

      // Startup provider logging
      const sourceLabel =
        selectedProvider.providerType === "cloud" ? "cloud" : "local";
      console.log(
        `[memory] embedder: ${selectedProvider.modelName} (${sourceLabel})${logReason ? ` — ${logReason}` : ""}`
      );

      // Check manifest identity
      const manifest = this.db.getIndexManifest();
      if (manifest) {
        const isManifestMatch =
          manifest.modelName === selectedProvider.modelName &&
          manifest.dimensions === selectedProvider.dimensions &&
          manifest.providerType === selectedProvider.providerType;
        if (!isManifestMatch) {
          console.warn(
            `[memory] ⚠️ Index identity mismatch: Index was built with ${manifest.providerType}:${manifest.modelName}:${manifest.dimensions}d, but active embedder is ${selectedProvider.providerType}:${selectedProvider.modelName}:${selectedProvider.dimensions}d. Search will skip mismatched embeddings. Re-index to use them.`
          );
        }
      }
    })();

    return this.initPromise;
  }

  public async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  public get activeEmbeddingProvider(): EmbeddingProvider {
    return this.embeddingProvider;
  }

  public get retrieverInstance(): HybridRetriever {
    return this.retriever;
  }

  async index(
    onProgress?: (status: {
      phase: "scanning" | "chunking" | "embedding" | "completed";
      file?: string;
      current?: number;
      total?: number;
      message?: string;
    }) => void
  ): Promise<{
    indexed: number;
    unchanged: number;
    deleted: number;
    totalChunks: number;
  }> {
    await this.ensureInitialized();
    onProgress?.({ phase: "scanning", message: "Scanning project directory..." });
    const scannedFiles = this.scanner.scan();
    const existingDbFiles = this.db.getAllFiles();
    const existingFileMap = new Map(existingDbFiles.map((f) => [f.filepath, f]));

    let indexedCount = 0;
    let unchangedCount = 0;
    let deletedCount = 0;

    const scannedPathSet = new Set(scannedFiles.map((f) => f.filepath));
    for (const dbFile of existingDbFiles) {
      if (!scannedPathSet.has(dbFile.filepath)) {
        this.db.deleteFile(dbFile.id);
        deletedCount++;
      }
    }

    const filesToProcess: typeof scannedFiles = [];
    for (const file of scannedFiles) {
      const existing = existingFileMap.get(file.filepath);
      if (
        existing &&
        existing.contentHash === file.contentHash &&
        existing.mtime === file.mtime
      ) {
        unchangedCount++;
      } else {
        filesToProcess.push(file);
      }
    }

    const totalToProcess = filesToProcess.length;

    for (let idx = 0; idx < totalToProcess; idx++) {
      const file = filesToProcess[idx];
      const fileId = `file_${computeSha256(file.filepath).slice(0, 24)}`;

      onProgress?.({
        phase: "chunking",
        file: file.filepath,
        current: idx + 1,
        total: totalToProcess,
        message: `Processing [${idx + 1}/${totalToProcess}]: ${file.filepath}`,
      });

      this.db.upsertFile({
        id: fileId,
        filepath: file.filepath,
        fileType: file.fileType,
        contentHash: file.contentHash,
        commitHash: file.commitHash,
        workspace: this.config.workspace || "default",
        project: this.config.projectName || "default",
        mtime: file.mtime,
        size: file.size,
        indexedAt: Date.now(),
      });

      this.db.deleteChunksByFileId(fileId);

      let chunks: ChunkRecord[] = [];
      const ext = `.${file.fileType}`.toLowerCase();

      if ([".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go"].includes(ext)) {
        chunks = this.codeChunker.chunk(
          file.filepath,
          file.content,
          fileId,
          this.embeddingProvider.modelName,
          this.embeddingProvider.dimensions
        );
      } else if ([".md", ".mdx"].includes(ext)) {
        chunks = this.mdChunker.chunk(
          file.filepath,
          file.content,
          fileId,
          this.embeddingProvider.modelName,
          this.embeddingProvider.dimensions
        );
      } else if (ext === ".ctx") {
        const parsed = this.ctxChunker.parse(
          file.filepath,
          file.content,
          fileId,
          this.embeddingProvider.modelName,
          this.embeddingProvider.dimensions
        );
        chunks = parsed.chunks;
        for (const rel of parsed.relations) {
          this.db.insertRelation(rel);
        }
      } else {
        chunks = this.textChunker.chunk(
          file.filepath,
          file.content,
          fileId,
          this.embeddingProvider.modelName,
          this.embeddingProvider.dimensions
        );
      }

      for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
        const chunk = chunks[cIdx];
        chunk.providerType = this.embeddingProvider.providerType;
        chunk.commitHash = file.commitHash;
        chunk.workspace = this.config.workspace || "default";
        chunk.project = this.config.projectName || "default";
        chunk.module = file.module || "root";
        chunk.lastAccessedAt = 0;
        chunk.accessCount = 0;

        const embedding = await this.embeddingProvider.embedDocument({
          text: chunk.content,
          title: file.filepath,
          symbol: chunk.symbolName,
          modalType: chunk.modalType,
        });

        chunk.embedding = embedding;
        this.db.insertChunk(chunk, file.filepath);
      }

      indexedCount++;
    }

    // Record index embedding identity manifest (Requirement 4)
    this.db.setIndexManifest({
      providerType: this.embeddingProvider.providerType,
      modelName: this.embeddingProvider.modelName,
      dimensions: this.embeddingProvider.dimensions,
      updatedAt: Date.now(),
    });

    onProgress?.({ phase: "completed", message: "Indexing completed." });

    const stats = this.db.getStats();
    return {
      indexed: indexedCount,
      unchanged: unchangedCount,
      deleted: deletedCount,
      totalChunks: stats.chunksCount,
    };
  }

  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<RetrievedContext[]> {
    await this.ensureInitialized();
    return this.retriever.search(query, options);
  }

  /**
   * Generates an end-to-end RAG answer using local on-device LLM (Qwen / Phi-4 / Llama-3.2 / Gemma-4)
   */
  async generateRAGAnswer(
    query: string,
    model?: string,
    systemDirective?: string
  ): Promise<{ answer: string; contexts: RetrievedContext[]; modelUsed: string }> {
    await this.ensureInitialized();
    const contexts = await this.search(query, { limit: 4 });
    const contextText = contexts
      .map(
        (c, idx) =>
          `[Context #${idx + 1} (${c.filepath || c.sourceType})]\n${c.content}`
      )
      .join("\n\n---\n\n");

    const systemPrompt = [
      systemDirective ||
        "You are the Antigravity Memory OS Assistant. Answer the user prompt accurately based strictly on the retrieved context.",
      "",
      "### RETRIEVED PROJECT CONTEXT:",
      contextText,
    ].join("\n");

    if (!this.localGenerator) {
      throw new Error("Local generator provider is not initialized.");
    }

    const answer = await this.localGenerator.generateCompletion(
      query,
      systemPrompt,
      model
    );

    return {
      answer,
      contexts,
      modelUsed: model || this.config.local.activeGenerator,
    };
  }

  async ingestText(
    text: string,
    title: string,
    memoryType: MemoryType = "user_interaction",
    metadata?: Record<string, unknown>
  ): Promise<string> {
    await this.ensureInitialized();
    const id = `mem_note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();

    const embedding = await this.embeddingProvider.embedDocument({
      text,
      title,
      context: `Memory Type: ${memoryType}`,
    });

    const record: MemoryRecord = {
      id,
      memoryType,
      modality: "text",
      modalType: "text",
      title,
      content: text,
      metadata,
      embedding,
      embeddingModel: this.embeddingProvider.modelName,
      embeddingDimension: this.embeddingProvider.dimensions,
      providerType: this.embeddingProvider.providerType,
      commitHash: (metadata?.commitHash as string) || undefined,
      workspace: (metadata?.workspace as string) || this.config.workspace || "default",
      project: (metadata?.project as string) || this.config.projectName || "default",
      module: (metadata?.module as string) || "root",
      lastAccessedAt: now,
      accessCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.db.upsertMemory(record);
    return id;
  }

  async ingestImage(
    b64Image: string,
    caption = "UI Viewport Screenshot",
    metadata?: Record<string, unknown>
  ): Promise<string> {
    await this.ensureInitialized();
    const id = `mem_img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();

    let embedding: Float32Array;
    if (this.embeddingProvider.embedImage) {
      embedding = await this.embeddingProvider.embedImage(b64Image, caption);
    } else {
      embedding = await this.embeddingProvider.embedDocument({
        text: `[MODAL:IMAGE] Visual Screenshot: ${caption}`,
        title: "Screenshot",
      });
    }

    const record: MemoryRecord = {
      id,
      memoryType: "generation_history",
      modality: "image",
      modalType: "image",
      b64Source: b64Image,
      title: caption,
      content: `[Visual UI Screenshot]\nCaption: ${caption}\nPayload Size: ${b64Image.length} bytes`,
      metadata,
      embedding,
      embeddingModel: this.embeddingProvider.modelName,
      embeddingDimension: this.embeddingProvider.dimensions,
      providerType: this.embeddingProvider.providerType,
      commitHash: (metadata?.commitHash as string) || undefined,
      workspace: (metadata?.workspace as string) || this.config.workspace || "default",
      project: (metadata?.project as string) || this.config.projectName || "default",
      module: (metadata?.module as string) || "root",
      lastAccessedAt: now,
      accessCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.db.upsertMemory(record);
    return id;
  }

  public getAllRelations(): MemoryRelation[] {
    return this.db.getAllRelations();
  }

  public getStats(): IndexStats {
    const stats = this.db.getStats();
    try {
      if (fs.existsSync(this.config.dbPath)) {
        stats.dbSizeBytes = fs.statSync(this.config.dbPath).size;
      }
    } catch (e) {}
    return stats;
  }

  public close() {
    this.db.close();
  }
}
