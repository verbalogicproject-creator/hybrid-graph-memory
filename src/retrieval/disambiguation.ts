import { RetrievedContext } from "../core/types";

/**
 * Validates the fused retrieval results against the disambiguation threshold.
 * If the top result's confidence falls below the threshold, the system halts
 * and outputs a disambiguation request to force the LLM to clarify the query.
 */
export function enforceDisambiguationGate(
  results: any[], // Array of RankedCandidate
  threshold: number = 0.60
): RetrievedContext[] {
  if (results.length === 0) {
    return [];
  }

  const topScore = results[0].finalScore || 0;
  
  if (topScore < threshold) {
    // Threshold failed: We inject the disambiguation request symbol.
    return [{
      id: "DISAMBIGUATION_REQUIRED",
      sourceType: "system_gate",
      modality: "text",
      content: `<antigravity_disambiguation_request>
The Memory OS could not find a high-confidence match for your query (Top Score: ${topScore.toFixed(2)} < Threshold: ${threshold.toFixed(2)}). 
Please clarify your intent or provide more specific architectural keywords.
</antigravity_disambiguation_request>`,
    }];
  }

  // Threshold passed: mapping is handled externally, just return null to indicate pass
  // Actually, since this is an enforcer, if it passes, we return empty or throw.
  // Wait, the hybrid_retriever maps the candidates to RetrievedContext. 
  // Let's just throw an error or return a flag.
  return []; // Returning empty array means it passed
}
