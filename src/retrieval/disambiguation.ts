import { RetrievedContext } from "../core/types";

export interface DisambiguationEvidence {
  /** An exact symbol, heading, or trigger-tag hit on the query as a whole. */
  exactEvidence: boolean;
  /** Highest cosine similarity across the semantic arm. */
  topSemanticScore?: number;
  /** Highest normalized token-overlap score across the lexical arm. */
  topLexicalScore?: number;
  /**
   * Whether any record inside the caller's namespace shares a term with the
   * query, irrespective of whether that record is admissible. Defaults to
   * `topLexicalScore > 0` when the caller does not compute it separately.
   */
  lexicalAnchor?: boolean;
  /** Minimum cosine similarity that counts as semantic evidence. */
  threshold: number;
  /**
   * Minimum token-overlap score that counts as lexical evidence. Optional so
   * callers predating the lexical arm keep their original semantics: when it is
   * omitted, lexical overlap cannot satisfy the gate on its own.
   */
  lexicalThreshold?: number;
}

function assertUnitRange(value: number, field: string): void {
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    throw new RangeError(`${field} must be between -1 and 1`);
  }
}

/**
 * Decides whether retrieval found enough evidence to answer at all.
 *
 * The gate accepts when ANY independent arm vouches for the result: an exact
 * symbol/heading/trigger hit, semantic similarity at or above `threshold`, or
 * lexical overlap at or above `lexicalThreshold`. The arms are deliberately a
 * disjunction rather than a conjunction — a query whose wording matches the
 * corpus verbatim is well evidenced even when the embedder scores it modestly,
 * and a paraphrase that shares no tokens is well evidenced by cosine alone.
 * Keying the decision on cosine by itself discarded rankings that the lexical
 * and fusion stages had already resolved.
 *
 * It still fails closed: when no arm clears its bar, the caller receives a
 * disambiguation request rather than a low-confidence answer.
 */
export function enforceDisambiguationGate(
  results: RetrievedContext[],
  evidence: DisambiguationEvidence
): RetrievedContext[] {
  if (results.length === 0) {
    return [];
  }

  const {
    exactEvidence,
    topSemanticScore,
    topLexicalScore,
    lexicalAnchor,
    threshold,
    lexicalThreshold,
  } = evidence;

  assertUnitRange(threshold, "disambiguationThreshold");
  if (lexicalThreshold !== undefined) {
    assertUnitRange(lexicalThreshold, "lexicalEvidenceThreshold");
  }

  // A content-free query ("^^^", a repeated character) embeds close to the corpus
  // centroid, so cosine alone rates it as highly as a real question: measured on
  // this corpus, junk scored 0.50-0.58 against a genuine-query band of 0.45-0.61.
  // Cosine therefore separates off-topic text but NOT content-free text, and the
  // semantic arm needs a minimal anchor before it may vouch on its own: at least
  // one query term has to occur somewhere in the corpus. The bar is deliberately
  // low (any overlap at all, not the lexical threshold) so that paraphrases still
  // pass on semantics. Legacy callers that never engage the lexical arm keep the
  // original unanchored behaviour.
  const lexicalArmEngaged = lexicalThreshold !== undefined;
  // An anchor is about the query touching the corpus at all, so it is evaluated
  // against namespace scope rather than admissibility: a term occurring only in a
  // quarantined record still proves the query is not gibberish, even though that
  // record can never be returned. Callers that do not compute it fall back to the
  // ranking score.
  const hasLexicalAnchor =
    lexicalAnchor !== undefined
      ? lexicalAnchor
      : topLexicalScore !== undefined && topLexicalScore > 0;

  const hasSemanticEvidence =
    topSemanticScore !== undefined &&
    topSemanticScore >= threshold &&
    (!lexicalArmEngaged || hasLexicalAnchor);
  const hasLexicalEvidence =
    lexicalArmEngaged &&
    topLexicalScore !== undefined &&
    topLexicalScore >= lexicalThreshold!;

  if (exactEvidence || hasSemanticEvidence || hasLexicalEvidence) {
    // Passed. The retriever maps the candidates; an empty array means "no flags".
    return [];
  }

  const semanticLabel =
    topSemanticScore === undefined ? "unavailable" : topSemanticScore.toFixed(3);
  const lexicalLabel =
    topLexicalScore === undefined ? "unavailable" : topLexicalScore.toFixed(3);
  const lexicalNeeds =
    lexicalThreshold === undefined
      ? " (arm disabled)"
      : ` (needs ${lexicalThreshold.toFixed(3)})`;
  const anchorNote =
    lexicalArmEngaged && !hasLexicalAnchor
      ? "\nNo term in the query occurs anywhere in the indexed corpus, so semantic similarity alone was not treated as evidence."
      : "";

  return [{
    id: "DISAMBIGUATION_REQUIRED",
    sourceType: "system_gate",
    modality: "text",
    content: `<antigravity_disambiguation_request>
The Memory OS found no exact match, and neither retrieval arm cleared its evidence bar.
Semantic: ${semanticLabel} (needs ${threshold.toFixed(3)}). Lexical: ${lexicalLabel}${lexicalNeeds}.${anchorNote}
Please clarify your intent or provide more specific architectural keywords.
</antigravity_disambiguation_request>`,
    finalScore: topSemanticScore ?? -1,
    reason: "No exact evidence; semantic and lexical evidence were both below threshold",
  }];
}
