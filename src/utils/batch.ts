/**
 * Batch Embedding Utilities
 * 
 * v0.7 feature: Batch multiple embedding requests to reduce HTTP overhead
 */

export interface BatchEmbedResult {
  embedding: number[] | null;
  index: number;
  error?: string;
}

/**
 * Batch embed multiple texts using parallel requests
 * 
 * @param texts - Array of texts to embed
 * @param embedFn - Single embedding function
 * @param batchSize - Maximum parallel requests
 * @returns Array of embeddings (null if failed)
 */
export async function embedBatch(
  texts: string[],
  embedFn: (text: string) => Promise<number[] | null>,
  batchSize: number = 10
): Promise<(number[] | null)[]> {
  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  
  // Process in batches
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchPromises = batch.map(async (text, batchIndex) => {
      const resultIndex = i + batchIndex;
      try {
        const embedding = await embedFn(text);
        results[resultIndex] = embedding;
      } catch (error) {
        console.warn(`[Engram] Embedding failed for index ${resultIndex}:`, error);
        results[resultIndex] = null;
      }
    });
    
    await Promise.all(batchPromises);
  }
  
  return results;
}

/**
 * Ollama-native batch embedding (if API supports it)
 * Falls back to parallel individual requests
 */
export async function embedBatchOllama(
  texts: string[],
  baseUrl: string,
  model: string,
  batchSize: number = 10
): Promise<(number[] | null)[]> {
  const results: (number[] | null)[] = [];
  
  // Process in batches
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    
    // Try to use Ollama's batch endpoint if available
    // Currently Ollama doesn't have native batch, so we parallelize
    const batchResults = await Promise.all(
      batch.map(async (text) => {
        try {
          const response = await fetch(`${baseUrl}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt: text }),
          });
          
          if (!response.ok) return null;
          
          const data = await response.json() as { embedding?: number[] };
          return data.embedding ?? null;
        } catch {
          return null;
        }
      })
    );
    
    results.push(...batchResults);
  }
  
  return results;
}
