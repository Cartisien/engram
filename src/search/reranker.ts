/**
 * Cross-encoder reranker module for Engram
 *
 * Calls an external reranker HTTP service to re-score candidate documents
 * against a query using a cross-encoder model.
 */

const RERANKER_TIMEOUT_MS = 5000;

export interface RerankerResult {
  index: number;
  score: number;
}

interface RerankerResponse {
  results: RerankerResult[];
}

/**
 * Rerank documents against a query using a cross-encoder service.
 *
 * @returns Sorted results (score desc) or null on failure.
 */
export async function rerank(
  query: string,
  documents: string[],
  rerankerUrl: string,
  topK?: number,
): Promise<RerankerResult[] | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RERANKER_TIMEOUT_MS);

    const response = await fetch(rerankerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        documents,
        top_k: topK ?? documents.length,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = (await response.json()) as RerankerResponse;

    if (!data?.results || !Array.isArray(data.results)) return null;

    return data.results
      .map((r) => ({ index: r.index, score: r.score }))
      .sort((a, b) => b.score - a.score);
  } catch {
    return null;
  }
}

/**
 * Check if the reranker service is reachable.
 */
export async function rerankerAvailable(rerankerUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RERANKER_TIMEOUT_MS);

    const response = await fetch(rerankerUrl, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}
