import { ChunkRecord } from "../core/types";
import { computeSha256 } from "./code";

export class TextChunker {
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

    const flush = (endLine: number) => {
      if (currentChunk.length === 0) return;
      const text = currentChunk.join("\n").trim();
      if (!text) return;

      const formatted = `// File: ${filepath}\n\n${text}`;
      chunks.push({
        id: `chunk_${fileId}_${chunkIndex++}`,
        fileId,
        chunkIndex,
        content: formatted,
        contentHash: computeSha256(formatted),
        sourceType: "text",
        modalType: "text",
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
      currentChunk.push(lines[i]);
      if (currentChunk.length >= 60) {
        flush(i + 1);
        startLine = i + 2;
      }
    }

    flush(lines.length);
    return chunks;
  }
}
