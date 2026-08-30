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
    /** Alias the embedder serves under. Must track the served model: a change of
     *  model without a change of name defeats the stored-vector guard in
     *  HybridRetriever, which compares this string against `chunks.embedding_model`. */
    embedderModel: string;
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
  /** Project-relative files or directory trees omitted before indexing. */
  excludedPathPrefixes: string[];
  candidateLimit: number;
  defaultResultLimit: number;
  rrfConstant: number;
  halfLifeDays: number;
  disambiguationThreshold: number;
  /** Query-term coverage at which the lexical arm alone satisfies the gate. */
  lexicalEvidenceThreshold: number;
  minSimilarityThreshold: number;
  maxFileBytes: number;
  maxFiles: number;
  maxTotalBytes: number;
  maxScanDepth: number;
}

export class MemoryConfigError extends Error {
  readonly code = "INVALID_MEMORY_CONFIG";

  constructor(message: string) {
    super(message);
    this.name = "MemoryConfigError";
  }
}

function finiteNumber(
  value: unknown,
  field: string,
  min: number,
  max: number
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new MemoryConfigError(
      `${field} must be a finite number between ${min} and ${max}`
    );
  }
  return value;
}

function stringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new MemoryConfigError(`${field} must be an array of non-empty strings`);
  }
  return value;
}

function relativePathPrefixes(value: unknown, field: string): string[] | undefined {
  const entries = stringArray(value, field);
  if (!entries) return undefined;
  return entries.map((entry) => {
    const normalized = entry.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
    if (
      !normalized ||
      path.isAbsolute(normalized) ||
      normalized.split("/").some((part) => part === ".." || part === ".")
    ) {
      throw new MemoryConfigError(`${field} entries must be normalized project-relative paths`);
    }
    return normalized;
  });
}

