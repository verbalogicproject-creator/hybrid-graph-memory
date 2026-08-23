import { ChunkRecord, MemoryRelation } from "../core/types";
import { computeSha256 } from "./code";

export interface ParsedCtxResult {
  chunks: ChunkRecord[];
  relations: MemoryRelation[];
}

export class CtxChunker {
  parse(
    filepath: string,
    content: string,
    fileId: string,
    modelName: string,
    dimensions: number
  ): ParsedCtxResult {
    const lines = content.split("\n");
    const chunks: ChunkRecord[] = [];
    const relations: MemoryRelation[] = [];
    const now = Date.now();

    let chunkIndex = 0;
    let relIndex = 0;

    let inBlock = false;
    let blockType = "";
    let blockName = "";
    let blockLines: string[] = [];
    let startLine = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Relation parsing
      const relMatch = trimmed.match(/^@relation\s+([A-Za-z0-9_.-]+)\s+([A-Za-z0-9_.-]+)\s+([A-Za-z0-9_.-]+)(?:\s+\(weight=([0-9.]+)\))?/);
      if (relMatch) {
        const fromId = relMatch[1];
        const relation = relMatch[2];
        const toId = relMatch[3];
        const weight = relMatch[4] ? parseFloat(relMatch[4]) : 1.0;

        relations.push({
          id: `rel_${fileId}_${relIndex++}`,
          fromId,
          relation,
          toId,
          source: filepath,
          weight,
          confidence: 1.0,
          createdAt: now,
        });
      }

      // Block tag parsing
      const blockStartMatch = trimmed.match(/^@(component|module|concept|decision|invariant|store)\s+([A-Za-z0-9_.-]+)\s*\{/);
      if (blockStartMatch) {
        if (inBlock) {
          const body = blockLines.join("\n");
          const formatted = `Architecture Context [${blockType}]: ${blockName}\n\n${body}`;
          chunks.push({
            id: `chunk_${fileId}_${chunkIndex++}`,
            fileId,
            chunkIndex,
            content: formatted,
            contentHash: computeSha256(formatted),
            sourceType: "architecture",
            modalType: "text",
            symbolName: blockName,
            symbolKind: blockType,
            startLine,
            endLine: i,
            embeddingModel: modelName,
            embeddingDimension: dimensions,
            createdAt: now,
            updatedAt: now,
          });
        }

        inBlock = true;
        blockType = blockStartMatch[1];
        blockName = blockStartMatch[2];
        blockLines = [];
        startLine = i + 1;
        continue;
      }

      if (inBlock) {
        if (trimmed === "}") {
          inBlock = false;
          const body = blockLines.join("\n");
          const formatted = `Architecture Context [${blockType}]: ${blockName}\n\n${body}`;
          chunks.push({
            id: `chunk_${fileId}_${chunkIndex++}`,
            fileId,
            chunkIndex,
            content: formatted,
            contentHash: computeSha256(formatted),
            sourceType: "architecture",
            modalType: "text",
            symbolName: blockName,
            symbolKind: blockType,
            startLine,
            endLine: i + 1,
            embeddingModel: modelName,
            embeddingDimension: dimensions,
            createdAt: now,
            updatedAt: now,
          });
          blockLines = [];
        } else {
          blockLines.push(line);
        }
      }
    }

    return { chunks, relations };
  }
}
