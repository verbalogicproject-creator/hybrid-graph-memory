import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { MemoryConfig } from "../core/config";
import { computeSha256 } from "../chunkers/code";

export function getGitCommitHash(projectRoot: string): string | undefined {
  try {
    const gitDir = path.join(projectRoot, ".git");
    if (!fs.existsSync(gitDir)) return undefined;
    const output = execSync("git rev-parse HEAD", {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.trim() || undefined;
  } catch (e) {
    return undefined;
  }
}

export function inferModuleFromPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (parts.length > 1) {
    if (parts[0] === "src" && parts.length > 2) {
      return parts[1];
    }
    return parts[0];
  }
  return "root";
}

export interface ScannedFile {
  filepath: string;
  fileType: string;
  content: string;
  contentHash: string;
  commitHash?: string;
  module?: string;
  mtime: number;
  size: number;
}

export class ProjectScanner {
  private commitHash?: string;

  constructor(private config: MemoryConfig) {
    this.commitHash = getGitCommitHash(this.config.projectRoot);
  }

  scan(): ScannedFile[] {
    const results: ScannedFile[] = [];
    this.commitHash = getGitCommitHash(this.config.projectRoot);
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
          entry.name.endsWith(".d.ts") ||
          entry.name.endsWith(".min.js")
        ) {
          continue;
        }

        const ext = path.extname(entry.name).toLowerCase();
        if (this.config.supportedExtensions.includes(ext)) {
          try {
            const stat = fs.statSync(fullPath);
            const content = fs.readFileSync(fullPath, "utf8");
            const moduleName = inferModuleFromPath(relativePath);
            results.push({
              filepath: relativePath,
              fileType: ext.replace(".", ""),
              content,
              contentHash: computeSha256(content),
              commitHash: this.commitHash,
              module: moduleName,
              mtime: Math.floor(stat.mtimeMs),
              size: stat.size,
            });
          } catch (err) {}
        }
      }
    }
  }
}
