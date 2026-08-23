import { MemoryConfig } from "../core/config";
import { MemoryDatabase } from "../core/database";
import {
  ChunkRecord,
  EmbeddingProvider,
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

    // 1. Generate query embedding
    const queryVector = await this.embeddingProvider.embedQuery({
      query,
      intent,
    });

    // 2. Fetch chunks and memories
    const chunks = this.db.getAllChunksWithEmbeddings();
    const memories = this.db.getAllMemoriesWithEmbeddings();

    // 3. Semantic scoring
    const semanticChunkMatches: Array<{
      id: string;
      score: number;
      sourceType: string;
      timestamp?: number;
      chunk: ChunkRecord & { filepath: string; fileType: string };
    }> = [];

    for (const chunk of chunks) {
      if (!chunk.embedding) continue;
      const score = cosineSimilarity(queryVector, chunk.embedding);
      if (score >= this.config.minSimilarityThreshold) {
        semanticChunkMatches.push({
          id: chunk.id,
          score,
          sourceType: chunk.sourceType,
          timestamp: chunk.updatedAt || chunk.createdAt,
          chunk,
        });
      }
    }

    const semanticMemoryMatches: Array<{
      id: string;
      score: number;
      sourceType: string;
      timestamp?: number;
      memory: MemoryRecord;
    }> = [];

    for (const memory of memories) {
      if (!memory.embedding) continue;
      const score = cosineSimilarity(queryVector, memory.embedding);
      if (score >= this.config.minSimilarityThreshold) {
        semanticMemoryMatches.push({
          id: memory.id,
          score,
          sourceType: memory.memoryType,
          timestamp: memory.updatedAt || memory.createdAt,
          memory,
        });
      }
    }

    const allSemanticMatches = [
      ...semanticChunkMatches,
      ...semanticMemoryMatches,
    ].sort((a, b) => b.score - a.score);

    // 4. Lexical scoring
    const lexicalMatches: Array<{
      id: string;
      score: number;
      sourceType: string;
      timestamp?: number;
    }> = [];

    for (const chunk of chunks) {
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
        });
      }
    }

    for (const memory of memories) {
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
        });
      }
    }

    lexicalMatches.sort((a, b) => b.score - a.score);

    // 5. Graph Relations Traversal
    const graphMatches: Array<{
      id: string;
      score: number;
      sourceType: string;
      timestamp?: number;
    }> = [];

    const allRelations = this.db.getAllRelations();
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
            });
          }
        }
      }
    }

    // 6. Reciprocal Rank Fusion with Elo 14-day time decay
    const fusedRankings = reciprocalRankFusion(
      allSemanticMatches.slice(0, candidateLimit),
      lexicalMatches.slice(0, candidateLimit),
      graphMatches.slice(0, candidateLimit),
      intent,
      this.config.rrfConstant,
      this.config.halfLifeDays
    );

    // 7. Map back to RetrievedContext
    const chunkMap = new Map<string, (typeof chunks)[0]>();
    chunks.forEach((c) => chunkMap.set(c.id, c));

    const memoryMap = new Map<string, MemoryRecord>();
    memories.forEach((m) => memoryMap.set(m.id, m));

    let candidatePool: RetrievedContext[] = [];

    for (const ranked of fusedRankings) {
      const chunk = chunkMap.get(ranked.id);
      if (chunk) {
        let relatedNodes: RetrievedContext["relatedNodes"];
        if (chunk.symbolName) {
          const rels = this.db.getRelationsForNode(chunk.symbolName);
          if (rels.length > 0) {
            relatedNodes = rels.map((r) => ({
              relation: r.relation,
              targetId: r.fromId === chunk.symbolName ? r.toId : r.fromId,
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

    // 9. Limit final results
    return candidatePool.slice(0, limit);
  }
}
