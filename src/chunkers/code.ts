import crypto from "node:crypto";
import { ChunkRecord } from "../core/types";

export function computeSha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export class CodeChunker {
  chunk(
    filepath: string,
    content: string,
    fileId: string,
    modelName: string,
    dimensions: number
  ): ChunkRecord[] {
    const lines = content.split("\n");
    const chunks: ChunkRecord[] = [];
    const now = Date.now();

    let currentChunk: string[] = [];
    let startLine = 1;
    let chunkIndex = 0;
    let currentSymbol = "";
    let currentKind = "";

    const flush = (endLine: number) => {
      if (currentChunk.length === 0) return;
      const text = currentChunk.join("\n");
      const formatted = `// File: ${filepath}\n// Symbol: ${currentSymbol || "Module Scope"} (${currentKind || "code"})\n\n${text}`;
      
      chunks.push({
        id: `chunk_${fileId}_${chunkIndex++}`,
        fileId,
        chunkIndex,
        content: formatted,
        contentHash: computeSha256(formatted),
        sourceType: "code",
        modalType: "code",
        symbolName: currentSymbol || undefined,
        symbolKind: currentKind || "code_block",
        startLine,
        endLine,
        embeddingModel: modelName,
        embeddingDimension: dimensions,
        createdAt: now,
        updatedAt: now,
      });
      currentChunk = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const funcMatch = line.match(/(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/);
      const classMatch = line.match(/(?:export\s+)?class\s+([A-Za-z0-9_]+)/);
      const constMatch = line.match(/(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=/);

      if ((funcMatch || classMatch || constMatch) && currentChunk.length > 25) {
        flush(i);
        startLine = i + 1;
        currentSymbol = (funcMatch?.[1] || classMatch?.[1] || constMatch?.[1]) || "";
        currentKind = funcMatch ? "Function" : classMatch ? "Class" : "Constant";
      }

      currentChunk.push(line);

      if (currentChunk.length >= 80) {
        flush(i + 1);
        startLine = i + 2;
      }
    }

    flush(lines.length);
    return chunks;
  }
}
