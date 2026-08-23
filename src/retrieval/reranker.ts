import { LocalRerankerProvider, LocalRerankResult } from "../core/types";

export class LocalBgeReranker implements LocalRerankerProvider {
  private rerankerUrl: string;
  isAvailable = false;

  constructor(rerankerUrl = "http://127.0.0.1:8144/v1/rerank") {
    this.rerankerUrl = rerankerUrl;
    this.checkHealth();
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(this.rerankerUrl.replace("/v1/rerank", "/health"), {
        signal: AbortSignal.timeout(1000),
      });
      this.isAvailable = res.ok;
      return res.ok;
    } catch (e) {
      this.isAvailable = false;
      return false;
    }
  }

  async rerank(query: string, documents: string[]): Promise<LocalRerankResult[]> {
    if (documents.length === 0) return [];

    try {
      const res = await fetch(this.rerankerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          documents,
        }),
      });

      if (!res.ok) {
        throw new Error(`Reranker returned status ${res.status}`);
      }

      const data = (await res.json()) as any;
      const results: LocalRerankResult[] = (data.results || []).map((r: any) => ({
        index: r.index,
        relevanceScore: r.relevance_score,
      }));

      return results;
    } catch (err: any) {
      console.warn("Local reranker fallback:", err.message);
      return documents.map((_, i) => ({ index: i, relevanceScore: 0 }));
    }
  }
}
