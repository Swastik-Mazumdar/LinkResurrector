/** Content/metadata similarity (Phase 8). Pure, deterministic heuristics. */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'at',
  'by', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that',
  'as', 'from', 'we', 'our', 'you', 'your', 'com', 'www', 'http', 'https',
]);

export function normalizeText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(text) {
  return normalizeText(text)
    .split(' ')
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/** Jaccard similarity over token sets, with a mild length-difference penalty. */
export function tokenSetSimilarity(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0;
  const base = intersection / union;
  const lengthPenalty =
    1 - Math.min(1, Math.abs(setA.size - setB.size) / Math.max(setA.size, setB.size));
  return base * (0.6 + 0.4 * lengthPenalty);
}

export function titleSimilarity(titleA, titleB) {
  return tokenSetSimilarity(tokenize(titleA), tokenize(titleB));
}

/** Word-level content similarity (visible-text proxies: titles + description + body). */
export function contentSimilarity(textA, textB) {
  return tokenSetSimilarity(tokenize(textA), tokenize(textB));
}
