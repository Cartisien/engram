import { Engram } from '@cartisien/engram';

async function main() {
  console.log('🧠 Engram Demo\n');

  // Create memory instance
  const memory = new Engram({ dbPath: './demo-memory.db' });

  const sessionId = 'user_jeff_001';

  // Simulate a conversation
  console.log('Storing memories...\n');

  await memory.remember(sessionId, 'My name is Jeff and I ride a Triumph Bonneville', 'user');
  await memory.remember(sessionId, 'Nice to meet you, Jeff! The Bonneville is a classic. What year?', 'assistant');
  await memory.remember(sessionId, "It's a 2020 T120. I love the torque.", 'user');
  await memory.remember(sessionId, 'Great choice. Have you done any long trips on it?', 'assistant');
  await memory.remember(sessionId, 'Yeah, I rode the Blue Ridge Parkway last fall. 400 miles in a day.', 'user');
  await memory.remember(sessionId, "That's a solid day! How was the bike on the curves?", 'assistant');

  // Recall by keyword
  console.log('Query: "What motorcycle does Jeff ride?"');
  const results1 = await memory.recall(sessionId, 'motorcycle', 3);
  console.log('Results:', results1.map(r => `- ${r.content}`).join('\n'));
  console.log();

  // Recall by different keyword
  console.log('Query: "Tell me about trips"');
  const results2 = await memory.recall(sessionId, 'trips', 3);
  console.log('Results:', results2.map(r => `- ${r.content}`).join('\n'));
  console.log();

  // Get full history
  console.log('Full conversation history:');
  const history = await memory.history(sessionId, 10);
  history.reverse().forEach((entry, i) => {
    const role = entry.role === 'user' ? '👤' : '🤖';
    console.log(`${role} ${entry.content}`);
  });
  console.log();

  // Stats
  console.log('Memory stats:');
  const stats = await memory.stats(sessionId);
  console.log(`- Total entries: ${stats.total}`);
  console.log(`- By role:`, stats.byRole);
  console.log(`- First memory: ${stats.oldest?.toLocaleString()}`);
  console.log(`- Latest memory: ${stats.newest?.toLocaleString()}`);

  // Cleanup
  memory.close();
  console.log('\n✅ Demo complete!');
}

main().catch(console.error);
