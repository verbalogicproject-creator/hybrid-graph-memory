import {
  DocumentEmbeddingInput,
  EmbeddingProvider,
  QueryEmbeddingInput,
} from "../../core/types";

/**
 * EmbeddingGemma's trained prompt formats, published on Google's model card. The
 * server does not add them -- `embed-server.sh` states this outright -- so the
 * caller must, and this provider previously did not.
 *
 * Measured on this corpus (research/embedder-quantization/): applying them widens
 * the in-domain / out-of-domain margin from 0.021 to 0.067 on the old embedder and
 * to 0.124 together with the complete model, against a run-to-run noise floor of
 * roughly 0.005. The effect is not additive with the model fix; the two interact.
 *
 * `title: none` is what was measured. Substituting a real title is untested here,
 * so document metadata is folded into the text slot rather than the title slot.
 */
const QUERY_PROMPT_PREFIX = "task: search result | query: ";
const DOCUMENT_PROMPT_PREFIX = "title: none | text: ";

export class LocalLlamaEmbeddingProvider implements EmbeddingProvider {
  readonly modelName: string;
  readonly dimensions: number;
  readonly providerType = "local_llama" as const;
  private embedderUrl: string;
  isAvailable = false;
  lastHealthError?: string;

  constructor(
    embedderUrl = "http://127.0.0.1:8145/v1/embeddings",
    modelName = "embeddinggemma-300m-q8",
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

    return this.callLocalEmbedding(textToEmbed, DOCUMENT_PROMPT_PREFIX);
  }

  async embedQuery(input: QueryEmbeddingInput): Promise<Float32Array> {
    return this.callLocalEmbedding(input.query, QUERY_PROMPT_PREFIX);
  }

  private async callLocalEmbedding(text: string, prefix = ""): Promise<Float32Array> {
    try {
      // Guard against empty string (causes HTTP 500 on llama.cpp tokenization)
      const cleanText = text && text.trim().length > 0 ? text.trim() : "empty";
      // 1200 characters is roughly 300 tokens. It was chosen to fit llama.cpp's
      // 512-token physical batch, which no longer binds: the server now runs
      // -b 2048 -ub 2048 against a 2048-token trained context, verified by
      // embedding a 1604-token input that previously returned HTTP 500.
      //
      // The limit is kept because raising it is not free. It would change every
      // document embedding, so it costs a re-index, a threshold recalibration, and
      // a fresh H7 attempt under a new split. Worth doing deliberately; not worth
      // doing as a side effect of a server flag.
      // Truncate first, then prefix: applying the prefix before the cut would let
      // it displace ~20 characters of real content, and the measured effect above
      // was obtained with the content held constant across prefixed and bare runs.
      const safeText =
        prefix + (cleanText.length > 1200 ? cleanText.slice(0, 1200) : cleanText);
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
