import { ChunkRecord } from "../core/types";
import { computeSha256 } from "./code";

export class MarkdownChunker {
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
    let currentHeading = "Overview";

    const flush = (endLine: number) => {
      if (currentChunk.length === 0) return;
      const text = currentChunk.join("\n").trim();
      if (!text) return;

      const formatted = `# Document: ${filepath}\n# Section: ${currentHeading}\n\n${text}`;
      chunks.push({
        id: `chunk_${fileId}_${chunkIndex++}`,
        fileId,
        chunkIndex,
        content: formatted,
        contentHash: computeSha256(formatted),
        sourceType: "documentation",
        modalType: "text",
        heading: currentHeading,
        symbolKind: "heading_section",
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
      const headingMatch = line.match(/^#{1,4}\s+(.+)/);

      if (headingMatch && currentChunk.length > 15) {
        flush(i);
        startLine = i + 1;
        currentHeading = headingMatch[1].trim();
      }

      currentChunk.push(line);

      if (currentChunk.length >= 70) {
        flush(i + 1);
        startLine = i + 2;
      }
    }

    flush(lines.length);
    return chunks;
  }
}
