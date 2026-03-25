/**
 * Graph Traversal Utilities
 * 
 * v0.7 feature: Multi-hop graph queries for finding connections
 */

import type { Database } from 'sqlite';
import type { GraphEdge, GraphPathResult, MemoryEntry } from '../types.js';

export interface TraversalNode {
  entity: string;
  depth: number;
  path: GraphEdge[];
}

/**
 * BFS-based path finding between two entities
 * 
 * @param db - SQLite database
 * @param sessionId - Session ID
 * @param from - Starting entity
 * @param to - Target entity
 * @param maxDepth - Maximum hops (default: 3)
 * @returns Path result with memories
 */
export async function findPath(
  db: Database,
  sessionId: string,
  from: string,
  to: string,
  maxDepth: number = 3
): Promise<GraphPathResult> {
  const startEntity = from.toLowerCase().trim();
  const targetEntity = to.toLowerCase().trim();
  
  // Quick check: are they directly connected?
  const directEdge = await db.get(`
    SELECT * FROM graph_edges
    WHERE session_id = ? 
    AND ((from_entity = ? AND to_entity = ?) OR (from_entity = ? AND to_entity = ?))
    LIMIT 1
  `, [sessionId, startEntity, targetEntity, targetEntity, startEntity]);
  
  if (directEdge) {
    const edge: GraphEdge = {
      from: directEdge.from_entity,
      relation: directEdge.relation,
      to: directEdge.to_entity,
      confidence: directEdge.confidence,
      memoryId: directEdge.memory_id,
    };
    
    const memories = await getMemoriesForEdges(db, [edge]);
    
    return {
      found: true,
      path: [edge],
      hops: 1,
      confidence: directEdge.confidence ?? 1.0,
      relatedMemories: memories,
    };
  }
  
  // BFS for multi-hop path
  const visited = new Set<string>();
  const queue: TraversalNode[] = [{
    entity: startEntity,
    depth: 0,
    path: [],
  }];
  
  visited.add(startEntity);
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    
    if (current.depth >= maxDepth) continue;
    
    // Get outgoing edges
    const outgoing = await db.all(`
      SELECT * FROM graph_edges
      WHERE session_id = ? AND from_entity = ?
    `, [sessionId, current.entity]);
    
    for (const row of outgoing) {
      const nextEntity = row.to_entity.toLowerCase().trim();
      
      if (visited.has(nextEntity)) continue;
      
      const edge: GraphEdge = {
        from: row.from_entity,
        relation: row.relation,
        to: row.to_entity,
        confidence: row.confidence,
        memoryId: row.memory_id,
      };
      
      const newPath = [...current.path, edge];
      
      if (nextEntity === targetEntity) {
        // Found the target
        const memories = await getMemoriesForEdges(db, newPath);
        const avgConfidence = newPath.reduce((sum, e) => sum + (e.confidence ?? 1.0), 0) / newPath.length;
        
        return {
          found: true,
          path: newPath,
          hops: newPath.length,
          confidence: avgConfidence,
          relatedMemories: memories,
        };
      }
      
      visited.add(nextEntity);
      queue.push({
        entity: nextEntity,
        depth: current.depth + 1,
        path: newPath,
      });
    }
    
    // Also check incoming edges (reverse direction)
    const incoming = await db.all(`
      SELECT * FROM graph_edges
      WHERE session_id = ? AND to_entity = ?
    `, [sessionId, current.entity]);
    
    for (const row of incoming) {
      const nextEntity = row.from_entity.toLowerCase().trim();
      
      if (visited.has(nextEntity)) continue;
      
      // Reverse the edge for the path
      const edge: GraphEdge = {
        from: row.to_entity,
        relation: `~${row.relation}`, // Mark as reverse relation
        to: row.from_entity,
        confidence: row.confidence,
        memoryId: row.memory_id,
      };
      
      const newPath = [...current.path, edge];
      
      if (nextEntity === targetEntity) {
        const memories = await getMemoriesForEdges(db, newPath);
        const avgConfidence = newPath.reduce((sum, e) => sum + (e.confidence ?? 1.0), 0) / newPath.length;
        
        return {
          found: true,
          path: newPath,
          hops: newPath.length,
          confidence: avgConfidence,
          relatedMemories: memories,
        };
      }
      
      visited.add(nextEntity);
      queue.push({
        entity: nextEntity,
        depth: current.depth + 1,
        path: newPath,
      });
    }
  }
  
  // No path found
  return {
    found: false,
    relatedMemories: [],
  };
}

/**
 * Get all memories linked to a set of edges
 */
async function getMemoriesForEdges(
  db: Database,
  edges: GraphEdge[]
): Promise<MemoryEntry[]> {
  const memoryIds = edges
    .map(e => e.memoryId)
    .filter((id): id is string => !!id);
  
  if (memoryIds.length === 0) return [];
  
  const placeholders = memoryIds.map(() => '?').join(',');
  const rows = await db.all(`
    SELECT * FROM memories WHERE id IN (${placeholders})
  `, memoryIds);
  
  return rows.map((row: any) => ({
    id: row.id,
    sessionId: row.session_id,
    content: row.content,
    role: row.role,
    timestamp: new Date(row.timestamp),
    tier: row.tier,
    contentHash: row.content_hash,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    consolidatedFrom: row.consolidated_from ? JSON.parse(row.consolidated_from) : undefined,
  }));
}

/**
 * Find all entities within N hops of a starting entity
 */
export async function findNearbyEntities(
  db: Database,
  sessionId: string,
  entity: string,
  maxDepth: number = 2
): Promise<Array<{ entity: string; depth: number; relations: string[] }>> {
  const startEntity = entity.toLowerCase().trim();
  const results: Array<{ entity: string; depth: number; relations: string[] }> = [];
  const visited = new Set<string>();
  const queue: Array<{ entity: string; depth: number; relations: string[] }> = [{
    entity: startEntity,
    depth: 0,
    relations: [],
  }];
  
  visited.add(startEntity);
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    
    if (current.depth >= maxDepth) continue;
    
    // Outgoing edges
    const outgoing = await db.all(`
      SELECT to_entity, relation FROM graph_edges
      WHERE session_id = ? AND from_entity = ?
    `, [sessionId, current.entity]);
    
    for (const row of outgoing) {
      const nextEntity = row.to_entity.toLowerCase().trim();
      
      if (!visited.has(nextEntity)) {
        visited.add(nextEntity);
        const newRelations = [...current.relations, row.relation];
        
        results.push({
          entity: nextEntity,
          depth: current.depth + 1,
          relations: newRelations,
        });
        
        queue.push({
          entity: nextEntity,
          depth: current.depth + 1,
          relations: newRelations,
        });
      }
    }
    
    // Incoming edges
    const incoming = await db.all(`
      SELECT from_entity, relation FROM graph_edges
      WHERE session_id = ? AND to_entity = ?
    `, [sessionId, current.entity]);
    
    for (const row of incoming) {
      const nextEntity = row.from_entity.toLowerCase().trim();
      
      if (!visited.has(nextEntity)) {
        visited.add(nextEntity);
        const newRelations = [...current.relations, `~${row.relation}`];
        
        results.push({
          entity: nextEntity,
          depth: current.depth + 1,
          relations: newRelations,
        });
        
        queue.push({
          entity: nextEntity,
          depth: current.depth + 1,
          relations: newRelations,
        });
      }
    }
  }
  
  return results;
}
