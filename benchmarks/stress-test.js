#!/usr/bin/env node
/**
 * Engram Comprehensive Stress Test Suite
 * 
 * Tests all 6 LongMemEval categories under various stress conditions:
 * - Scale: 1K, 10K, 100K memories
 * - Noise: 1:10, 1:100 signal-to-noise
 * - Latency: p50, p95, p99
 * - Concurrency: 10, 100, 1000 simultaneous queries
 * - Retention: 30/60/90 day simulated gaps
 * 
 * Outputs: JSON results + Markdown report for publication
 */

const fs = require('fs');
const path = require('path');

const CONFIG = {
  engramApiUrl: process.env.ENGRAM_API_URL || 'http://192.168.68.73:3471',
  openAiKey: process.env.OPENAI_API_KEY,
  judgeModel: process.env.JUDGE_MODEL || 'gpt-4o',
  outputDir: process.env.OUTPUT_DIR || './stress-test-results'
};

// Test configurations
const SCALES = [1000, 10000, 100000];
const NOISE_RATIOS = [10, 100]; // 1:10, 1:100
const CONCURRENCY_LEVELS = [10, 100, 1000];
const RETENTION_DAYS = [30, 60, 90];

// Categories from LongMemEval
const CATEGORIES = [
  'single-session-info',
  'single-session-preference',
  'single-session-assistant',
  'multi-session-reasoning',
  'temporal-reasoning',
  'knowledge-updates'
];

