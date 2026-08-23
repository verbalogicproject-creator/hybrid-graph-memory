import { MemoryConfig } from "../core/config";
import { MemoryDatabase } from "../core/database";
import {
  ChunkRecord,
  EmbeddingProvider,
  EmbeddingSpaceMismatchError,
  LocalRerankerProvider,
  MemoryRecord,
  RetrievedContext,
  SearchOptions,
} from "../core/types";
import { cosineSimilarity } from "../vector/math";
import { inferQueryIntent } from "./intent";
import { LexicalScorer } from "./lexical";
import { reciprocalRankFusion } from "./rank_fusion";

export class HybridRetriever {
  private lexicalScorer = new LexicalScorer();
  public lastSearchStats?: {
    totalSkipped: number;
    skippedByModel: Record<string, number>;
    matchingVectorsCount: number;
  };

  constructor(
    private db: MemoryDatabase,
    private embeddingProvider: EmbeddingProvider,
    private config: MemoryConfig,
    private reranker?: LocalRerankerProvider
  ) {}

  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<RetrievedContext[]> {
    const limit = options.limit ?? this.config.defaultResultLimit;
    const candidateLimit = options.candidateLimit ?? this.config.candidateLimit;
    const intent = options.intent || inferQueryIntent(query);

    // Strict hierarchical namespace resolution: Workspace -> Project -> Module
    const targetWorkspace =
      options.workspace ??
      (options.strictNamespace !== false ? this.config.workspace : undefined);
    const targetProject =
      options.project ??
      (options.strictNamespace !== false ? this.config.projectName : undefined);
    const targetModule = options.module;

    const matchesNamespace = (item: {
      workspace?: string;
      project?: string;
      module?: string;
      memoryType?: string;
      triggerTags?: string[];
      admissionStatus?: string;
    }) => {
      if (targetWorkspace && item.workspace && item.workspace !== targetWorkspace) {
        return false;
      }
      if (targetProject && item.project && item.project !== targetProject) {
        return false;
      }
      if (targetModule && item.module && item.module !== targetModule) {
        return false;
      }
      if (
        options.filterMemoryTypes &&
        options.filterMemoryTypes.length > 0 &&
        item.memoryType &&
        !options.filterMemoryTypes.includes(item.memoryType as any)
      ) {
        return false;
      }
      if (
        options.filterAdmissionStatuses &&
        options.filterAdmissionStatuses.length > 0 &&
        !options.filterAdmissionStatuses.includes((item.admissionStatus || "admitted") as any)
      ) {
        return false;
      }
      if (options.triggerTag) {
        if (!item.triggerTags || !item.triggerTags.includes(options.triggerTag)) {
          return false;
        }
      }
      return true;
    };

    // 1. Generate query embedding
    const queryVector = await this.embeddingProvider.embedQuery({
      query,
      intent,
    });

    // 2. Fetch chunks and memories
    const chunks = this.db.getAllChunksWithEmbeddings();
    const memories = this.db.getAllMemoriesWithEmbeddings();

    // Check for exact trigger tag matches in query (e.g., @prompt:xyz or #workflow:abc)
    const queryTriggerMatch = query.match(/[@#]([A-Za-z0-9_:-]+)/);
    const detectedTriggerTag = queryTriggerMatch ? queryTriggerMatch[1] : options.triggerTag;

    // 3. Semantic scoring with strict composite identity & namespace filtering
    const semanticChunkMatches: Array<{
      id: string;
      score: number;
      sourceType: string;
      timestamp?: number;
      lastAccessedAt?: number;
      accessCount?: number;
      chunk: ChunkRecord & { filepath: string; fileType: string };
    }> = [];

    const skippedByModel: Record<string, number> = {};
    let totalVectorsEvaluated = 0;
    let matchingVectorsCount = 0;

    const activeModel = this.embeddingProvider.modelName;
    const activeDimensions = this.embeddingProvider.dimensions;
    const activeProviderType = this.embeddingProvider.providerType;

    for (const chunk of chunks) {
      if (!chunk.embedding) continue;
      if (!matchesNamespace(chunk)) continue;

      totalVectorsEvaluated++;

      const chunkProviderType =
        chunk.providerType ||
        (chunk.embeddingModel.includes("gemini") ? "cloud" : "local_llama");
      const isMatch =
        chunk.embeddingModel === activeModel &&
        chunk.embeddingDimension === activeDimensions &&
        chunkProviderType === activeProviderType;

      if (!isMatch) {
        skippedByModel[chunk.embeddingModel] =
          (skippedByModel[chunk.embeddingModel] || 0) + 1;
        continue;
      }

      matchingVectorsCount++;
      let score = cosineSimilarity(queryVector, chunk.embedding);

      // Operational exact trigger tag boost
      if (detectedTriggerTag && chunk.triggerTags?.includes(detectedTriggerTag)) {
        score = Math.min(1.0, score + 0.35);
      }

      if (score >= this.config.minSimilarityThreshold) {
        semanticChunkMatches.push({
          id: chunk.id,
          score,
          sourceType: chunk.sourceType,
          timestamp: chunk.updatedAt || chunk.createdAt,
          lastAccessedAt: chunk.lastAccessedAt,
          accessCount: chunk.accessCount,
          chunk,
        });
      }
    }

    const semanticMemoryMatches: Array<{
      id: string;
      score: number;
      sourceType: string;
      timestamp?: number;
      lastAccessedAt?: number;
      accessCount?: number;
      memory: MemoryRecord;
    }> = [];

    for (const memory of memories) {
      if (!memory.embedding) continue;
      if (!matchesNamespace(memory)) continue;

      totalVectorsEvaluated++;

      const memoryProviderType =
        memory.providerType ||
        (memory.embeddingModel.includes("gemini") ? "cloud" : "local_llama");
      const isMatch =
        memory.embeddingModel === activeModel &&
        memory.embeddingDimension === activeDimensions &&
        memoryProviderType === activeProviderType;

      if (!isMatch) {
        skippedByModel[memory.embeddingModel] =
          (skippedByModel[memory.embeddingModel] || 0) + 1;
        continue;
      }

      matchingVectorsCount++;
      let score = cosineSimilarity(queryVector, memory.embedding);

      // Operational exact trigger tag boost
      if (detectedTriggerTag && memory.triggerTags?.includes(detectedTriggerTag)) {
        score = Math.min(1.0, score + 0.35);
      }

      if (score >= this.config.minSimilarityThreshold) {
        semanticMemoryMatches.push({
          id: memory.id,
          score,
          sourceType: memory.memoryType,
          timestamp: memory.updatedAt || memory.createdAt,
          lastAccessedAt: memory.lastAccessedAt,
          accessCount: memory.accessCount,
          memory,
        });
      }
    }

    const totalSkipped = Object.values(skippedByModel).reduce(
      (a, b) => a + b,
      0
    );

    this.lastSearchStats = {
      totalSkipped,
      skippedByModel,
      matchingVectorsCount,
    };

    // Fail-closed when active space is empty but index contains stored vectors
    if (totalVectorsEvaluated > 0 && matchingVectorsCount === 0) {
      throw new EmbeddingSpaceMismatchError(
        activeProviderType,
        activeModel,
        activeDimensions,
        skippedByModel,
        totalSkipped
      );
    }

    // Report skipped records if there are any
    if (totalSkipped > 0) {
      const details = Object.entries(skippedByModel)
        .map(([model, count]) => `${count.toLocaleString()} chunks skipped — embedded with ${model}`)
        .join(", ");
      console.warn(
        `[memory] ⚠️ ${details}, active embedder is ${activeModel}. Re-index to use them.`
      );
    }

    const allSemanticMatches = [
      ...semanticChunkMatches,
      ...semanticMemoryMatches,
    ].sort((a, b) => b.score - a.score);

    // 4. Lexical scoring (scoped to namespace)
    const lexicalMatches: Array<{
      id: string;
      score: number;
      sourceType: string;
      timestamp?: number;
      lastAccessedAt?: number;
      accessCount?: number;
    }> = [];

    for (const chunk of chunks) {
      if (!matchesNamespace(chunk)) continue;
      const match = this.lexicalScorer.scoreText(
        query,
        chunk.id,
        chunk.content,
        chunk.symbolName,
        chunk.heading
      );
      if (match) {
        lexicalMatches.push({
          id: chunk.id,
          score: match.score,
          sourceType: chunk.sourceType,
          timestamp: chunk.updatedAt || chunk.createdAt,
          lastAccessedAt: chunk.lastAccessedAt,
          accessCount: chunk.accessCount,
        });
      }
    }

    for (const memory of memories) {
      if (!matchesNamespace(memory)) continue;
      const match = this.lexicalScorer.scoreText(
        query,
        memory.id,
        memory.content,
        memory.title
      );
      if (match) {
        lexicalMatches.push({
          id: memory.id,
          score: match.score,
          sourceType: memory.memoryType,
          timestamp: memory.updatedAt || memory.createdAt,
          lastAccessedAt: memory.lastAccessedAt,
          accessCount: memory.accessCount,
        });
      }
    }

    lexicalMatches.sort((a, b) => b.score - a.score);

    // 5. Graph Relations Traversal (scoped to namespace)
    const graphMatches: Array<{
      id: string;
      score: number;
      sourceType: string;
      timestamp?: number;
      lastAccessedAt?: number;
      accessCount?: number;
    }> = [];

    const allRelations = this.db.getAllRelations({
      workspace: targetWorkspace,
      project: targetProject,
    });
    const queryTokens = query.toLowerCase().split(/\s+/);

    for (const rel of allRelations) {
      const mentionsFrom = queryTokens.some((t) =>
        rel.fromId.toLowerCase().includes(t)
      );
      const mentionsTo = queryTokens.some((t) =>
        rel.toId.toLowerCase().includes(t)
      );

      if (mentionsFrom || mentionsTo) {
        for (const chunk of chunks) {
          if (!matchesNamespace(chunk)) continue;
          if (
            chunk.symbolName === rel.fromId ||
            chunk.symbolName === rel.toId ||
            chunk.content.includes(rel.fromId) ||
            chunk.content.includes(rel.toId)
          ) {
            graphMatches.push({
              id: chunk.id,
              score: rel.weight * (rel.confidence || 1.0),
              sourceType: "architecture",
              timestamp: chunk.updatedAt || chunk.createdAt,
              lastAccessedAt: chunk.lastAccessedAt,
              accessCount: chunk.accessCount,
            });
          }
        }
      }
    }

    // 6. Reciprocal Rank Fusion with Elo 14-day time decay & access recency
    const fusedRankings = reciprocalRankFusion(
      allSemanticMatches.slice(0, candidateLimit),
      lexicalMatches.slice(0, candidateLimit),
      graphMatches.slice(0, candidateLimit),
      intent,
      this.config.rrfConstant,
      this.config.halfLifeDays
    );

    // 7. Map back to RetrievedContext with granular provenance
    const chunkMap = new Map<string, (typeof chunks)[0]>();
    chunks.forEach((c) => chunkMap.set(c.id, c));

    const memoryMap = new Map<string, MemoryRecord>();
    memories.forEach((m) => memoryMap.set(m.id, m));

    let candidatePool: RetrievedContext[] = [];

    for (const ranked of fusedRankings) {
      const chunk = chunkMap.get(ranked.id);
      if (chunk) {
        let relatedNodes: RetrievedContext["relatedNodes"];
        const symbolOrFile =
          chunk.symbolName ||
          (chunk.filepath ? chunk.filepath.split("/").pop()?.replace(/\.[^/.]+$/, "") : undefined);

        if (symbolOrFile) {
          const rels = this.db.getRelationsForNode(symbolOrFile, {
            workspace: targetWorkspace,
            project: targetProject,
          });
          if (rels.length > 0) {
            relatedNodes = rels.map((r) => ({
              relation: r.relation,
              targetId: r.fromId === symbolOrFile ? r.toId : r.fromId,
              weight: r.weight,
            }));
          }
        }

        candidatePool.push({
          id: chunk.id,
          filepath: chunk.filepath,
          sourceType: chunk.sourceType,
          memoryType: "source_code",
          modality: chunk.sourceType === "code" ? "code" : "text",
          content: chunk.content,
          symbol: chunk.symbolName,
          symbolKind: chunk.symbolKind,
          heading: chunk.heading,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          commitHash: chunk.commitHash,
          workspace: chunk.workspace,
          project: chunk.project,
          module: chunk.module,
          triggerTags: chunk.triggerTags,
          admissionStatus: chunk.admissionStatus,
          targetFramework: chunk.targetFramework,
          author: chunk.author,
          sourceDoc: chunk.sourceDoc,
          assetSpec: chunk.assetSpec,
          lastAccessedAt: chunk.lastAccessedAt,
          accessCount: chunk.accessCount,
          semanticScore: ranked.semanticScore,
          lexicalScore: ranked.lexicalScore,
          graphScore: ranked.graphScore,
          finalScore: ranked.finalScore,
          reason: ranked.reason,
          relatedNodes,
        });
      } else {
        const memory = memoryMap.get(ranked.id);
        if (memory) {
          candidatePool.push({
            id: memory.id,
            sourceType: "experiential",
            memoryType: memory.memoryType,
            modality: memory.modality,
            content: memory.content,
            symbol: memory.title,
            symbolKind: memory.memoryType,
            commitHash: memory.commitHash,
            workspace: memory.workspace,
            project: memory.project,
            module: memory.module,
            triggerTags: memory.triggerTags,
            admissionStatus: memory.admissionStatus,
            targetFramework: memory.targetFramework,
            author: memory.author,
            sourceDoc: memory.sourceDoc,
            assetSpec: memory.assetSpec,
            lastAccessedAt: memory.lastAccessedAt,
            accessCount: memory.accessCount,
            semanticScore: ranked.semanticScore,
            lexicalScore: ranked.lexicalScore,
            finalScore: ranked.finalScore,
            reason: ranked.reason,
            metadata: memory.metadata,
          });
        }
      }
    }

    // 8. Optional On-Device Neural Reranker (bge-reranker on port 8144)
    if (
      options.useLocalReranker !== false &&
      this.reranker &&
      candidatePool.length > 1
    ) {
      try {
        const topPool = candidatePool.slice(0, 10);
        const docs = topPool.map((c) => c.content.slice(0, 500));
        const reranked = await this.reranker.rerank(query, docs);

        for (const r of reranked) {
          if (topPool[r.index]) {
            topPool[r.index].rerankScore = r.relevanceScore;
            topPool[r.index].reason += ` + Neural Rerank (BGE Score: ${r.relevanceScore.toFixed(2)})`;
          }
        }
      } catch (e) {}
    }

    // 9. Limit final results & Record access tracking
    const finalResults = candidatePool.slice(0, limit);
    const chunkIdsToRecord: string[] = [];
    const memoryIdsToRecord: string[] = [];

    for (const r of finalResults) {
      if (chunkMap.has(r.id)) {
        chunkIdsToRecord.push(r.id);
      } else if (memoryMap.has(r.id)) {
        memoryIdsToRecord.push(r.id);
      }
    }

    if (chunkIdsToRecord.length > 0 || memoryIdsToRecord.length > 0) {
      this.db.recordAccess(chunkIdsToRecord, memoryIdsToRecord);
    }

    return finalResults;
  }
}
