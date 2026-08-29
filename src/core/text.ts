/**
 * Query tokenization shared by the lexical scorer and the FTS5 match builder.
 *
 * Both sides must agree on what counts as a meaningful term. When they disagree,
 * the disambiguation gate's lexical anchor becomes unsound: FTS5 matching on
 * function words ("of", "in", "the") reports that a content-free query touches
 * the corpus, and the semantic arm is then allowed to vouch for it alone.
 */

/**
 * Terms carrying no discriminative weight. They occur in nearly every chunk of
 * any English-bearing corpus, so a match on one is evidence of nothing.
 */
export const STOP_WORDS: ReadonlySet<string> = new Set([
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
  // Prepositions, conjunctions and connectives absent from the original list. Their
  // absence was not cosmetic: "without" was the only token surviving tokenization of
  // "to from with without the and or but", so coverage scored 1/1 = 1.0 and the
  // lexical arm admitted a content-free query on its own. Completing the class is
  // the fix for the class; see the arity note below for what it does not fix.
  "across", "along", "although", "among", "amongst", "around", "behind", "beside",
  "besides", "beyond", "cannot", "despite", "else", "except", "hence", "however",
  "moreover", "nevertheless", "onto", "per", "rather", "therefore", "thus",
  "toward", "towards", "unless", "unto", "upon", "via", "whereas", "whether",
  "within", "without", "whose",
]);

/**
 * Known limitation: coverage is a ratio, so a query reducing to a single term
 * scores either 0 or 1 and carries almost no information at 1. The stop-word class
 * above is what keeps function words from being that single term, which makes this
 * list load-bearing rather than cosmetic - a missing entry is a gate defect, not a
 * ranking nuisance. Document frequency does not substitute for it: measured on this
 * corpus "without" appears in 4% of chunks while "retriever" appears in 32% and
 * "file" in 87%, so a frequency cutoff would discard useful terms and keep this one.
 */

/**
 * Splits query text into discriminative lowercase terms. Punctuation is
 * replaced rather than removed so that `foo.bar` yields two terms, and
 * single-character tokens are dropped along with stop words.
 *
 * Returns an empty array for input that carries no searchable content, which
 * callers must treat as "no lexical signal" rather than "matches everything".
 */
export function tokenizeQuery(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

/**
 * Inserts a separator at camelCase humps so that word-boundary matching can see
 * the parts of a compound identifier: `maxFileBytes` becomes `max file bytes`.
 * Without this, anchoring a term to `\b` would stop matching identifier bodies,
 * which is most of a source corpus.
 */
export function splitCompoundWords(text: string): string {
  return text.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}
