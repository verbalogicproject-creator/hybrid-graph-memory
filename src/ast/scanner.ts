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

export interface ScanSkip {
  filepath: string;
  reason:
    | "too_large"
    | "read_error"
    | "file_limit"
    | "total_bytes_limit"
    | "depth_limit";
  detail?: string;
}

export interface ScanResult {
  files: ScannedFile[];
  seenFilepaths: string[];
  skipped: ScanSkip[];
  complete: boolean;
}

export class ProjectScanner {
  private commitHash?: string;

  constructor(private config: MemoryConfig) {
    this.commitHash = getGitCommitHash(this.config.projectRoot);
  }

  scan(): ScannedFile[] {
    return this.scanDetailed().files;
  }

  scanDetailed(): ScanResult {
    const results: ScannedFile[] = [];
    const seenFilepaths = new Set<string>();
    const skipped: ScanSkip[] = [];
    const state = { acceptedBytes: 0, complete: true };
    this.commitHash = getGitCommitHash(this.config.projectRoot);
    this.walkDir(this.config.projectRoot, 0, results, seenFilepaths, skipped, state);
    results.sort((a, b) => a.filepath.localeCompare(b.filepath));
    skipped.sort((a, b) => a.filepath.localeCompare(b.filepath));
    return {
      files: results,
      seenFilepaths: Array.from(seenFilepaths).sort(),
      skipped,
      complete: state.complete,
    };
  }

  private isExcludedProjectPath(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, "/");
    return this.config.excludedPathPrefixes.some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
    );
  }

  private walkDir(
    currentDir: string,
    depth: number,
    results: ScannedFile[],
    seenFilepaths: Set<string>,
    skipped: ScanSkip[],
    state: { acceptedBytes: number; complete: boolean }
  ) {
    if (!fs.existsSync(currentDir)) return;

    if (depth > this.config.maxScanDepth) {
      state.complete = false;
      skipped.push({
        filepath: path.relative(this.config.projectRoot, currentDir) || ".",
        reason: "depth_limit",
      });
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs
        .readdirSync(currentDir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      state.complete = false;
      skipped.push({
        filepath: path.relative(this.config.projectRoot, currentDir) || ".",
        reason: "read_error",
        detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(this.config.projectRoot, fullPath);

      if (this.isExcludedProjectPath(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        if (
          this.config.excludedDirectories.includes(entry.name) ||
          entry.name.startsWith(".")
        ) {
          continue;
        }
        this.walkDir(fullPath, depth + 1, results, seenFilepaths, skipped, state);
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
          seenFilepaths.add(relativePath);
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size > this.config.maxFileBytes) {
              skipped.push({
                filepath: relativePath,
                reason: "too_large",
                detail: `${stat.size} bytes exceeds ${this.config.maxFileBytes}`,
              });
              continue;
            }
            if (results.length >= this.config.maxFiles) {
              state.complete = false;
              skipped.push({ filepath: relativePath, reason: "file_limit" });
              continue;
            }
            if (state.acceptedBytes + stat.size > this.config.maxTotalBytes) {
              state.complete = false;
              skipped.push({ filepath: relativePath, reason: "total_bytes_limit" });
              continue;
            }
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
            state.acceptedBytes += stat.size;
          } catch (error) {
            state.complete = false;
            skipped.push({
              filepath: relativePath,
              reason: "read_error",
              detail: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }
  }
}
