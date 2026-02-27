/**
 * Embedding generation utilities.
 *
 * The placeholder implementation returns a random unit vector.
 * Replace embedText() with a real model call before production:
 *   - OpenAI: text-embedding-3-small (1536 dims)
 *   - Ollama: nomic-embed-text (768 dims)
 *   - Local: @xenova/transformers all-MiniLM-L6-v2 (384 dims)
 */

export const DEFAULT_DIMENSIONS = 1536

/**
 * TODO: replace with real embedding model.
 * Currently returns a random unit vector of the specified dimensionality.
 */
export async function embedText(
  text: string,
  dimensions = DEFAULT_DIMENSIONS,
): Promise<number[]> {
  void text // suppress unused warning — real impl will use this

  // Random unit vector (L2-normalized)
  const raw = Array.from({ length: dimensions }, () => Math.random() * 2 - 1)
  const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0))
  return raw.map((v) => v / norm)
}

/**
 * Batch embed multiple texts.
 */
export async function embedBatch(
  texts: string[],
  dimensions = DEFAULT_DIMENSIONS,
): Promise<number[][]> {
  return Promise.all(texts.map((t) => embedText(t, dimensions)))
}
