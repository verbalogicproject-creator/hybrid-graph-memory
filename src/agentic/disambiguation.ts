import { MemoryRelation, RetrievedContext } from "../core/types";

export interface ConfidenceEvaluation {
  confidence: number;
  cosineScore: number;
  matchedEdges: number;
  requiredEdges: number;
  edgeDensity: number;
  passed: boolean;
  reason: string;
}

export interface DisambiguationResult {
  needsDisambiguation: boolean;
  confidence: number;
  evaluation: ConfidenceEvaluation;
  xmlPayload?: string;
  suggestedClarifications?: string[];
}

export function evaluateConfidence(
  cosineScore: number,
  matchedEdges: number,
  requiredEdges: number,
  threshold = 0.60
): ConfidenceEvaluation {
  const normalizedCosine = Math.max(0, Math.min(1.0, cosineScore));
  const edgeDensity =
    requiredEdges > 0
      ? Math.max(0, Math.min(1.0, matchedEdges / requiredEdges))
      : normalizedCosine;

  const rawConfidence = 0.7 * normalizedCosine + 0.3 * edgeDensity;
  const confidence = Math.max(0, Math.min(1.0, rawConfidence));
  const passed = confidence >= threshold;

  const reason = passed
    ? `Confidence acceptable (${(confidence * 100).toFixed(1)}% >= ${(threshold * 100).toFixed(0)}%) [Cosine: ${normalizedCosine.toFixed(2)}, Edges: ${matchedEdges}/${requiredEdges}]`
    : `Confidence below threshold (${(confidence * 100).toFixed(1)}% < ${(threshold * 100).toFixed(0)}%) [Cosine: ${normalizedCosine.toFixed(2)}, Edges: ${matchedEdges}/${requiredEdges}]`;

  return {
    confidence,
    cosineScore: normalizedCosine,
    matchedEdges,
    requiredEdges,
    edgeDensity,
    passed,
    reason,
  };
}

export function checkDisambiguationGate(
  query: string,
  retrievedContexts: RetrievedContext[],
  allRelations: MemoryRelation[],
  threshold = 0.60
): DisambiguationResult {
  const topCosine = retrievedContexts.length > 0
    ? retrievedContexts[0].semanticScore || retrievedContexts[0].finalScore || 0
    : 0;

  const queryTokens = query.match(/[A-Z][a-zA-Z0-9]+|[a-z]+[A-Z][a-zA-Z0-9]*/g) || [];
  const uniqueQuerySymbols = Array.from(new Set(queryTokens));

  const relevantRelations = allRelations.filter((r) =>
    uniqueQuerySymbols.some(
      (sym) =>
        r.fromId.toLowerCase() === sym.toLowerCase() ||
        r.toId.toLowerCase() === sym.toLowerCase()
    )
  );

  const requiredEdges = relevantRelations.length;
  const retrievedContent = retrievedContexts.map((c) => `${c.symbol || ""} ${c.content}`).join(" ");
  let matchedEdges = 0;

  for (const rel of relevantRelations) {
    if (
      retrievedContent.includes(rel.fromId) &&
      retrievedContent.includes(rel.toId)
    ) {
      matchedEdges++;
    }
  }

  const evaluation = evaluateConfidence(topCosine, matchedEdges, requiredEdges, threshold);

  if (!evaluation.passed) {
    const suggestedClarifications: string[] = [];

    if (uniqueQuerySymbols.length > 0) {
      suggestedClarifications.push(
        `Are you referring to specific architecture components like ${uniqueQuerySymbols.slice(0, 3).map((s) => `\`${s}\``).join(", ")}?`
      );
    }
    if (retrievedContexts.length > 0 && retrievedContexts[0].symbol) {
      suggestedClarifications.push(
        `Did you mean to inspect the \`${retrievedContexts[0].symbol}\` module?`
      );
    } else {
      suggestedClarifications.push(
        "Could you specify the target component or intended architecture subsystem?"
      );
    }

    const xmlPayload = formatDisambiguationXml(
      query,
      evaluation.confidence,
      evaluation.reason,
      suggestedClarifications
    );

    return {
      needsDisambiguation: true,
      confidence: evaluation.confidence,
      evaluation,
      xmlPayload,
      suggestedClarifications,
    };
  }

  return {
    needsDisambiguation: false,
    confidence: evaluation.confidence,
    evaluation,
  };
}

export function formatDisambiguationXml(
  query: string,
  confidence: number,
  reason: string,
  suggestions: string[]
): string {
  const lines: string[] = [];
  lines.push("<antigravity_disambiguation_request>");
  lines.push(`  <query>${escapeXml(query)}</query>`);
  lines.push(`  <confidence>${confidence.toFixed(3)}</confidence>`);
  lines.push(`  <threshold>0.600</threshold>`);
  lines.push(`  <reason>${escapeXml(reason)}</reason>`);
  lines.push("  <suggested_clarifications>");
  for (const s of suggestions) {
    lines.push(`    <clarification>${escapeXml(s)}</clarification>`);
  }
  lines.push("  </suggested_clarifications>");
  lines.push("</antigravity_disambiguation_request>");
  return lines.join("\n");
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
