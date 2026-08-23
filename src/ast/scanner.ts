import fs from "node:fs";
import path from "node:path";
import { MemoryConfig } from "../core/config";
import { computeSha256 } from "../chunkers/code";

export interface ScannedFile {
  filepath: string;
  fileType: string;
  content: string;
  contentHash: string;
  mtime: number;
  size: number;
}

export class ProjectScanner {
  constructor(private config: MemoryConfig) {}

  scan(): ScannedFile[] {
    const results: ScannedFile[] = [];
    this.walkDir(this.config.projectRoot, results);
    return results;
  }

  private walkDir(currentDir: string, results: ScannedFile[]) {
    if (!fs.existsSync(currentDir)) return;

    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(this.config.projectRoot, fullPath);

      if (entry.isDirectory()) {
        if (
          this.config.excludedDirectories.includes(entry.name) ||
          entry.name.startsWith(".")
        ) {
          continue;
        }
        this.walkDir(fullPath, results);
      } else if (entry.isFile()) {
        if (
          this.config.excludedFiles.includes(entry.name) ||
          entry.name.startsWith(".") ||
          entry.name.endsWith(".d.ts")
        ) {
          continue;
        }

        const ext = path.extname(entry.name).toLowerCase();
        if (this.config.supportedExtensions.includes(ext)) {
          try {
            const stat = fs.statSync(fullPath);
            const content = fs.readFileSync(fullPath, "utf8");
            results.push({
              filepath: relativePath,
              fileType: ext.replace(".", ""),
              content,
              contentHash: computeSha256(content),
              mtime: Math.floor(stat.mtimeMs),
              size: stat.size,
            });
          } catch (err) {}
        }
      }
    }
  }
}
