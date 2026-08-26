import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  AdmissionStatus,
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

    try {
      this.db.exec("ALTER TABLE files ADD COLUMN commit_hash TEXT;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE files ADD COLUMN workspace TEXT DEFAULT 'default';");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE files ADD COLUMN project TEXT DEFAULT 'default';");
    } catch (e) {}

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
    `);

    try {
      this.db.exec("ALTER TABLE chunks ADD COLUMN symbol_name TEXT;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE chunks ADD COLUMN symbol_kind TEXT;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE chunks ADD COLUMN heading TEXT;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE chunks ADD COLUMN start_line INTEGER;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE chunks ADD COLUMN end_line INTEGER;");
    } catch (e) {}
    try {
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id);");
    } catch (e) {}
    try {
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_chunks_symbol ON chunks(symbol_name);");
    } catch (e) {}
    try {
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_chunks_heading ON chunks(heading);");
    } catch (e) {}

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
      this.db.exec("ALTER TABLE chunks ADD COLUMN commit_hash TEXT;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE chunks ADD COLUMN workspace TEXT DEFAULT 'default';");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE chunks ADD COLUMN project TEXT DEFAULT 'default';");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE chunks ADD COLUMN module TEXT DEFAULT 'root';");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE chunks ADD COLUMN last_accessed_at INTEGER DEFAULT 0;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE chunks ADD COLUMN access_count INTEGER DEFAULT 0;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE chunks ADD COLUMN trigger_tags TEXT;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE chunks ADD COLUMN admission_status TEXT DEFAULT 'admitted';");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE chunks ADD COLUMN target_framework TEXT;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE chunks ADD COLUMN author TEXT;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE chunks ADD COLUMN source_doc TEXT;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE chunks ADD COLUMN reviewed_by TEXT;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE chunks ADD COLUMN reviewed_at INTEGER;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE chunks ADD COLUMN quarantine_reason TEXT;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE chunks ADD COLUMN asset_spec TEXT;");
    } catch (e) {}
    try {
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_chunks_modal ON chunks(modal_type);");
    } catch (e) {}
    try {
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_chunks_ns ON chunks(workspace, project, module);");
    } catch (e) {}
    try {
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_chunks_access ON chunks(last_accessed_at);");
    } catch (e) {}
    try {
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_chunks_trigger ON chunks(trigger_tags);");
    } catch (e) {}
    try {
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_chunks_admission ON chunks(admission_status);");
    } catch (e) {}
    try {
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_chunks_target_fw ON chunks(target_framework);");
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
      this.db.exec("ALTER TABLE chunks ADD COLUMN is_quarantined INTEGER DEFAULT 0;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE memories ADD COLUMN is_quarantined INTEGER DEFAULT 0;");
    } catch (e) {}

    // 3.5. Receipts table (SAG Incidents & Causal Memory)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS receipts (
        id TEXT PRIMARY KEY,
        incident_type TEXT NOT NULL,
        level TEXT NOT NULL,
        patch_hash TEXT,
        b64_evidence TEXT,
        target_framework TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_receipts_incident ON receipts(incident_type);
    `);

    try {
      this.db.exec("ALTER TABLE memories ADD COLUMN b64_source TEXT;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE memories ADD COLUMN provider_type TEXT;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE memories ADD COLUMN commit_hash TEXT;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE memories ADD COLUMN workspace TEXT DEFAULT 'default';");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE memories ADD COLUMN project TEXT DEFAULT 'default';");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE memories ADD COLUMN module TEXT DEFAULT 'root';");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE memories ADD COLUMN trigger_tags TEXT;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE memories ADD COLUMN last_accessed_at INTEGER DEFAULT 0;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE memories ADD COLUMN access_count INTEGER DEFAULT 0;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE memories ADD COLUMN admission_status TEXT DEFAULT 'admitted';");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE memories ADD COLUMN target_framework TEXT;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE memories ADD COLUMN author TEXT;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE memories ADD COLUMN source_doc TEXT;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE memories ADD COLUMN reviewed_by TEXT;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE memories ADD COLUMN reviewed_at INTEGER;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE memories ADD COLUMN quarantine_reason TEXT;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE memories ADD COLUMN asset_spec TEXT;");
    } catch (e) {}
    try {
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_memories_modal ON memories(modal_type);");
    } catch (e) {}
    try {
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_memories_ns ON memories(workspace, project, module);");
    } catch (e) {}
    try {
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_memories_access ON memories(last_accessed_at);");
    } catch (e) {}
    try {
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_memories_admission ON memories(admission_status);");
    } catch (e) {}
    try {
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_memories_target_fw ON memories(target_framework);");
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

    try {
      this.db.exec("ALTER TABLE relations ADD COLUMN workspace TEXT DEFAULT 'default';");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE relations ADD COLUMN project TEXT DEFAULT 'default';");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE relations ADD COLUMN module TEXT DEFAULT 'root';");
    } catch (e) {}
    try {
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_rel_ns ON relations(workspace, project);");
    } catch (e) {}

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
      INSERT INTO files (
        id, filepath, file_type, content_hash, commit_hash, workspace, project,
        mtime, size, indexed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(filepath) DO UPDATE SET
        content_hash = excluded.content_hash,
        commit_hash = excluded.commit_hash,
        workspace = excluded.workspace,
        project = excluded.project,
        mtime = excluded.mtime,
        size = excluded.size,
        indexed_at = excluded.indexed_at
    `);
    stmt.run(
      file.id,
      file.filepath,
      file.fileType,
      file.contentHash,
      file.commitHash || null,
      file.workspace || "default",
      file.project || "default",
      file.mtime,
      file.size,
      file.indexedAt
    );
  }

  getFileByPath(filepath: string): FileRecord | null {
    const stmt = this.db.prepare(`
      SELECT id, filepath, file_type as fileType, content_hash as contentHash,
             commit_hash as commitHash, workspace, project,
             mtime, size, indexed_at as indexedAt
      FROM files WHERE filepath = ?
    `);
    const row = stmt.get(filepath) as any;
    return row || null;
  }

  getAllFiles(): FileRecord[] {
    const stmt = this.db.prepare(`
      SELECT id, filepath, file_type as fileType, content_hash as contentHash,
             commit_hash as commitHash, workspace, project,
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
        embedding, embedding_model, embedding_dimension, provider_type,
        commit_hash, workspace, project, module, trigger_tags,
        admission_status, target_framework, author, source_doc,
        reviewed_by, reviewed_at, quarantine_reason, asset_spec,
        last_accessed_at, access_count,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      chunk.commitHash || null,
      chunk.workspace || "default",
      chunk.project || "default",
      chunk.module || "root",
      chunk.triggerTags ? JSON.stringify(chunk.triggerTags) : null,
      chunk.admissionStatus || "admitted",
      chunk.targetFramework || null,
      chunk.author || null,
      chunk.sourceDoc || null,
      chunk.reviewedBy || null,
      chunk.reviewedAt || null,
      chunk.quarantineReason || null,
      chunk.assetSpec ? JSON.stringify(chunk.assetSpec) : null,
      chunk.lastAccessedAt || 0,
      chunk.accessCount || 0,
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
             commit_hash as commitHash, workspace, project, module,
             trigger_tags as triggerTags,
             admission_status as admissionStatus,
             target_framework as targetFramework,
             author, source_doc as sourceDoc,
             reviewed_by as reviewedBy, reviewed_at as reviewedAt,
             quarantine_reason as quarantineReason,
             asset_spec as assetSpec,
             last_accessed_at as lastAccessedAt, access_count as accessCount,
             created_at as createdAt, updated_at as updatedAt
      FROM chunks WHERE file_id = ? ORDER BY chunk_index ASC
    `);

    const rows = stmt.all(fileId) as any[];
    return rows.map((r) => ({
      ...r,
      providerType:
        r.providerType ||
        (r.embeddingModel?.includes("gemini") ? "cloud" : "local_llama"),
      workspace: r.workspace || "default",
      project: r.project || "default",
      module: r.module || "root",
      admissionStatus: r.admissionStatus || "admitted",
      triggerTags: r.triggerTags ? JSON.parse(r.triggerTags) : [],
      assetSpec: r.assetSpec ? JSON.parse(r.assetSpec) : undefined,
      lastAccessedAt: r.lastAccessedAt || 0,
      accessCount: r.accessCount || 0,
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
             c.commit_hash as commitHash, c.workspace, c.project, c.module,
             c.trigger_tags as triggerTags,
             c.admission_status as admissionStatus,
             c.target_framework as targetFramework,
             c.author, c.source_doc as sourceDoc,
             c.reviewed_by as reviewedBy, c.reviewed_at as reviewedAt,
             c.quarantine_reason as quarantineReason,
             c.asset_spec as assetSpec,
             c.last_accessed_at as lastAccessedAt, c.access_count as accessCount,
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
      workspace: r.workspace || "default",
      project: r.project || "default",
      module: r.module || "root",
      admissionStatus: r.admissionStatus || "admitted",
      triggerTags: r.triggerTags ? JSON.parse(r.triggerTags) : [],
      assetSpec: r.assetSpec ? JSON.parse(r.assetSpec) : undefined,
      lastAccessedAt: r.lastAccessedAt || 0,
      accessCount: r.accessCount || 0,
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
        embedding, embedding_model, embedding_dimension, provider_type,
        commit_hash, workspace, project, module, trigger_tags,
        admission_status, target_framework, author, source_doc,
        reviewed_by, reviewed_at, quarantine_reason, asset_spec,
        last_accessed_at, access_count,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      memory.commitHash || null,
      memory.workspace || "default",
      memory.project || "default",
      memory.module || "root",
      memory.triggerTags ? JSON.stringify(memory.triggerTags) : null,
      memory.admissionStatus || "admitted",
      memory.targetFramework || null,
      memory.author || null,
      memory.sourceDoc || null,
      memory.reviewedBy || null,
      memory.reviewedAt || null,
      memory.quarantineReason || null,
      memory.assetSpec ? JSON.stringify(memory.assetSpec) : null,
      memory.lastAccessedAt || 0,
      memory.accessCount || 0,
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
             commit_hash as commitHash, workspace, project, module,
             trigger_tags as triggerTags,
             admission_status as admissionStatus,
             target_framework as targetFramework,
             author, source_doc as sourceDoc,
             reviewed_by as reviewedBy, reviewed_at as reviewedAt,
             quarantine_reason as quarantineReason,
             asset_spec as assetSpec,
             last_accessed_at as lastAccessedAt, access_count as accessCount,
             created_at as createdAt, updated_at as updatedAt
      FROM memories WHERE embedding IS NOT NULL
    `);

    const rows = stmt.all() as any[];
    return rows.map((r) => ({
      ...r,
      providerType:
        r.providerType ||
        (r.embeddingModel?.includes("gemini") ? "cloud" : "local_llama"),
      workspace: r.workspace || "default",
      project: r.project || "default",
      module: r.module || "root",
      admissionStatus: r.admissionStatus || "admitted",
      triggerTags: r.triggerTags ? JSON.parse(r.triggerTags) : [],
      assetSpec: r.assetSpec ? JSON.parse(r.assetSpec) : undefined,
      lastAccessedAt: r.lastAccessedAt || 0,
      accessCount: r.accessCount || 0,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      embedding: r.embedding ? bufferToFloat32(r.embedding) : undefined,
    }));
  }

  getOperationalAssetById(id: string): MemoryRecord | null {
    const stmt = this.db.prepare(`
      SELECT id, memory_type as memoryType, modality, modal_type as modalType,
             b64_source as b64Source, title, content,
             metadata, embedding, embedding_model as embeddingModel,
             embedding_dimension as embeddingDimension,
             provider_type as providerType,
             commit_hash as commitHash, workspace, project, module,
             trigger_tags as triggerTags,
             admission_status as admissionStatus,
             target_framework as targetFramework,
             author, source_doc as sourceDoc,
             reviewed_by as reviewedBy, reviewed_at as reviewedAt,
             quarantine_reason as quarantineReason,
             asset_spec as assetSpec,
             last_accessed_at as lastAccessedAt, access_count as accessCount,
             created_at as createdAt, updated_at as updatedAt
      FROM memories
      WHERE id = ?
    `);
    const r = stmt.get(id) as any;
    if (!r) return null;
    return {
      ...r,
      workspace: r.workspace || "default",
      project: r.project || "default",
      module: r.module || "root",
      admissionStatus: r.admissionStatus || "admitted",
      triggerTags: r.triggerTags ? JSON.parse(r.triggerTags) : [],
      assetSpec: r.assetSpec ? JSON.parse(r.assetSpec) : undefined,
      lastAccessedAt: r.lastAccessedAt || 0,
      accessCount: r.accessCount || 0,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      embedding: r.embedding ? bufferToFloat32(r.embedding) : undefined,
    };
  }

  updateOperationalAssetAdmission(
    id: string,
    status: AdmissionStatus,
    reviewedBy: string,
    reasonOrNotes?: string
  ): boolean {
    try {
      const now = Date.now();
      const stmt = this.db.prepare(`
        UPDATE memories
        SET admission_status = ?,
            reviewed_by = ?,
            reviewed_at = ?,
            quarantine_reason = ?,
            updated_at = ?
        WHERE id = ?
      `);
      stmt.run(status, reviewedBy, now, reasonOrNotes || null, now, id);
      return true;
    } catch (e) {
      return false;
    }
  }

  listOperationalAssets(options?: {
    status?: AdmissionStatus;
    workspace?: string;
    project?: string;
  }): MemoryRecord[] {
    let query = `
      SELECT id, memory_type as memoryType, modality, modal_type as modalType,
             b64_source as b64Source, title, content,
             metadata, embedding, embedding_model as embeddingModel,
             embedding_dimension as embeddingDimension,
             provider_type as providerType,
             commit_hash as commitHash, workspace, project, module,
             trigger_tags as triggerTags,
             admission_status as admissionStatus,
             target_framework as targetFramework,
             author, source_doc as sourceDoc,
             reviewed_by as reviewedBy, reviewed_at as reviewedAt,
             quarantine_reason as quarantineReason,
             asset_spec as assetSpec,
             last_accessed_at as lastAccessedAt, access_count as accessCount,
             created_at as createdAt, updated_at as updatedAt
      FROM memories
      WHERE memory_type IN ('prompt', 'workflow', 'skill', 'rule')
    `;
    const params: any[] = [];
    if (options?.status) {
      query += " AND admission_status = ?";
      params.push(options.status);
    }
    if (options?.workspace) {
      query += " AND workspace = ?";
      params.push(options.workspace);
    }
    if (options?.project) {
      query += " AND project = ?";
      params.push(options.project);
    }
    query += " ORDER BY created_at DESC";

    const stmt = this.db.prepare(query);
    const rows = (params.length > 0 ? stmt.all(...params) : stmt.all()) as any[];
    return rows.map((r) => ({
      ...r,
      workspace: r.workspace || "default",
      project: r.project || "default",
      module: r.module || "root",
      admissionStatus: r.admissionStatus || "admitted",
      triggerTags: r.triggerTags ? JSON.parse(r.triggerTags) : [],
      assetSpec: r.assetSpec ? JSON.parse(r.assetSpec) : undefined,
      lastAccessedAt: r.lastAccessedAt || 0,
      accessCount: r.accessCount || 0,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      embedding: r.embedding ? bufferToFloat32(r.embedding) : undefined,
    }));
  }

  getOperationalAssetsByTrigger(
    triggerTag: string,
    options?: {
      workspace?: string;
      project?: string;
      filterAdmissionStatuses?: AdmissionStatus[];
      includeCandidates?: boolean;
    }
  ): MemoryRecord[] {
    let query = `
      SELECT id, memory_type as memoryType, modality, modal_type as modalType,
             b64_source as b64Source, title, content,
             metadata, embedding, embedding_model as embeddingModel,
             embedding_dimension as embeddingDimension,
             provider_type as providerType,
             commit_hash as commitHash, workspace, project, module,
             trigger_tags as triggerTags,
             admission_status as admissionStatus,
             target_framework as targetFramework,
             author, source_doc as sourceDoc,
             reviewed_by as reviewedBy, reviewed_at as reviewedAt,
             quarantine_reason as quarantineReason,
             asset_spec as assetSpec,
             last_accessed_at as lastAccessedAt, access_count as accessCount,
             created_at as createdAt, updated_at as updatedAt
      FROM memories
      WHERE trigger_tags LIKE ?
    `;
    const params: any[] = [`%${triggerTag}%`];

    if (options?.filterAdmissionStatuses && options.filterAdmissionStatuses.length > 0) {
      const placeholders = options.filterAdmissionStatuses.map(() => "?").join(", ");
      query += ` AND admission_status IN (${placeholders})`;
      params.push(...options.filterAdmissionStatuses);
    } else if (options?.includeCandidates) {
      query += " AND admission_status IN ('admitted', 'candidate')";
    } else {
      // By default: admission gate strictly enforces 'admitted' assets only!
      query += " AND admission_status = 'admitted'";
    }

    if (options?.workspace) {
      query += " AND workspace = ?";
      params.push(options.workspace);
    }
    if (options?.project) {
      query += " AND project = ?";
      params.push(options.project);
    }
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];
    return rows.map((r) => ({
      ...r,
      workspace: r.workspace || "default",
      project: r.project || "default",
      module: r.module || "root",
      admissionStatus: r.admissionStatus || "admitted",
      triggerTags: r.triggerTags ? JSON.parse(r.triggerTags) : [],
      assetSpec: r.assetSpec ? JSON.parse(r.assetSpec) : undefined,
      lastAccessedAt: r.lastAccessedAt || 0,
      accessCount: r.accessCount || 0,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      embedding: r.embedding ? bufferToFloat32(r.embedding) : undefined,
    }));
  }

  recordAccess(chunkIds: string[], memoryIds: string[] = []): void {
    const now = Date.now();
    for (const id of chunkIds) {
      try {
        this.db
          .prepare(
            "UPDATE chunks SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?"
          )
          .run(now, id);
      } catch (e) {}
    }
    for (const id of memoryIds) {
      try {
        this.db
          .prepare(
            "UPDATE memories SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?"
          )
          .run(now, id);
      } catch (e) {}
    }
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
        id, from_id, relation, to_id, source, weight, confidence, metadata,
        workspace, project, module, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      relation.workspace || "default",
      relation.project || "default",
      relation.module || "root",
      relation.createdAt
    );
  }

  getAllRelations(options?: { workspace?: string; project?: string }): MemoryRelation[] {
    let query = `
      SELECT id, from_id as fromId, relation, to_id as toId,
             source, weight, confidence, metadata,
             workspace, project, module, created_at as createdAt
      FROM relations
    `;
    const params: any[] = [];
    const conditions: string[] = [];
    if (options?.workspace) {
      conditions.push("workspace = ?");
      params.push(options.workspace);
    }
    if (options?.project) {
      conditions.push("project = ?");
      params.push(options.project);
    }
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }
    const stmt = this.db.prepare(query);
    const rows = (params.length > 0 ? stmt.all(...params) : stmt.all()) as any[];
    return rows.map((r) => ({
      ...r,
      workspace: r.workspace || "default",
      project: r.project || "default",
      module: r.module || "root",
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  }

  getRelationsForNode(nodeId: string, options?: { workspace?: string; project?: string }): MemoryRelation[] {
    let query = `
      SELECT id, from_id as fromId, relation, to_id as toId,
             source, weight, confidence, metadata,
             workspace, project, module, created_at as createdAt
      FROM relations WHERE (from_id = ? OR to_id = ?)
    `;
    const params: any[] = [nodeId, nodeId];
    if (options?.workspace) {
      query += " AND workspace = ?";
      params.push(options.workspace);
    }
    if (options?.project) {
      query += " AND project = ?";
      params.push(options.project);
    }
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];
    return rows.map((r) => ({
      ...r,
      workspace: r.workspace || "default",
      project: r.project || "default",
      module: r.module || "root",
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  }

  deleteRelationsBySource(sourceFilepath: string): void {
    try {
      this.db.prepare("DELETE FROM relations WHERE source = ?").run(sourceFilepath);
    } catch (e) {}
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
  // --- SAG Receipts (Causal Memory) ---

  insertReceipt(receipt: import('./types').ReceiptRecord) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO receipts (
        id, incident_type, level, patch_hash, b64_evidence, target_framework, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      receipt.id,
      receipt.incidentType,
      receipt.level,
      receipt.patchHash || null,
      receipt.b64Evidence || null,
      receipt.targetFramework || null,
      receipt.createdAt
    );
  }

  getReceipts(): import('./types').ReceiptRecord[] {
    const stmt = this.db.prepare(`
      SELECT id, incident_type as incidentType, level, patch_hash as patchHash,
             b64_evidence as b64Evidence, target_framework as targetFramework, created_at as createdAt
      FROM receipts
      ORDER BY created_at DESC
    `);
    return stmt.all() as any[];
  }

  getReceiptsByIncidentType(incidentType: string): import('./types').ReceiptRecord[] {
    const stmt = this.db.prepare(`
      SELECT id, incident_type as incidentType, level, patch_hash as patchHash,
             b64_evidence as b64Evidence, target_framework as targetFramework, created_at as createdAt
      FROM receipts
      WHERE incident_type = ?
      ORDER BY created_at DESC
    `);
    return stmt.all(incidentType) as any[];
  }
}

