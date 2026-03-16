const CONFIG = {
  engramApiUrl: 'http://localhost:3471',
  openAiKey: process.env.OPENAI_API_KEY,
};

const CATEGORIES = [
  'single-session-info',
  'single-session-preference', 
  'single-session-assistant',
  'multi-session-reasoning',
  'temporal-reasoning',
  'knowledge-updates'
];

const SCALES = [100, 1000, 5000];

async function storeMemory(sessionId, content, daysAgo = 0) {
  const timestamp = new Date(Date.now() - daysAgo * 86400000).toISOString();
  await fetch(`${CONFIG.engramApiUrl}/memory/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, role: 'user', timestamp })
  });
}

async function queryMemory(sessionId, query) {
  const start = Date.now();
  const response = await fetch(
    `${CONFIG.engramApiUrl}/memory/${sessionId}?query=${encodeURIComponent(query)}&limit=5`
  );
  return { latency: Date.now() - start };
}

async function runScaleTest(category, scale) {
  const sessionId = `test-${Date.now()}`;
  console.log(`Testing ${category} @ ${scale} memories...`);
  
  // Store
  const storeStart = Date.now();
  for (let i = 0; i < scale; i++) {
    await storeMemory(sessionId, `Test memory ${i} for ${category}`, 0);
    if (i % 1000 === 0) process.stdout.write('.');
  }
  const storeTime = Date.now() - storeStart;
  console.log(`\n  Store: ${storeTime}ms (${Math.round(scale/(storeTime/1000))}/s)`);
  
  // Query
  const latencies = [];
  for (let i = 0; i < 20; i++) {
    const { latency } = await queryMemory(sessionId, `test query ${category}`);
    latencies.push(latency);
  }
  latencies.sort((a,b) => a-b);
  console.log(`  Query p50: ${latencies[10]}ms, p95: ${latencies[18]}ms`);
  
  return { category, scale, storeTime, qps: Math.round(scale/(storeTime/1000)) };
}

async function main() {
  console.log('Quick Stress Test - Engram on 5090\n');
  const results = [];
  
  for (const cat of CATEGORIES) {
    for (const scale of SCALES) {
      try {
        const result = await runScaleTest(cat, scale);
        results.push(result);
      } catch (e) {
        console.log(`  ERROR: ${e.message}`);
      }
    }
  }
  
  console.log('\n=== RESULTS ===');
  console.table(results);
}

main().catch(console.error);
