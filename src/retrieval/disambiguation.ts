import { RetrievedContext } from "../core/types";

export interface DisambiguationEvidence {
  exactEvidence: boolean;
  topSemanticScore?: number;
  threshold: number;
}

/**
 * Validates the fused retrieval results against the disambiguation threshold.
 * If the top result's confidence falls below the threshold, the system halts
 * and outputs a disambiguation request to force the LLM to clarify the query.
 */
export function enforceDisambiguationGate(
  results: RetrievedContext[],
  evidence: DisambiguationEvidence
): RetrievedContext[] {
  if (results.length === 0) {
    return [];
  }

  const { exactEvidence, topSemanticScore, threshold } = evidence;
  if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1) {
    throw new RangeError("disambiguationThreshold must be between -1 and 1");
  }

  if (!exactEvidence && (topSemanticScore === undefined || topSemanticScore < threshold)) {
    const scoreLabel = topSemanticScore === undefined
      ? "unavailable"
      : topSemanticScore.toFixed(3);
    // Threshold failed: We inject the disambiguation request symbol.
    return [{
      id: "DISAMBIGUATION_REQUIRED",
      sourceType: "system_gate",
      modality: "text",
      content: `<antigravity_disambiguation_request>
The Memory OS could not find exact evidence or a semantic match above the configured threshold (Top semantic score: ${scoreLabel}; threshold: ${threshold.toFixed(3)}).
Please clarify your intent or provide more specific architectural keywords.
</antigravity_disambiguation_request>`,
      finalScore: topSemanticScore ?? -1,
      reason: "No exact evidence and semantic evidence was below the configured threshold",
    }];
  }

  // Threshold passed: mapping is handled externally, just return null to indicate pass
  // Actually, since this is an enforcer, if it passes, we return empty or throw.
  // Wait, the hybrid_retriever maps the candidates to RetrievedContext. 
  // Let's just throw an error or return a flag.
  return []; // Returning empty array means it passed
}
