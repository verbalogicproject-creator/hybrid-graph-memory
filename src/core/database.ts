import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  ChunkRecord,
  FileRecord,
  IndexStats,
  MemoryRecord,
  MemoryRelation,
} from "./types";
import { bufferToFloat32, float32ToBuffer } from "../vector/math";

export class MemoryDatabase {
  private db: DatabaseSync;
  private hasFTS5 = false;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    this.initSchema();
  }

  private initSchema() {
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");

    // 1. Files table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        filepath TEXT UNIQUE NOT NULL,
        file_type TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        size INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL
      );
    `);

    // 2. Chunks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        source_type TEXT NOT NULL,
        modal_type TEXT DEFAULT 'code',
        b64_source TEXT,
        symbol_name TEXT,
        symbol_kind TEXT,
        heading TEXT,
        start_line INTEGER,
        end_line INTEGER,
        embedding BLOB,
        embedding_model TEXT NOT NULL,
        embedding_dimension INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id);
      CREATE INDEX IF NOT EXISTS idx_chunks_symbol ON chunks(symbol_name);
      CREATE INDEX IF NOT EXISTS idx_chunks_heading ON chunks(heading);
    `);

    try {
      this.db.exec("ALTER TABLE chunks ADD COLUMN modal_type TEXT DEFAULT 'code';");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE chunks ADD COLUMN b64_source TEXT;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE chunks ADD COLUMN provider_type TEXT;");
    } catch (e) {}
    try {
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_chunks_modal ON chunks(modal_type);");
    } catch (e) {}

    // 3. Memories table (Experiential & Multimodal)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        memory_type TEXT NOT NULL,
        modality TEXT NOT NULL,
        modal_type TEXT DEFAULT 'text',
        b64_source TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        embedding BLOB,
        embedding_model TEXT NOT NULL,
        embedding_dimension INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
      CREATE INDEX IF NOT EXISTS idx_memories_modality ON memories(modality);
    `);

    try {
      this.db.exec("ALTER TABLE memories ADD COLUMN modal_type TEXT DEFAULT 'text';");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE memories ADD COLUMN b64_source TEXT;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE memories ADD COLUMN provider_type TEXT;");
    } catch (e) {}
    try {
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_memories_modal ON memories(modal_type);");
    } catch (e) {}

    // 4. Metadata / Manifest table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // 5. Relations table (GraphRAG architectural graph)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS relations (
        id TEXT PRIMARY KEY,
        from_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        to_id TEXT NOT NULL,
        source TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        confidence REAL DEFAULT 1.0,
        metadata TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rel_from ON relations(from_id);
      CREATE INDEX IF NOT EXISTS idx_rel_to ON relations(to_id);
      CREATE INDEX IF NOT EXISTS idx_rel_type ON relations(relation);
    `);

    // 6. FTS5 Virtual Tables & Triggers
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
          chunk_id UNINDEXED,
          filepath UNINDEXED,
          content,
          symbol_name,
          heading,
          tokenize = 'porter unicode61'
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
          memory_id UNINDEXED,
          title,
          content,
          tokenize = 'porter unicode61'
        );
      `);
      this.hasFTS5 = true;
    } catch (err) {
      this.hasFTS5 = false;
    }
  }

  upsertFile(file: FileRecord) {
    const stmt = this.db.prepare(`
      INSERT INTO files (id, filepath, file_type, content_hash, mtime, size, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(filepath) DO UPDATE SET
        content_hash = excluded.content_hash,
        mtime = excluded.mtime,
        size = excluded.size,
        indexed_at = excluded.indexed_at
    `);
    stmt.run(
      file.id,
      file.filepath,
      file.fileType,
      file.contentHash,
      file.mtime,
      file.size,
      file.indexedAt
    );
  }

  getFileByPath(filepath: string): FileRecord | null {
    const stmt = this.db.prepare(`
      SELECT id, filepath, file_type as fileType, content_hash as contentHash,
             mtime, size, indexed_at as indexedAt
      FROM files WHERE filepath = ?
    `);
    const row = stmt.get(filepath) as any;
    return row || null;
  }

  getAllFiles(): FileRecord[] {
    const stmt = this.db.prepare(`
      SELECT id, filepath, file_type as fileType, content_hash as contentHash,
             mtime, size, indexed_at as indexedAt
      FROM files
    `);
    return stmt.all() as any[];
  }

  deleteFile(fileId: string) {
    if (this.hasFTS5) {
      const getChunks = this.db.prepare("SELECT id FROM chunks WHERE file_id = ?");
      const chunkRows = getChunks.all(fileId) as any[];
      for (const row of chunkRows) {
        this.db.prepare("DELETE FROM chunks_fts WHERE chunk_id = ?").run(row.id);
      }
    }
    this.db.prepare("DELETE FROM files WHERE id = ?").run(fileId);
  }

  deleteChunksByFileId(fileId: string) {
    if (this.hasFTS5) {
      const getChunks = this.db.prepare("SELECT id FROM chunks WHERE file_id = ?");
      const chunkRows = getChunks.all(fileId) as any[];
      for (const row of chunkRows) {
        this.db.prepare("DELETE FROM chunks_fts WHERE chunk_id = ?").run(row.id);
      }
    }
    this.db.prepare("DELETE FROM chunks WHERE file_id = ?").run(fileId);
  }

  insertChunk(chunk: ChunkRecord, filepath = "") {
    const blob = chunk.embedding ? float32ToBuffer(chunk.embedding) : null;
    const providerType =
      chunk.providerType ||
      (chunk.embeddingModel.includes("gemini") ? "cloud" : "local_llama");
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO chunks (
        id, file_id, chunk_index, content, content_hash, source_type,
        modal_type, b64_source,
        symbol_name, symbol_kind, heading, start_line, end_line,
        embedding, embedding_model, embedding_dimension, provider_type, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      chunk.id,
      chunk.fileId,
      chunk.chunkIndex,
      chunk.content,
      chunk.contentHash,
      chunk.sourceType,
      chunk.modalType || "code",
      chunk.b64Source || null,
      chunk.symbolName || null,
      chunk.symbolKind || null,
      chunk.heading || null,
      chunk.startLine || null,
      chunk.endLine || null,
      blob,
      chunk.embeddingModel,
      chunk.embeddingDimension,
      providerType,
      chunk.createdAt,
      chunk.updatedAt
    );

    if (this.hasFTS5) {
      this.db.prepare("DELETE FROM chunks_fts WHERE chunk_id = ?").run(chunk.id);
      this.db
        .prepare(`
        INSERT INTO chunks_fts (chunk_id, filepath, content, symbol_name, heading)
        VALUES (?, ?, ?, ?, ?)
      `)
        .run(chunk.id, filepath, chunk.content, chunk.symbolName || "", chunk.heading || "");
    }
  }

  getChunksByFileId(fileId: string): ChunkRecord[] {
    const stmt = this.db.prepare(`
      SELECT id, file_id as fileId, chunk_index as chunkIndex, content,
             content_hash as contentHash, source_type as sourceType,
             modal_type as modalType, b64_source as b64Source,
             symbol_name as symbolName, symbol_kind as symbolKind,
             heading, start_line as startLine, end_line as endLine,
             embedding, embedding_model as embeddingModel,
             embedding_dimension as embeddingDimension,
             provider_type as providerType,
             created_at as createdAt, updated_at as updatedAt
      FROM chunks WHERE file_id = ? ORDER BY chunk_index ASC
    `);

    const rows = stmt.all(fileId) as any[];
    return rows.map((r) => ({
      ...r,
      providerType:
        r.providerType ||
        (r.embeddingModel?.includes("gemini") ? "cloud" : "local_llama"),
      embedding: r.embedding ? bufferToFloat32(r.embedding) : undefined,
    }));
  }

  getAllChunksWithEmbeddings(): Array<
    ChunkRecord & { filepath: string; fileType: string }
  > {
    const stmt = this.db.prepare(`
      SELECT c.id, c.file_id as fileId, c.chunk_index as chunkIndex, c.content,
             c.content_hash as contentHash, c.source_type as sourceType,
             c.modal_type as modalType, c.b64_source as b64Source,
             c.symbol_name as symbolName, c.symbol_kind as symbolKind,
             c.heading, c.start_line as startLine, c.end_line as endLine,
             c.embedding, c.embedding_model as embeddingModel,
             c.embedding_dimension as embeddingDimension,
             c.provider_type as providerType,
             c.created_at as createdAt, c.updated_at as updatedAt,
             f.filepath, f.file_type as fileType
      FROM chunks c
      JOIN files f ON c.file_id = f.id
      WHERE c.embedding IS NOT NULL
    `);

    const rows = stmt.all() as any[];
    return rows.map((r) => ({
      ...r,
      providerType:
        r.providerType ||
        (r.embeddingModel?.includes("gemini") ? "cloud" : "local_llama"),
      embedding: r.embedding ? bufferToFloat32(r.embedding) : undefined,
    }));
  }

  upsertMemory(memory: MemoryRecord) {
    const blob = memory.embedding ? float32ToBuffer(memory.embedding) : null;
    const providerType =
      memory.providerType ||
      (memory.embeddingModel.includes("gemini") ? "cloud" : "local_llama");
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO memories (
        id, memory_type, modality, modal_type, b64_source, title, content, metadata,
        embedding, embedding_model, embedding_dimension, provider_type, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      memory.id,
      memory.memoryType,
      memory.modality,
      memory.modalType || "text",
      memory.b64Source || null,
      memory.title,
      memory.content,
      memory.metadata ? JSON.stringify(memory.metadata) : null,
      blob,
      memory.embeddingModel,
      memory.embeddingDimension,
      providerType,
      memory.createdAt,
      memory.updatedAt
    );

    if (this.hasFTS5) {
      this.db.prepare("DELETE FROM memories_fts WHERE memory_id = ?").run(memory.id);
      this.db
        .prepare(`
        INSERT INTO memories_fts (memory_id, title, content)
        VALUES (?, ?, ?)
      `)
        .run(memory.id, memory.title, memory.content);
    }
  }

  getAllMemoriesWithEmbeddings(): MemoryRecord[] {
    const stmt = this.db.prepare(`
      SELECT id, memory_type as memoryType, modality, modal_type as modalType,
             b64_source as b64Source, title, content,
             metadata, embedding, embedding_model as embeddingModel,
             embedding_dimension as embeddingDimension,
             provider_type as providerType,
             created_at as createdAt, updated_at as updatedAt
      FROM memories WHERE embedding IS NOT NULL
    `);

    const rows = stmt.all() as any[];
    return rows.map((r) => ({
      ...r,
      providerType:
        r.providerType ||
        (r.embeddingModel?.includes("gemini") ? "cloud" : "local_llama"),
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      embedding: r.embedding ? bufferToFloat32(r.embedding) : undefined,
    }));
  }

  setMeta(key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    stmt.run(key, value);
  }

  getMeta(key: string): string | null {
    try {
      const stmt = this.db.prepare("SELECT value FROM meta WHERE key = ?");
      const row = stmt.get(key) as any;
      return row ? row.value : null;
    } catch (e) {
      return null;
    }
  }

  setIndexManifest(manifest: {
    providerType: string;
    modelName: string;
    dimensions: number;
    updatedAt?: number;
  }): void {
    this.setMeta("index_manifest", JSON.stringify(manifest));
  }

  getIndexManifest(): {
    providerType: string;
    modelName: string;
    dimensions: number;
    updatedAt?: number;
  } | null {
    const raw = this.getMeta("index_manifest");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  insertRelation(relation: MemoryRelation) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO relations (
        id, from_id, relation, to_id, source, weight, confidence, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      relation.id,
      relation.fromId,
      relation.relation,
      relation.toId,
      relation.source,
      relation.weight,
      relation.confidence || 1.0,
      relation.metadata ? JSON.stringify(relation.metadata) : null,
      relation.createdAt
    );
  }

  getAllRelations(): MemoryRelation[] {
    const stmt = this.db.prepare(`
      SELECT id, from_id as fromId, relation, to_id as toId,
             source, weight, confidence, metadata, created_at as createdAt
      FROM relations
    `);
    const rows = stmt.all() as any[];
    return rows.map((r) => ({
      ...r,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  }

  getRelationsForNode(nodeId: string): MemoryRelation[] {
    const stmt = this.db.prepare(`
      SELECT id, from_id as fromId, relation, to_id as toId,
             source, weight, confidence, metadata, created_at as createdAt
      FROM relations WHERE from_id = ? OR to_id = ?
    `);

    const rows = stmt.all(nodeId, nodeId) as any[];
    return rows.map((r) => ({
      ...r,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  }

  getStats(): IndexStats {
    const filesCount =
      (this.db.prepare("SELECT COUNT(*) as count FROM files").get() as any)?.count || 0;
    const chunksCount =
      (this.db.prepare("SELECT COUNT(*) as count FROM chunks").get() as any)?.count || 0;
    const memoriesCount =
      (this.db.prepare("SELECT COUNT(*) as count FROM memories").get() as any)?.count || 0;
    const relationsCount =
      (this.db.prepare("SELECT COUNT(*) as count FROM relations").get() as any)?.count || 0;
    const lastIndexedAt =
      (this.db.prepare("SELECT MAX(indexed_at) as max FROM files").get() as any)?.max || 0;

    return {
      filesCount,
      chunksCount,
      memoriesCount,
      relationsCount,
      lastIndexedAt,
      dbSizeBytes: 0,
    };
  }

  close() {
    this.db.close();
  }
}
