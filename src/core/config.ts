import fs from "node:fs";
import path from "node:path";

export interface MemoryConfig {
  workspace: string;
  projectName: string;
  projectRoot: string;
  providerMode: "auto" | "cloud" | "local";
  cloud: {
    embeddingModel: string;
    generatorModel: string;
    dimensions: number;
    apiKey?: string;
  };
  local: {
    embedderUrl: string;
    rerankerUrl: string;
    generatorUrl: string;
    generatorModels: string[];
    activeGenerator: string;
    dimensions: number;
  };
  dbPath: string;
  sharedHivePath: string;
  supportedExtensions: string[];
  excludedDirectories: string[];
  excludedFiles: string[];
  candidateLimit: number;
  defaultResultLimit: number;
  rrfConstant: number;
  halfLifeDays: number;
  disambiguationThreshold: number;
  minSimilarityThreshold: number;
}

export function findProjectRoot(startDir = process.cwd()): string {
  let current = path.resolve(startDir);
  while (true) {
    if (
      fs.existsSync(path.join(current, ".antigravityrc.json")) ||
      fs.existsSync(path.join(current, ".git")) ||
      fs.existsSync(path.join(current, "package.json"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir);
    }
    current = parent;
  }
}

export function loadMemoryConfig(startDir = process.cwd()): MemoryConfig {
  const projectRoot = findProjectRoot(startDir);
  const configPath = path.join(projectRoot, ".antigravityrc.json");

  let parsed: any = {};
  if (fs.existsSync(configPath)) {
    try {
      parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (e) {
      console.warn("Failed to parse .antigravityrc.json, using defaults.");
    }
  }

  const projectName = parsed.projectName || path.basename(projectRoot);
  const workspace =
    parsed.workspace || process.env.ANTIGRAVITY_WORKSPACE || "default";

  return {
    workspace,
    projectName,
    projectRoot,
    providerMode: parsed.providerMode || "auto",
    cloud: {
      embeddingModel: parsed.cloud?.embeddingModel || "gemini-embedding-2",
      generatorModel: parsed.cloud?.generatorModel || "gemini-2.5-flash",
      dimensions: parsed.cloud?.dimensions || 768,
      apiKey: process.env.GEMINI_API_KEY,
    },
    local: {
      embedderUrl:
        parsed.local?.embedderUrl || "http://127.0.0.1:8145/v1/embeddings",
      rerankerUrl:
        parsed.local?.rerankerUrl || "http://127.0.0.1:8144/v1/rerank",
      generatorUrl:
        parsed.local?.generatorUrl || "http://127.0.0.1:8147/v1/chat/completions",
      generatorModels: parsed.local?.generatorModels || [
        "qwen2.5-3b-instruct-q4_0",
        "microsoft_Phi-4-mini-instruct",
        "Llama-3.2-3B-Instruct-Q4_0",
        "gemma-4-E4B-it-Q4_0",
      ],
      activeGenerator:
        parsed.local?.activeGenerator || "qwen2.5-3b-instruct-q4_0",
      dimensions: parsed.local?.dimensions || 768,
    },
    dbPath: path.resolve(
      projectRoot,
      parsed.dbPath || ".memory/project_memory.db"
    ),
    sharedHivePath: (
      parsed.sharedHivePath || "~/.antigravity/shards/global-hive.db"
    ).replace(/^~/, process.env.HOME || "/root"),
    supportedExtensions: parsed.supportedExtensions || [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".json",
      ".md",
      ".mdx",
      ".ctx",
      ".py",
      ".rs",
      ".go",
      ".yaml",
      ".yml",
    ],
    excludedDirectories: [
      ".git",
      ".next",
      "node_modules",
      "dist",
      "build",
      "coverage",
      "out",
      ".cache",
      ".memory",
      ".gemini",
    ],
    excludedFiles: [
      ".env",
      ".env.local",
      ".env.production",
      "package-lock.json",
      "yarn.lock",
      "pnpm-lock.yaml",
    ],
    candidateLimit: parsed.candidateLimit || 40,
    defaultResultLimit: parsed.defaultResultLimit || 6,
    rrfConstant: parsed.rrfConstant || 60,
    halfLifeDays: parsed.halfLifeDays || 14,
    disambiguationThreshold: parsed.disambiguationThreshold || 0.6,
    minSimilarityThreshold: parsed.minSimilarityThreshold || 0.25,
  };
}
