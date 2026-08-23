import {
  DocumentEmbeddingInput,
  EmbeddingProvider,
  QueryEmbeddingInput,
} from "../../core/types";

export class LocalLlamaEmbeddingProvider implements EmbeddingProvider {
  readonly modelName: string;
  readonly dimensions: number;
  readonly providerType = "local_llama" as const;
  private embedderUrl: string;
  isAvailable = false;
  lastHealthError?: string;

  constructor(
    embedderUrl = "http://127.0.0.1:8145/v1/embeddings",
    modelName = "embeddinggemma-300m-q4",
    dimensions = 768
  ) {
    this.embedderUrl = embedderUrl;
    this.modelName = modelName;
    this.dimensions = dimensions;
    this.checkHealth();
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(
        this.embedderUrl.replace("/v1/embeddings", "/health"),
        { signal: AbortSignal.timeout(2000) }
      );
      this.isAvailable = res.ok;
      if (!res.ok) {
        this.lastHealthError = `HTTP ${res.status}: ${res.statusText}`;
      } else {
        this.lastHealthError = undefined;
      }
      return res.ok;
    } catch (e: any) {
      this.isAvailable = false;
      this.lastHealthError = e.message || String(e);
      return false;
    }
  }

  async embedDocument(input: DocumentEmbeddingInput): Promise<Float32Array> {
    let textToEmbed = input.text;
    if (input.context || input.symbol) {
      const headerParts: string[] = [];
      if (input.title) headerParts.push(`source: ${input.title}`);
      if (input.symbol) headerParts.push(`symbol: ${input.symbol}`);
      if (input.context) headerParts.push(`context: ${input.context}`);
      textToEmbed = `${headerParts.join(" | ")}\n\n${input.text}`;
    }

    return this.callLocalEmbedding(textToEmbed);
  }

  async embedQuery(input: QueryEmbeddingInput): Promise<Float32Array> {
    return this.callLocalEmbedding(input.query);
  }

  private async callLocalEmbedding(text: string): Promise<Float32Array> {
    try {
      // Guard against empty string (causes HTTP 500 on llama.cpp tokenization)
      const cleanText = text && text.trim().length > 0 ? text.trim() : "empty";
      // Truncate overly long text payloads to fit safely within llama.cpp 512 token physical batch size (~1200 chars)
      const safeText = cleanText.length > 1200 ? cleanText.slice(0, 1200) : cleanText;
      const res = await fetch(this.embedderUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: safeText,
          model: this.modelName,
        }),
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => "");
        throw new Error(
          `Local embedder returned HTTP ${res.status}: ${res.statusText} - Body: "${errorBody}" - Input sample: "${safeText.slice(0, 80)}"`
        );
      }

      const data = (await res.json()) as any;
      const embedding = data.data?.[0]?.embedding;

      if (!embedding || embedding.length === 0) {
        throw new Error("Local embedder returned empty embedding vector.");
      }

      return new Float32Array(embedding);
    } catch (err: any) {
      throw new Error(`Failed to call local embedder: ${err.message}`);
    }
  }
}
