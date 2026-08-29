import { splitCompoundWords, tokenizeQuery } from "../core/text";

export interface LexicalMatchResult {
  /**
   * Field-weighted relevance, used for ranking. A symbol hit counts triple and a
   * heading hit double, so this deliberately is NOT a fraction of the query.
   */
  score: number;
  /**
   * Fraction of the query's discriminative terms found at all, in [0,1]. Used by
   * the disambiguation gate, which asks "how much of this query does the corpus
   * actually contain?" — a question the weighted score cannot answer, because a
   * single symbol hit drives it to 0.75 on a two-term query regardless of how
   * much of the query went unmatched.
   */
  coverage: number;
  matchedTokens: string[];
}

export class LexicalScorer {
  scoreText(
    query: string,
    id: string,
    content: string,
    symbol?: string,
    heading?: string
  ): LexicalMatchResult | null {
    const queryTokens = tokenizeQuery(query);
    if (queryTokens.length === 0) return null;

    // Symbols keep substring matching: "retriever" should hit `HybridRetriever`,
    // and an identifier is a deliberate compound rather than prose. Body text and
    // headings are matched at word starts instead, because plain `includes` let
    // any short query term harvest matches from the inside of unrelated words
    // ("tire" inside "entire", "car" inside "discard") and inflated the coverage
    // score that the disambiguation gate reads as evidence. Compound identifiers
    // are split first so that anchoring to \b still sees `maxFileBytes` as three
    // words rather than one opaque token.
    const symbolLower = (symbol || "").toLowerCase();
    const contentWords = splitCompoundWords(content).toLowerCase();
    const headingWords = splitCompoundWords(heading || "").toLowerCase();

    let matches = 0;
    const matchedTokens: string[] = [];

    for (const token of queryTokens) {
      let tokenMatched = false;
      if (symbolLower.includes(token)) {
        matches += 3.0; // Strong symbol match
        tokenMatched = true;
      }
      const wordStart = this.wordStartPattern(token);
      if (wordStart.test(headingWords)) {
        matches += 2.0; // Section heading match
        tokenMatched = true;
      }
      if (wordStart.test(contentWords)) {
        matches += 1.0;
        tokenMatched = true;
      }
      if (tokenMatched) matchedTokens.push(token);
    }

    if (matches === 0) return null;
    const normalizedScore = Math.min(1.0, matches / (queryTokens.length * 2.0));
    const coverage = matchedTokens.length / queryTokens.length;
    return { score: normalizedScore, coverage, matchedTokens };
  }

  /**
   * Compiles (and caches) a pattern matching `token` at the start of a word, so
   * prefix hits like "retriev" -> "retriever" still count while interior hits do
   * not. Tokens arrive from `tokenizeQuery` as word characters only, so they need
   * no escaping. The cache is cleared wholesale past a bound rather than evicted
   * per entry: it is a hot-path memo, not a correctness structure.
   */
  private wordStartPattern(token: string): RegExp {
    let pattern = this.wordStartPatterns.get(token);
    if (!pattern) {
      if (this.wordStartPatterns.size >= 1024) this.wordStartPatterns.clear();
      pattern = new RegExp(`\\b${token}`);
      this.wordStartPatterns.set(token, pattern);
    }
    return pattern;
  }

  private wordStartPatterns = new Map<string, RegExp>();

}