function record(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MemoryConfigError(`${field} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function nonblankString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new MemoryConfigError(`${field} must be a non-empty string`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string, max: number): number | undefined {
  const parsed = finiteNumber(value, field, 1, max);
  if (parsed !== undefined && !Number.isInteger(parsed)) {
    throw new MemoryConfigError(`${field} must be an integer`);
  }
  return parsed;
}

function loopbackUrl(value: unknown, field: string): string | undefined {
  const raw = nonblankString(value, field);
  if (raw === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new MemoryConfigError(`${field} must be a valid URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new MemoryConfigError(`${field} must use HTTP(S) on a loopback host`);
  }
  return raw;
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new MemoryConfigError(`Invalid configuration at ${configPath}: ${message}`);
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MemoryConfigError(`Invalid configuration at ${configPath}: expected a JSON object`);
  }
  if (parsed.providerMode !== undefined && !["auto", "cloud", "local"].includes(parsed.providerMode)) {
    throw new MemoryConfigError("providerMode must be one of: auto, cloud, local");
  }
  const cloud = record(parsed.cloud, "cloud") || {};
  const local = record(parsed.local, "local") || {};

  const projectName = nonblankString(parsed.projectName, "projectName") ?? path.basename(projectRoot);
  const workspace =
    nonblankString(parsed.workspace, "workspace") ?? process.env.ANTIGRAVITY_WORKSPACE ?? "default";

  return {
    workspace,
    projectName,
    projectRoot,
    providerMode: parsed.providerMode ?? "auto",
    cloud: {
      embeddingModel: nonblankString(cloud.embeddingModel, "cloud.embeddingModel") ?? "gemini-embedding-2",
      generatorModel: nonblankString(cloud.generatorModel, "cloud.generatorModel") ?? "gemini-2.5-flash",
      dimensions: positiveInteger(cloud.dimensions, "cloud.dimensions", 1_000_000) ?? 768,
      apiKey: process.env.GEMINI_API_KEY,
    },
    local: {
      embedderUrl:
        loopbackUrl(local.embedderUrl, "local.embedderUrl") ?? "http://127.0.0.1:8145/v1/embeddings",
      embedderModel:
        nonblankString(local.embedderModel, "local.embedderModel") ?? "embeddinggemma-300m-q8",
      rerankerUrl:
        loopbackUrl(local.rerankerUrl, "local.rerankerUrl") ?? "http://127.0.0.1:8144/v1/rerank",
      generatorUrl:
        loopbackUrl(local.generatorUrl, "local.generatorUrl") ?? "http://127.0.0.1:8147/v1/chat/completions",
      generatorModels: stringArray(local.generatorModels, "local.generatorModels") ?? [
        "qwen2.5-3b-instruct-q4_0",
        "microsoft_Phi-4-mini-instruct",
        "Llama-3.2-3B-Instruct-Q4_0",
        "gemma-4-E4B-it-Q4_0",
      ],
      activeGenerator:
        nonblankString(local.activeGenerator, "local.activeGenerator") ?? "qwen2.5-3b-instruct-q4_0",
      dimensions: positiveInteger(local.dimensions, "local.dimensions", 1_000_000) ?? 768,
    },
    dbPath: path.resolve(
      projectRoot,
      nonblankString(parsed.dbPath, "dbPath") ?? ".memory/project_memory.db"
    ),
    sharedHivePath: (
      nonblankString(parsed.sharedHivePath, "sharedHivePath") ?? "~/.antigravity/shards/global-hive.db"
    ).replace(/^~/, process.env.HOME || "/root"),
    supportedExtensions: stringArray(parsed.supportedExtensions, "supportedExtensions") ?? [
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
    excludedPathPrefixes:
      relativePathPrefixes(parsed.excludedPathPrefixes, "excludedPathPrefixes") ?? [],
    candidateLimit: finiteNumber(parsed.candidateLimit, "candidateLimit", 1, 10_000) ?? 40,
    defaultResultLimit: finiteNumber(parsed.defaultResultLimit, "defaultResultLimit", 1, 1_000) ?? 6,
    rrfConstant: finiteNumber(parsed.rrfConstant, "rrfConstant", 1, 10_000) ?? 60,
    halfLifeDays: finiteNumber(parsed.halfLifeDays, "halfLifeDays", 0.01, 36_500) ?? 14,
    // Gate defaults recalibrated 2026-08-29 for the complete embeddinggemma-300m-q8
    // with EmbeddingGemma's prompt prefixes. The previous 0.5 was calibrated against
    // the defective Q4_0 conversion, whose unprojected output put in-domain at
    // 0.458-0.627; the projected space runs lower and 0.5 no longer separates.
    //
    // Measured on the H7 attempt-2 DEVELOPMENT split (34 answerable, 96 negative),
    // which is the only split tuning may use:
    //
    //   answerable                          semantic 0.378-0.684
    //   off-topic, WITH a lexical anchor    semantic 0.250-0.261   (5 of 43)
    //   content-free                        semantic 0.261-0.419, no anchor at all
    //
    // 0.32 sits near the middle of the only separating gap, (0.261, 0.378): 0.059
    // above the highest anchored negative and 0.058 below the lowest answerable.
    //
    // Note what this does NOT clear. Content-free input reaches 0.419, above the
    // lowest answerable query, so no semantic threshold can both admit answerable
    // queries and refuse gibberish. Content-free is held out entirely by the
    // requirement that the semantic arm have a lexical anchor before it may vouch.
    // That requirement is load-bearing, not defence in depth; weakening it reopens
    // the gate to gibberish at any threshold.
    //
    // lexicalEvidenceThreshold stays 0.7. Coverage is unchanged by the embedder swap
    // and still separates: in-domain 0.667-1.000 against out-of-domain 0.250-0.500.
    // It is quantized by query length, so 0.7 reads as "every term of a two- or
    // three-term query, or three quarters of a four-term one" and sits in a gap
    // rather than on an observed value.
    //
    // Calibrated defaults, not a held-out result. The test split had not been run
    // when these were frozen -- see research/.../PROTOCOL.md before claiming more.
    disambiguationThreshold: finiteNumber(parsed.disambiguationThreshold, "disambiguationThreshold", -1, 1) ?? 0.32,
    lexicalEvidenceThreshold: finiteNumber(parsed.lexicalEvidenceThreshold, "lexicalEvidenceThreshold", -1, 1) ?? 0.7,
    minSimilarityThreshold: finiteNumber(parsed.minSimilarityThreshold, "minSimilarityThreshold", -1, 1) ?? 0.25,
    maxFileBytes: finiteNumber(parsed.maxFileBytes, "maxFileBytes", 1, 1024 ** 3) ?? 2 * 1024 * 1024,
    maxFiles: finiteNumber(parsed.maxFiles, "maxFiles", 1, 1_000_000) ?? 50_000,
    maxTotalBytes: finiteNumber(parsed.maxTotalBytes, "maxTotalBytes", 1, 16 * 1024 ** 3) ?? 512 * 1024 * 1024,
    maxScanDepth: finiteNumber(parsed.maxScanDepth, "maxScanDepth", 1, 1_024) ?? 64,
  };
}
