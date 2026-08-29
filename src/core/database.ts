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
import { tokenizeQuery } from "./text";

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

  runInTransaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Preserve the original failure; rollback diagnostics must not mask it.
      }
      throw error;
    }
  }

  private parseStoredJson<T>(
    table: "chunks" | "memories",
    row: any,
    column: string,
    raw: unknown,
    fallback: T
  ): T {
    if (raw === null || raw === undefined || raw === "") return fallback;
    try {
      return JSON.parse(String(raw)) as T;
    } catch {
      const reason = `Malformed stored JSON in ${column}`;
      this.db.prepare(
        `UPDATE ${table} SET admission_status = 'quarantined', quarantine_reason = ? WHERE id = ?`
      ).run(reason, row.id);
      row.admissionStatus = "quarantined";
      row.quarantineReason = reason;
      return fallback;
    }
  }

  private parseRelationMetadata(row: any): Record<string, unknown> | undefined {
    if (!row.metadata) return undefined;
    try {
      return JSON.parse(String(row.metadata));
    } catch {
      console.warn(`[memory] Relation ${row.id} has malformed metadata and was ignored.`);
      return undefined;
    }
  }

  private prepareStoredRow(table: "chunks" | "memories", row: any): any {
    row.triggerTags = this.parseStoredJson(table, row, "trigger_tags", row.triggerTags, []);
    row.assetSpec = this.parseStoredJson(table, row, "asset_spec", row.assetSpec, undefined);
    if (table === "memories") {
      row.metadata = this.parseStoredJson(table, row, "metadata", row.metadata, undefined);
    }
    return row;
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
        origin TEXT NOT NULL DEFAULT 'legacy_unknown',
        admission_status TEXT NOT NULL DEFAULT 'candidate',
        model_name TEXT,
        model_version TEXT,
        model_checksum TEXT,
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
      this.db.exec("ALTER TABLE relations ADD COLUMN origin TEXT NOT NULL DEFAULT 'legacy_unknown';");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE relations ADD COLUMN admission_status TEXT NOT NULL DEFAULT 'candidate';");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE relations ADD COLUMN model_name TEXT;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE relations ADD COLUMN model_version TEXT;");
    } catch (e) {}
    try {
      this.db.exec("ALTER TABLE relations ADD COLUMN model_checksum TEXT;");
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

  /** True when the FTS5 virtual tables were created in this SQLite build. */
  get ftsAvailable(): boolean {
    return this.hasFTS5;
  }

  /**
   * Turns arbitrary user text into a safe FTS5 MATCH expression.
   *
   * The query string is never interpolated: every term is stripped to word
   * characters and wrapped in double quotes, so FTS5 operators a user might type
   * (`AND`, `OR`, `NOT`, `NEAR`, `*`, `^`, `:`, parentheses, quotes) are treated
   * as literal text rather than syntax. Returns null when nothing searchable
   * survives, so callers skip MATCH entirely instead of issuing an empty query.
   */
  private buildFtsMatchExpression(query: string): string | null {
    // Shares `tokenizeQuery` with the lexical scorer deliberately. When the two
    // disagreed, this side matched function words the scorer discarded, so a
    // content-free query ("of in on at by") still produced FTS hits and satisfied
    // the disambiguation gate's lexical anchor. Stop words also carry no BM25
    // weight, so dropping them costs no ranking quality.
    const terms = Array.from(new Set(tokenizeQuery(query))).slice(0, 32);

    if (terms.length === 0) return null;
    return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(" OR ");
  }

  /**
   * Ranks chunk ids by FTS5 BM25 relevance, best first.
   *
   * Column weights preserve the emphasis the in-memory scorer used before this
   * arm existed: a symbol hit outweighs a heading hit, which outweighs body
   * text. Returns null when FTS5 is unavailable so the caller can fall back to
   * scanning rather than silently returning no lexical evidence.
   *
   * Namespace filtering is deliberately NOT done here: strict and federated
   * scoping live in one place in the retriever, and duplicating that logic in
   * SQL is how isolation regressions get introduced. Callers over-fetch and
   * filter.
   */
  searchChunksLexical(
    query: string,
    limit: number
  ): Array<{ id: string; score: number }> | null {
    if (!this.hasFTS5) return null;
    const match = this.buildFtsMatchExpression(query);
    if (!match) return [];

    try {
      const rows = this.db
        .prepare(`
          SELECT chunk_id as id, -bm25(chunks_fts, 0.0, 0.0, 1.0, 3.0, 2.0) as score
          FROM chunks_fts
          WHERE chunks_fts MATCH ?
          ORDER BY score DESC
          LIMIT ?
        `)
        .all(match, Math.max(1, Math.floor(limit))) as Array<{ id: string; score: number }>;
      return rows.filter((row) => typeof row.id === "string" && Number.isFinite(row.score));
    } catch {
      // A malformed match expression or a missing table must degrade to the
      // scanning fallback, never take down retrieval.
      return null;
    }
  }

  /** Ranks memory ids by FTS5 BM25 relevance, best first. See searchChunksLexical. */
  searchMemoriesLexical(
    query: string,
    limit: number
  ): Array<{ id: string; score: number }> | null {
    if (!this.hasFTS5) return null;
    const match = this.buildFtsMatchExpression(query);
    if (!match) return [];

    try {
      const rows = this.db
        .prepare(`
          SELECT memory_id as id, -bm25(memories_fts, 0.0, 2.0, 1.0) as score
          FROM memories_fts
          WHERE memories_fts MATCH ?
          ORDER BY score DESC
          LIMIT ?
        `)
        .all(match, Math.max(1, Math.floor(limit))) as Array<{ id: string; score: number }>;
      return rows.filter((row) => typeof row.id === "string" && Number.isFinite(row.score));
    } catch {
      return null;
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
      ...this.prepareStoredRow("chunks", r),
      providerType:
        r.providerType ||
        (r.embeddingModel?.includes("gemini") ? "cloud" : "local_llama"),
      workspace: r.workspace || "default",
      project: r.project || "default",
      module: r.module || "root",
      admissionStatus: r.admissionStatus || "admitted",
      triggerTags: r.triggerTags,
      assetSpec: r.assetSpec,
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
      ...this.prepareStoredRow("chunks", r),
      providerType:
        r.providerType ||
        (r.embeddingModel?.includes("gemini") ? "cloud" : "local_llama"),
      workspace: r.workspace || "default",
      project: r.project || "default",
      module: r.module || "root",
      admissionStatus: r.admissionStatus || "admitted",
      triggerTags: r.triggerTags,
      assetSpec: r.assetSpec,
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
      ...this.prepareStoredRow("memories", r),
      providerType:
        r.providerType ||
        (r.embeddingModel?.includes("gemini") ? "cloud" : "local_llama"),
      workspace: r.workspace || "default",
      project: r.project || "default",
      module: r.module || "root",
      admissionStatus: r.admissionStatus || "admitted",
      triggerTags: r.triggerTags,
      assetSpec: r.assetSpec,
      lastAccessedAt: r.lastAccessedAt || 0,
      accessCount: r.accessCount || 0,
      metadata: r.metadata,
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
      ...this.prepareStoredRow("memories", r),
      workspace: r.workspace || "default",
      project: r.project || "default",
      module: r.module || "root",
      admissionStatus: r.admissionStatus || "admitted",
      triggerTags: r.triggerTags,
      assetSpec: r.assetSpec,
      lastAccessedAt: r.lastAccessedAt || 0,
      accessCount: r.accessCount || 0,
      metadata: r.metadata,
      embedding: r.embedding ? bufferToFloat32(r.embedding) : undefined,
    };
  }

  updateOperationalAssetAdmission(
    id: string,
    status: AdmissionStatus,
    reviewedBy: string,
    reasonOrNotes?: string
  ): boolean {
    if (!reviewedBy.trim()) return false;
    if ((status === "quarantined" || status === "rejected") && !reasonOrNotes?.trim()) {
      return false;
    }
    const now = Date.now();
    const allowedCurrentStates = status === "admitted"
      ? "AND admission_status = 'candidate'"
      : "AND admission_status IN ('candidate', 'admitted')";
    const stmt = this.db.prepare(`
      UPDATE memories
      SET admission_status = ?,
          reviewed_by = ?,
          reviewed_at = ?,
          quarantine_reason = ?,
          updated_at = ?
      WHERE id = ?
        AND memory_type IN ('prompt', 'workflow', 'skill', 'rule')
        ${allowedCurrentStates}
    `);
    const result = stmt.run(
      status,
      reviewedBy.trim(),
      now,
      reasonOrNotes?.trim() || null,
      now,
      id
    );
    return result.changes === 1;
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
      ...this.prepareStoredRow("memories", r),
      workspace: r.workspace || "default",
      project: r.project || "default",
      module: r.module || "root",
      admissionStatus: r.admissionStatus || "admitted",
      triggerTags: r.triggerTags,
      assetSpec: r.assetSpec,
      lastAccessedAt: r.lastAccessedAt || 0,
      accessCount: r.accessCount || 0,
      metadata: r.metadata,
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
      ...this.prepareStoredRow("memories", r),
      workspace: r.workspace || "default",
      project: r.project || "default",
      module: r.module || "root",
      admissionStatus: r.admissionStatus || "admitted",
      triggerTags: r.triggerTags,
      assetSpec: r.assetSpec,
      lastAccessedAt: r.lastAccessedAt || 0,
      accessCount: r.accessCount || 0,
      metadata: r.metadata,
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Corrupt index_manifest metadata: ${message}`);
    }
  }

  insertRelation(relation: MemoryRelation) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO relations (
        id, from_id, relation, to_id, source, weight, confidence, metadata,
        workspace, project, module, origin, admission_status,
        model_name, model_version, model_checksum, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      relation.origin || "legacy_unknown",
      relation.admissionStatus || "candidate",
      relation.modelName || null,
      relation.modelVersion || null,
      relation.modelChecksum || null,
      relation.createdAt
    );
  }

  getAllRelations(options?: {
    workspace?: string;
    project?: string;
    includeInferredRelations?: boolean;
  }): MemoryRelation[] {
    let query = `
      SELECT id, from_id as fromId, relation, to_id as toId,
             source, weight, confidence, metadata,
             workspace, project, module, origin,
             admission_status as admissionStatus,
             model_name as modelName, model_version as modelVersion,
             model_checksum as modelChecksum, created_at as createdAt
      FROM relations
    `;
    const params: any[] = [];
    const conditions: string[] = [];
    if (!options?.includeInferredRelations) {
      conditions.push("origin IN ('declared', 'observed_ast')");
      conditions.push("admission_status = 'admitted'");
    }
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
      metadata: this.parseRelationMetadata(r),
    }));
  }

  getRelationsForNode(nodeId: string, options?: {
    workspace?: string;
    project?: string;
    includeInferredRelations?: boolean;
  }): MemoryRelation[] {
    let query = `
      SELECT id, from_id as fromId, relation, to_id as toId,
             source, weight, confidence, metadata,
             workspace, project, module, origin,
             admission_status as admissionStatus,
             model_name as modelName, model_version as modelVersion,
             model_checksum as modelChecksum, created_at as createdAt
      FROM relations WHERE (from_id = ? OR to_id = ?)
    `;
    const params: any[] = [nodeId, nodeId];
    if (!options?.includeInferredRelations) {
      query += " AND origin IN ('declared', 'observed_ast') AND admission_status = 'admitted'";
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
      metadata: this.parseRelationMetadata(r),
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

  getVisualizationDescriptions(): Array<{ id: string; description: string }> {
    const rows = this.db.prepare(`
      SELECT file_id as fileId, symbol_name as symbolName, substr(content, 1, 300) as description
      FROM chunks
      WHERE admission_status = 'admitted'
      ORDER BY id
    `).all() as any[];
    const descriptions = new Map<string, string>();
    for (const row of rows) {
      const id = row.symbolName || row.fileId;
      if (id && !descriptions.has(id)) descriptions.set(id, String(row.description || ""));
    }
    return Array.from(descriptions, ([id, description]) => ({ id, description }));
  }

  close() {
    this.db.close();
  }
  // --- Legacy evidence references ---
  // Historical rows are retained for compatibility only. Fractal Memory does
  // not create, upgrade, or interpret them as SAG receipts.

  insertReceipt(receipt: import('./types').ReceiptRecord) {
    void receipt;
    throw new Error('Legacy evidence references are read-only in Fractal Memory; use SAG/Fractal Runtime for receipts.');
    /* Historical write path deliberately disabled.
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
    ); */
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

  /**
   * Executes the cross-database intelligence federation.
   * Attaches the global hive SQLite file, scrubs PII/Secrets, and writes heuristic records.
   */
  consolidateToGlobalHive(): { scrubbed: number } {
    throw new Error(
      "Global-hive export is disabled until an allowlisted export schema and adversarial privacy suite are approved."
    );
    /* Historical unsafe implementation retained temporarily for migration reference.
    const os = require("os");
    const globalHiveDir = path.join(os.homedir(), ".antigravity");
    if (!fs.existsSync(globalHiveDir)) {
      fs.mkdirSync(globalHiveDir, { recursive: true });
    }
    const globalHivePath = path.join(globalHiveDir, "global-hive.db");

    // Fetch all local heuristics
    const heuristics = this.getReceipts();
    if (heuristics.length === 0) return { scrubbed: 0 };

    // Attach external DB natively in SQLite
    this.db.exec(`ATTACH DATABASE '${globalHivePath}' AS global_hive`);
    
    // Ensure table exists in global hive
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS global_hive.heuristics (
        id TEXT PRIMARY KEY,
        incident_type TEXT,
        level TEXT,
        patch_hash TEXT,
        b64_evidence TEXT,
        target_framework TEXT,
        created_at INTEGER
      )
    `);

    let scrubbedCount = 0;
    const insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO global_hive.heuristics 
      (id, incident_type, level, patch_hash, b64_evidence, target_framework, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.transaction(() => {
      for (const record of heuristics) {
        // PII & Secrets Scrubber (Regex)
        // Redact IP addresses, API Keys (sk-...), and absolute file paths
        let scrubbedIncident = record.incidentType
          ? record.incidentType.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[REDACTED_IP]")
                               .replace(/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED_KEY]")
                               .replace(/(?:\/[a-zA-Z0-9_-]+){2,}/g, "[REDACTED_PATH]")
          : "";

        insertStmt.run(
          record.id,
          scrubbedIncident,
          record.level,
          record.patchHash,
          record.b64Evidence,
          record.targetFramework,
          record.createdAt
        );
        scrubbedCount++;
      }
    })();

    this.db.exec(`DETACH DATABASE global_hive`);
    
    return { scrubbed: scrubbedCount }; */
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
