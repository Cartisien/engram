/* Cogito integration helpers — minimal, runtime-based. */

/**
 * Build a short briefing from user-scoped memories.
 * Returns a string suitable for Cogito.wake() output.
 */
export async function buildWakeBriefing(engram: any, userId: string, limit = 20): Promise<string> {
  // Call the instance-level recallUser if available, otherwise try prototype
  const recallFn = (engram.recallUser && typeof engram.recallUser === 'function')
    ? engram.recallUser.bind(engram)
    : (engram.recallUser ? engram.recallUser : null);

  let entries: any[] = [];
  try {
    if (recallFn) entries = await recallFn(userId, undefined, limit);
  } catch (e) {
    // best-effort
  }

  if (!entries || entries.length === 0) return '';
  const bullets = entries.map((e: any) => `- ${e.content}`);
  return `Briefing (${entries.length} items):\n` + bullets.join('\n');
}

/**
 * Handle sleep: consolidate session and/or user memories (best-effort).
 */
export async function handleSleep(engram: any, sessionId?: string, userId?: string) {
  if (sessionId) {
    try { await (engram.consolidate ? engram.consolidate(sessionId) : Promise.resolve()); }
    catch (e) { console.warn('consolidate(session) failed', e); }
  }
  if (userId) {
    try { await (engram.consolidateUser ? engram.consolidateUser(userId) : Promise.resolve()); }
    catch (e) { console.warn('consolidateUser(user) failed', e); }
  }
}
