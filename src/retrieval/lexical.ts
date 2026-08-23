export interface LexicalMatchResult {
  score: number;
  matchedTokens: string[];
}

export class LexicalScorer {
  private stopWords = new Set([
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
    "any", "are", "as", "at", "be", "because", "been", "before", "being", "below",
    "between", "both", "but", "by", "could", "did", "do", "does", "doing", "down",
    "during", "each", "few", "for", "from", "further", "had", "has", "have", "having",
    "he", "her", "here", "hers", "herself", "him", "himself", "his", "how", "i",
    "if", "in", "into", "is", "it", "its", "itself", "just", "me", "more", "most",
    "my", "myself", "no", "nor", "not", "now", "of", "off", "on", "once", "only",
    "or", "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "same",
    "she", "should", "so", "some", "such", "than", "that", "the", "their", "theirs",
    "them", "themselves", "then", "there", "these", "they", "this", "those", "through",
    "to", "too", "under", "until", "up", "very", "was", "we", "were", "what", "when",
    "where", "which", "while", "who", "whom", "why", "with", "would", "you", "your",
  ]);

  scoreText(
    query: string,
    id: string,
    content: string,
    symbol?: string,
    heading?: string
  ): LexicalMatchResult | null {
    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) return null;

    const contentLower = content.toLowerCase();
    const symbolLower = (symbol || "").toLowerCase();
    const headingLower = (heading || "").toLowerCase();

    let matches = 0;
    const matchedTokens: string[] = [];

    for (const token of queryTokens) {
      let tokenMatched = false;
      if (symbolLower.includes(token)) {
        matches += 3.0; // Strong symbol match
        tokenMatched = true;
      }
      if (headingLower.includes(token)) {
        matches += 2.0; // Section heading match
        tokenMatched = true;
      }
      if (contentLower.includes(token)) {
        matches += 1.0;
        tokenMatched = true;
      }
      if (tokenMatched) matchedTokens.push(token);
    }

    if (matches === 0) return null;
    const normalizedScore = Math.min(1.0, matches / (queryTokens.length * 2.0));
    return { score: normalizedScore, matchedTokens };
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !this.stopWords.has(t));
  }
}
