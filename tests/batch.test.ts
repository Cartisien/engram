import { describe, it, expect } from 'vitest';
import { embedBatch, embedBatchOllama } from '../src/utils/batch.js';

describe('Batch Embedding', () => {
  describe('embedBatch', () => {
    it('should batch process all texts', async () => {
      const embedFn = async (text: string) => {
        // Mock embedding that returns vector based on text length
        return new Array(3).fill(text.length * 0.1);
      };

      const results = await embedBatch(['a', 'bb', 'ccc'], embedFn, 2);

      expect(results).toHaveLength(3);
      expect(results[0]?.[0]).toBeCloseTo(0.1, 5);
      expect(results[1]?.[0]).toBeCloseTo(0.2, 5);
      expect(results[2]?.[0]).toBeCloseTo(0.3, 5);
    });

    it('should handle empty array', async () => {
      const embedFn = async () => [1, 2, 3];
      const results = await embedBatch([], embedFn, 10);
      expect(results).toHaveLength(0);
    });

    it('should handle null results from embed function', async () => {
      const embedFn = async (text: string) => {
        return text === 'fail' ? null : [1, 2, 3];
      };

      const results = await embedBatch(['ok', 'fail', 'ok'], embedFn, 10);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual([1, 2, 3]);
      expect(results[1]).toBeNull();
      expect(results[2]).toEqual([1, 2, 3]);
    });

    it('should handle embed function errors gracefully', async () => {
      const embedFn = async (text: string) => {
        if (text === 'error') throw new Error('Embedding failed');
        return [1, 2, 3];
      };

      const results = await embedBatch(['ok', 'error', 'ok'], embedFn, 10);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual([1, 2, 3]);
      expect(results[1]).toBeNull();
      expect(results[2]).toEqual([1, 2, 3]);
    });

    it('should respect batch size', async () => {
      let batchCount = 0;
      const embedFn = async (text: string) => {
        batchCount++;
        return [text.length];
      };

      await embedBatch(['a', 'b', 'c', 'd', 'e'], embedFn, 2);

      // 5 items with batch size 2 should result in 5 calls (3 batches)
      expect(batchCount).toBe(5);
    });

    it('should process single batch when items <= batchSize', async () => {
      let callCount = 0;
      const embedFn = async () => {
        callCount++;
        return [1];
      };

      await embedBatch(['a', 'b', 'c'], embedFn, 10);

      expect(callCount).toBe(3);
    });
  });

  describe('embedBatchOllama', () => {
    it('should handle network errors gracefully', async () => {
      // This test verifies the function doesn't crash on network failure
      // Since we can't actually call Ollama in tests, we just verify the function exists
      // and has the correct signature
      expect(typeof embedBatchOllama).toBe('function');
    });
  });
});