class StressTestRunner {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      config: CONFIG,
      tests: {}
    };
    this.sessionCounter = 0;
  }

  getSessionId() {
    return `stress-test-${Date.now()}-${this.sessionCounter++}`;
  }

  async storeMemory(sessionId, content, role = 'user', daysAgo = 0) {
    const timestamp = new Date(Date.now() - daysAgo * 86400000).toISOString();
    await fetch(`${CONFIG.engramApiUrl}/memory/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, role, timestamp })
    });
  }

  async queryMemory(sessionId, query) {
    const start = Date.now();
    const response = await fetch(
      `${CONFIG.engramApiUrl}/memory/${sessionId}?query=${encodeURIComponent(query)}&limit=10`
    );
    const latency = Date.now() - start;
    const data = await response.json();
    return { latency, entries: data.entries || [] };
  }

  async judgeAnswer(question, expected, actual) {
    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.openAiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: CONFIG.judgeModel,
        messages: [
          {
            role: 'system',
            content: 'You are a strict evaluator. Reply with ONLY "CORRECT" or "INCORRECT".'
          },
          {
            role: 'user',
            content: `Question: ${question}\nExpected: ${expected}\nActual: ${actual}\n\nIs the actual answer semantically correct?`
          }
        ],
        temperature: 0
      })
    });
    const result = await completion.json();
    return result.choices[0].message.content.trim().toUpperCase() === 'CORRECT';
  }

  // Generate test data for a category
  generateTestData(category, count) {
    const data = [];
    for (let i = 0; i < count; i++) {
      data.push(this.generateSingleTest(category, i));
    }
    return data;
  }

  generateSingleTest(category, id) {
    const generators = {
      'single-session-info': () => ({
        content: `The project codename is Alpha-${id}`,
        query: `What is the project codename?`,
        expected: `Alpha-${id}`
      }),
      'single-session-preference': () => ({
        content: `I prefer using TypeScript for project ${id} because of type safety`,
        query: `What do I prefer for project ${id}?`,
        expected: `TypeScript`
      }),
      'single-session-assistant': () => ({
        content: `I scheduled the meeting for project ${id}`,
        role: 'assistant',
        query: `What did you do for project ${id}?`,
        expected: `scheduled the meeting`
      }),
      'multi-session-reasoning': () => ({
        sessions: [
          { content: `I work at Company-${id}`, daysAgo: 10 },
          { content: `My role at Company-${id} is senior engineer`, daysAgo: 5 }
        ],
        query: `Where do I work and what is my role?`,
        expected: `Company-${id}, senior engineer`
      }),
      'temporal-reasoning': () => ({
        sessions: [
          { content: `My favorite restaurant for ${id} is Luigi's`, daysAgo: 30 },
          { content: `Luigi's closed down for ${id}`, daysAgo: 15 },
          { content: `I tried the new Thai place for ${id} and loved it`, daysAgo: 5 }
        ],
        query: `What is my current favorite restaurant for ${id}?`,
        expected: `Thai place`
      }),
      'knowledge-updates': () => ({
        sessions: [
          { content: `My phone number for ${id} is 555-0100`, daysAgo: 60 },
          { content: `I changed my number for ${id} to 555-0199`, daysAgo: 10 }
        ],
        query: `What is my current phone number for ${id}?`,
        expected: `555-0199`
      })
    };
    return generators[category]();
  }

  // Test 1: Scale Test
  async runScaleTest(category, scale) {
    console.log(`  Scale test: ${category} @ ${scale} memories`);
    const sessionId = this.getSessionId();
    const testData = this.generateTestData(category, scale);
    
    // Store memories
    const storeStart = Date.now();
    for (const test of testData) {
      if (test.sessions) {
        for (const session of test.sessions) {
          await this.storeMemory(sessionId, session.content, 'user', session.daysAgo);
        }
      } else {
        await this.storeMemory(sessionId, test.content, test.role || 'user', 0);
      }
    }
    const storeTime = Date.now() - storeStart;

    // Query and measure
    const queryResults = [];
    const sampleSize = Math.min(100, scale);
    for (let i = 0; i < sampleSize; i++) {
      const test = testData[i];
      const { latency, entries } = await this.queryMemory(sessionId, test.query);
      queryResults.push({ latency, entries, expected: test.expected });
    }

    // Calculate stats
    const latencies = queryResults.map(r => r.latency);
    latencies.sort((a, b) => a - b);
    
    return {
      category,
      scale,
      storeTimeMs: storeTime,
      storeRate: Math.round(scale / (storeTime / 1000)),
      queryStats: {
        p50: latencies[Math.floor(latencies.length * 0.5)],
        p95: latencies[Math.floor(latencies.length * 0.95)],
        p99: latencies[Math.floor(latencies.length * 0.99)],
        min: latencies[0],
        max: latencies[latencies.length - 1]
      }
    };
  }

  // Test 2: Noise Test
  async runNoiseTest(category, noiseRatio) {
    console.log(`  Noise test: ${category} @ 1:${noiseRatio}`);
    const sessionId = this.getSessionId();
    const signalCount = 100;
    const noiseCount = signalCount * noiseRatio;
    
    // Store signal memories
    const signalData = this.generateTestData(category, signalCount);
    for (const test of signalData) {
      await this.storeMemory(sessionId, test.content, 'user', 0);
    }
    
    // Store noise memories
    for (let i = 0; i < noiseCount; i++) {
      await this.storeMemory(sessionId, `Random noise content ${i} about unrelated topics`, 'user', 0);
    }

    // Test recall accuracy
    let correct = 0;
    const sampleSize = 20;
    for (let i = 0; i < sampleSize; i++) {
      const test = signalData[i];
      const { entries } = await this.queryMemory(sessionId, test.query);
      if (entries.length > 0 && entries[0].content.includes(test.expected)) {
        correct++;
      }
    }

    return {
      category,
      noiseRatio: `1:${noiseRatio}`,
      signalCount,
      noiseCount,
      accuracy: (correct / sampleSize * 100).toFixed(2)
    };
  }

  // Test 3: Concurrency Test
  async runConcurrencyTest(category, concurrency) {
    console.log(`  Concurrency test: ${category} @ ${concurrency} concurrent`);
    const sessionId = this.getSessionId();
    const testData = this.generateTestData(category, 100);
    
    // Store test data
    for (const test of testData.slice(0, 10)) {
      await this.storeMemory(sessionId, test.content, 'user', 0);
    }

    // Run concurrent queries
    const start = Date.now();
    const promises = [];
    for (let i = 0; i < concurrency; i++) {
      const test = testData[i % 10];
      promises.push(this.queryMemory(sessionId, test.query));
    }
    
    const results = await Promise.all(promises);
    const totalTime = Date.now() - start;

    const latencies = results.map(r => r.latency);
    latencies.sort((a, b) => a - b);

    return {
      category,
      concurrency,
      totalTimeMs: totalTime,
      throughput: Math.round(concurrency / (totalTime / 1000)),
      latencyStats: {
        p50: latencies[Math.floor(latencies.length * 0.5)],
        p95: latencies[Math.floor(latencies.length * 0.95)],
        p99: latencies[Math.floor(latencies.length * 0.99)]
      }
    };
  }

  // Test 4: Retention Test
  async runRetentionTest(category, days) {
    console.log(`  Retention test: ${category} @ ${days} days`);
    const sessionId = this.getSessionId();
    const testData = this.generateTestData(category, 50);
    
    // Store with age
    for (const test of testData) {
      if (test.sessions) {
        for (const session of test.sessions) {
          await this.storeMemory(sessionId, session.content, 'user', session.daysAgo + days);
        }
      } else {
        await this.storeMemory(sessionId, test.content, test.role || 'user', days);
      }
    }

    // Test recall
    let correct = 0;
    const sampleSize = 20;
    for (let i = 0; i < sampleSize; i++) {
      const test = testData[i];
      const { entries } = await this.queryMemory(sessionId, test.query);
      if (entries.length > 0) {
        const isCorrect = await this.judgeAnswer(test.query, test.expected, entries[0].content);
        if (isCorrect) correct++;
      }
    }

    return {
      category,
      retentionDays: days,
      accuracy: (correct / sampleSize * 100).toFixed(2)
    };
  }

  // Run all tests
  async runAllTests() {
    console.log('='.repeat(60));
    console.log('Engram Comprehensive Stress Test Suite');
    console.log('='.repeat(60));
    console.log(`API: ${CONFIG.engramApiUrl}`);
    console.log(`Started: ${new Date().toISOString()}`);
    console.log('');

    // Create output directory
    if (!fs.existsSync(CONFIG.outputDir)) {
      fs.mkdirSync(CONFIG.outputDir, { recursive: true });
    }

    // Run scale tests
    console.log('\n📊 SCALE TESTS');
    console.log('-'.repeat(60));
    this.results.tests.scale = {};
    for (const category of CATEGORIES) {
      this.results.tests.scale[category] = [];
      for (const scale of SCALES) {
        const result = await this.runScaleTest(category, scale);
        this.results.tests.scale[category].push(result);
      }
    }

    // Run noise tests
    console.log('\n🔊 NOISE TESTS');
    console.log('-'.repeat(60));
    this.results.tests.noise = {};
    for (const category of CATEGORIES) {
      this.results.tests.noise[category] = [];
      for (const ratio of NOISE_RATIOS) {
        const result = await this.runNoiseTest(category, ratio);
        this.results.tests.noise[category].push(result);
      }
    }

    // Run concurrency tests
    console.log('\n⚡ CONCURRENCY TESTS');
    console.log('-'.repeat(60));
    this.results.tests.concurrency = {};
    for (const category of CATEGORIES) {
      this.results.tests.concurrency[category] = [];
      for (const level of CONCURRENCY_LEVELS) {
        const result = await this.runConcurrencyTest(category, level);
        this.results.tests.concurrency[category].push(result);
      }
    }

    // Run retention tests
    console.log('\n⏰ RETENTION TESTS');
    console.log('-'.repeat(60));
    this.results.tests.retention = {};
    for (const category of CATEGORIES) {
      this.results.tests.retention[category] = [];
      for (const days of RETENTION_DAYS) {
        const result = await this.runRetentionTest(category, days);
        this.results.tests.retention[category].push(result);
      }
    }

    // Save results
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = path.join(CONFIG.outputDir, `stress-test-${timestamp}.json`);
    const mdPath = path.join(CONFIG.outputDir, `stress-test-${timestamp}.md`);

    fs.writeFileSync(jsonPath, JSON.stringify(this.results, null, 2));
    fs.writeFileSync(mdPath, this.generateReport());

    console.log('\n' + '='.repeat(60));
    console.log('COMPLETE');
    console.log('='.repeat(60));
    console.log(`JSON: ${jsonPath}`);
    console.log(`Report: ${mdPath}`);

    return this.results;
  }

  generateReport() {
    const { tests } = this.results;
    
    let md = `# Engram Stress Test Results\n\n`;
    md += `**Date:** ${new Date().toISOString()}\n\n`;
    md += `**API:** ${CONFIG.engramApiUrl}\n\n`;
    md += `---\n\n`;

    // Scale tests summary
    md += `## Scale Tests\n\n`;
    md += `Memory storage and retrieval performance at different scales.\n\n`;
    md += `| Category | Scale | Store Rate | p50 Latency | p95 Latency | p99 Latency |\n`;
    md += `|----------|-------|------------|-------------|-------------|-------------|\n`;
    
    for (const [category, results] of Object.entries(tests.scale)) {
      for (const r of results) {
        md += `| ${category} | ${r.scale.toLocaleString()} | ${r.storeRate}/s | ${r.queryStats.p50}ms | ${r.queryStats.p95}ms | ${r.queryStats.p99}ms |\n`;
      }
    }

    // Noise tests summary
    md += `\n## Noise Resistance Tests\n\n`;
    md += `Accuracy when retrieving signals from noisy datasets.\n\n`;
    md += `| Category | Noise Ratio | Accuracy |\n`;
    md += `|----------|-------------|----------|\n`;
    
    for (const [category, results] of Object.entries(tests.noise)) {
      for (const r of results) {
        md += `| ${category} | ${r.noiseRatio} | ${r.accuracy}% |\n`;
      }
    }

    // Concurrency tests summary
    md += `\n## Concurrency Tests\n\n`;
    md += `Performance under concurrent query load.\n\n`;
    md += `| Category | Concurrency | Throughput | p50 Latency | p95 Latency |\n`;
    md += `|----------|-------------|------------|-------------|-------------|\n`;
    
    for (const [category, results] of Object.entries(tests.concurrency)) {
      for (const r of results) {
        md += `| ${category} | ${r.concurrency} | ${r.throughput}/s | ${r.latencyStats.p50}ms | ${r.latencyStats.p95}ms |\n`;
      }
    }

    // Retention tests summary
    md += `\n## Retention Tests\n\n`;
    md += `Accuracy after simulated time gaps.\n\n`;
    md += `| Category | Retention Period | Accuracy |\n`;
    md += `|----------|------------------|----------|\n`;
    
    for (const [category, results] of Object.entries(tests.retention)) {
      for (const r of results) {
        md += `| ${category} | ${r.retentionDays} days | ${r.accuracy}% |\n`;
      }
    }

    md += `\n---\n\n`;
    md += `*Generated by Engram Stress Test Suite*\n`;

    return md;
  }
}

// Run if called directly
if (require.main === module) {
  const runner = new StressTestRunner();
  runner.runAllTests().catch(console.error);
}

module.exports = { StressTestRunner };
