/**
 * Antigravity Memory OS — Core Type Definitions
 * Multi-Project Hive-Mind, Cloud & Local On-Device Llama.cpp RAG Pipeline
 */

export type MemoryModality =
  | "text"
  | "code"
  | "architecture"
  | "image"
  | "generation";

export type MemoryType =
  | "source_code"
  | "documentation"
  | "architecture_spec"
  | "decision_record"
  | "generation_history"
  | "user_interaction"
  | "symbol_index"
  | "hive_distillation";

export type RetrievalIntent =
  | "implementation"
  | "architecture"
  | "documentation"
  | "history"
  | "generation"
  | "exact_symbol"
  | "general";

export interface FileRecord {
  id: string;
  filepath: string;
  fileType: string;
  contentHash: string;
  mtime: number;
  size: number;
  indexedAt: number;
}

export interface ChunkRecord {
  id: string;
  fileId: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
  sourceType: string;
  modalType?: "code" | "text" | "image";
  b64Source?: string;
  symbolName?: string;
  symbolKind?: string;
  heading?: string;
  startLine?: number;
  endLine?: number;
  embedding?: Float32Array;
  embeddingModel: string;
  embeddingDimension: number;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryRecord {
  id: string;
  memoryType: MemoryType;
  modality: MemoryModality;
  modalType?: "code" | "text" | "image";
  b64Source?: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  embedding?: Float32Array;
  embeddingModel: string;
  embeddingDimension: number;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryRelation {
  id: string;
  fromId: string;
  relation: string;
  toId: string;
  source: string;
  weight: number;
  confidence?: number;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface DocumentEmbeddingInput {
  text: string;
  title?: string;
  symbol?: string;
  context?: string;
  modalType?: "code" | "text" | "image";
  b64Image?: string;
  imageMimeType?: string;
}

export interface QueryEmbeddingInput {
  query: string;
  intent?: RetrievalIntent;
  isCodeQuery?: boolean;
  b64Image?: string;
}

export interface EmbeddingProvider {
  embedDocument(input: DocumentEmbeddingInput): Promise<Float32Array>;
  embedQuery(input: QueryEmbeddingInput): Promise<Float32Array>;
  embedImage?(b64Image: string, caption?: string): Promise<Float32Array>;
  readonly modelName: string;
  readonly dimensions: number;
  readonly providerType: "cloud" | "local_llama";
}

export interface LocalRerankResult {
  index: number;
  relevanceScore: number;
}

export interface LocalRerankerProvider {
  rerank(query: string, documents: string[]): Promise<LocalRerankResult[]>;
  readonly isAvailable: boolean;
}

export interface LocalGeneratorProvider {
  generateCompletion(
    prompt: string,
    systemPrompt?: string,
    model?: string,
    temperature?: number
  ): Promise<string>;
  readonly availableModels: string[];
  readonly activeModel: string;
  readonly isAvailable: boolean;
}

export interface RetrievedContext {
  id: string;
  filepath?: string;
  sourceType: string;
  memoryType?: MemoryType | string;
  modality: MemoryModality;
  content: string;
  symbol?: string;
  symbolKind?: string;
  heading?: string;
  startLine?: number;
  endLine?: number;
  semanticScore?: number;
  lexicalScore?: number;
  graphScore?: number;
  rerankScore?: number;
  finalScore: number;
  reason: string;
  metadata?: Record<string, unknown>;
  relatedNodes?: Array<{
    relation: string;
    targetId: string;
    weight: number;
  }>;
}

export interface SearchOptions {
  limit?: number;
  candidateLimit?: number;
  intent?: RetrievalIntent;
  minScore?: number;
  useLocalReranker?: boolean;
  filterFilepaths?: string[];
  filterMemoryTypes?: MemoryType[];
  filterModalities?: MemoryModality[];
}

export interface IndexStats {
  filesCount: number;
  chunksCount: number;
  memoriesCount: number;
  relationsCount: number;
  lastIndexedAt: number;
  dbSizeBytes: number;
}

export interface HiveDistillationItem {
  id: string;
  category: "heuristic" | "optimization" | "architectural_rule" | "bug_pattern";
  title: string;
  summary: string;
  codeSnippet?: string;
  sourceProject: string;
  sanitized: boolean;
  createdAt: number;
}
