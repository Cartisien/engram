#!/usr/bin/env node
/**
 * Engram LongMemEval-Style Benchmark
 * 
 * Tests Engram against the 6 categories from LongMemEval:
 * 1. Single-Session Information
 * 2. Single-Session Preference
 * 3. Single-Session Assistant
 * 4. Multi-Session Reasoning
 * 5. Temporal Reasoning
 * 6. Knowledge Updates
 * 
 * Usage: node run-benchmark.js --stacks 100 --output results.json
 */

const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  engramApiUrl: process.env.ENGRAM_API_URL || 'http://localhost:3470',
  userId: process.env.ENGRAM_USER_ID || 'benchmark-user',
  openAiKey: process.env.OPENAI_API_KEY,
  judgeModel: process.env.JUDGE_MODEL || 'gpt-4o',
  categories: [
    'single-session-info',
    'single-session-preference', 
    'single-session-assistant',
    'multi-session-reasoning',
    'temporal-reasoning',
    'knowledge-updates'
  ]
};

// Parse CLI args
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    stacks: 100,
    output: `results-${new Date().toISOString().slice(0,10)}.json`,
    verbose: false
  };
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stacks' && args[i+1]) {
      options.stacks = parseInt(args[i+1]);
      i++;
    } else if (args[i] === '--output' && args[i+1]) {
      options.output = args[i+1];
      i++;
    } else if (args[i] === '--verbose') {
      options.verbose = true;
    }
  }
  return options;
}

// Generate synthetic conversation stack
function generateStack(category, stackId) {
  const stacks = {
    'single-session-info': () => generateSingleSessionInfo(stackId),
    'single-session-preference': () => generateSingleSessionPreference(stackId),
    'single-session-assistant': () => generateSingleSessionAssistant(stackId),
    'multi-session-reasoning': () => generateMultiSessionReasoning(stackId),
    'temporal-reasoning': () => generateTemporalReasoning(stackId),
    'knowledge-updates': () => generateKnowledgeUpdates(stackId)
  };
  return stacks[category]();
}

// Category 1: Single-Session Information
function generateSingleSessionInfo(id) {
  const facts = [
    { entity: 'project', value: 'Alpha', attr: 'codename' },
    { entity: 'meeting', value: 'Tuesday at 3pm', attr: 'time' },
    { entity: 'budget', value: '$50,000', attr: 'amount' },
    { entity: 'deadline', value: 'March 15th', attr: 'date' },
    { entity: 'client', value: 'Acme Corp', attr: 'name' }
  ];
  const fact = facts[id % facts.length];
  
  return {
    sessions: [
      {
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        messages: [
          { role: 'user', content: `The ${fact.entity} ${fact.attr} is ${fact.value}.` },
          { role: 'assistant', content: `Got it. I've noted that the ${fact.entity} ${fact.attr} is ${fact.value}.` }
        ]
      }
    ],
    question: `What is the ${fact.entity} ${fact.attr}?`,
    expectedAnswer: fact.value,
    category: 'single-session-info'
  };
}

// Category 2: Single-Session Preference
function generateSingleSessionPreference(id) {
  const preferences = [
    { topic: 'programming language', pref: 'TypeScript', reason: 'type safety' },
    { topic: 'meeting time', pref: 'mornings', reason: 'more focused' },
    { topic: 'communication', pref: 'async', reason: 'deep work' },
    { topic: 'coffee', pref: 'black', reason: 'simplicity' },
    { topic: 'editor', pref: 'VS Code', reason: 'extensions' }
  ];
  const p = preferences[id % preferences.length];
  
  return {
    sessions: [
      {
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        messages: [
          { role: 'user', content: `I prefer ${p.topic === 'coffee' ? '' : 'using '}${p.pref} for ${p.topic} because I'm ${p.reason}.` },
          { role: 'assistant', content: `Noted! You prefer ${p.pref} for ${p.topic}.` }
        ]
      }
    ],
    question: `What do I prefer for ${p.topic}?`,
    expectedAnswer: p.pref,
    category: 'single-session-preference'
  };
}

// Category 3: Single-Session Assistant
function generateSingleSessionAssistant(id) {
  const actions = [
    { action: 'scheduled a meeting for Friday', time: '2pm' },
    { action: 'created a todo list', items: '3 tasks' },
    { action: 'sent an email to the team', subject: 'Q1 update' },
    { action: 'reminded you about the dentist', date: 'next week' },
    { action: 'booked a flight to Seattle', airline: 'Alaska' }
  ];
  const a = actions[id % actions.length];
  
  return {
    sessions: [
      {
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        messages: [
          { role: 'user', content: `Please ${a.action}.` },
          { role: 'assistant', content: `Done! I've ${a.action}${a.time ? ` at ${a.time}` : ''}${a.items ? ` with ${a.items}` : ''}.` }
        ]
      }
    ],
    question: `What did you do for me in our last conversation?`,
    expectedAnswer: a.action,
    category: 'single-session-assistant'
  };
}

// Category 4: Multi-Session Reasoning
function generateMultiSessionReasoning(id) {
  const scenarios = [
    {
      sessions: [
        { content: 'I work at TechCorp as a senior engineer.', daysAgo: 5 },
        { content: 'My manager asked me to lead the new API project.', daysAgo: 3 },
        { content: 'I need to hire two more developers for the team.', daysAgo: 1 }
      ],
      question: 'Where do I work and what project am I leading?',
      expected: 'TechCorp, API project'
    },
    {
      sessions: [
        { content: 'I bought a house in Portland last year.', daysAgo: 7 },
        { content: 'The roof needs repairs after the winter storm.', daysAgo: 2 },
        { content: 'I\'m getting quotes from contractors.', daysAgo: 1 }
      ],
      question: 'Where is my house and what needs fixing?',
      expected: 'Portland, roof'
    }
  ];
  const s = scenarios[id % scenarios.length];
  
  return {
    sessions: s.sessions.map(sess => ({
      timestamp: new Date(Date.now() - sess.daysAgo * 86400000).toISOString(),
      messages: [
        { role: 'user', content: sess.content },
        { role: 'assistant', content: 'Got it. I\'ll remember that.' }
      ]
    })),
    question: s.question,
    expectedAnswer: s.expected,
    category: 'multi-session-reasoning'
  };
}

// Category 5: Temporal Reasoning
function generateTemporalReasoning(id) {
  const scenarios = [
    {
      sessions: [
        { content: 'My favorite restaurant is Luigi\'s.', daysAgo: 10 },
        { content: 'Luigi\'s closed down last month.', daysAgo: 5 },
        { content: 'I tried the new Thai place and loved it.', daysAgo: 2 }
      ],
      question: 'What is my current favorite restaurant?',
      expected: 'the new Thai place'
    },
    {
      sessions: [
        { content: 'I drive a Honda Civic.', daysAgo: 14 },
        { content: 'Sold the Civic and bought a Tesla Model 3.', daysAgo: 3 },
        { content: 'The Tesla is great but charging is tricky.', daysAgo: 1 }
      ],
      question: 'What car do I currently drive?',
      expected: 'Tesla Model 3'
    }
  ];
  const s = scenarios[id % scenarios.length];
  
  return {
    sessions: s.sessions.map(sess => ({
      timestamp: new Date(Date.now() - sess.daysAgo * 86400000).toISOString(),
      messages: [
        { role: 'user', content: sess.content },
        { role: 'assistant', content: 'Noted!' }
      ]
    })),
    question: s.question,
    expectedAnswer: s.expected,
    category: 'temporal-reasoning'
  };
}

// Category 6: Knowledge Updates
function generateKnowledgeUpdates(id) {
  const scenarios = [
    {
      sessions: [
        { content: 'The API endpoint is api.example.com/v1.', daysAgo: 7 },
        { content: 'They migrated to api.example.com/v2 last week.', daysAgo: 2 },
        { content: 'The v2 endpoint has better rate limits.', daysAgo: 1 }
      ],
      question: 'What is the current API endpoint?',
      expected: 'api.example.com/v2'
    },
    {
      sessions: [
        { content: 'My phone number is 555-0100.', daysAgo: 30 },
        { content: 'I changed my number to 555-0199.', daysAgo: 2 }
      ],
      question: 'What is my current phone number?',
      expected: '555-0199'
    }
  ];
  const s = scenarios[id % scenarios.length];
  
  return {
    sessions: s.sessions.map(sess => ({
      timestamp: new Date(Date.now() - sess.daysAgo * 86400000).toISOString(),
      messages: [
        { role: 'user', content: sess.content },
        { role: 'assistant', content: 'Updated!' }
      ]
    })),
    question: s.question,
    expectedAnswer: s.expected,
    category: 'knowledge-updates'
  };
}

// Store sessions in Engram
async function storeSessions(stack, sessionId) {
  for (const session of stack.sessions) {
    for (const msg of session.messages) {
      await fetch(`${CONFIG.engramApiUrl}/memory/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: msg.content,
          role: msg.role,
          timestamp: session.timestamp
        })
      });
    }
  }
}

// Query Engram and get answer
async function queryEngram(question, sessionId) {
  const response = await fetch(
    `${CONFIG.engramApiUrl}/memory/${sessionId}?query=${encodeURIComponent(question)}&limit=10`
  );
  const data = await response.json();
  const memories = data.entries || [];
  
  // Use GPT-4o to answer based on retrieved memories
  const context = memories.map(m => m.content).join('\n');
  
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
          content: 'Answer the question based ONLY on the provided context. Be concise.'
        },
        {
          role: 'user',
          content: `Context:\n${context}\n\nQuestion: ${question}\n\nAnswer:`
        }
      ],
      temperature: 0
    })
  });
  
  const result = await completion.json();
  return result.choices[0].message.content;
}

// Judge if answer is correct
async function judgeAnswer(question, expected, actual) {
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
          content: `Question: ${question}\nExpected: ${expected}\nActual: ${actual}\n\nIs the actual answer semantically correct? Reply CORRECT or INCORRECT.`
        }
      ],
      temperature: 0
    })
  });
  
  const result = await completion.json();
  const verdict = result.choices[0].message.content.trim().toUpperCase();
  return verdict === 'CORRECT';
}

// Generate unique session ID for each test
function getSessionId(testIndex) {
  return `${CONFIG.userId}-${testIndex}`;
}

// Run single test
async function runTest(stack, testIndex, verbose) {
  const sessionId = getSessionId(testIndex);
  try {
    // Store sessions
    await storeSessions(stack, sessionId);
    
    // Query
    const answer = await queryEngram(stack.question, sessionId);
    
    // Judge
    const isCorrect = await judgeAnswer(stack.question, stack.expectedAnswer, answer);
    
    if (verbose) {
      console.log(`  Q: ${stack.question}`);
      console.log(`  Expected: ${stack.expectedAnswer}`);
      console.log(`  Actual: ${answer}`);
      console.log(`  Result: ${isCorrect ? '✓' : '✗'}`);
    }
    
    return {
      category: stack.category,
      question: stack.question,
      expected: stack.expectedAnswer,
      actual: answer,
      correct: isCorrect
    };
  } catch (error) {
    console.error(`Error in test: ${error.message}`);
    return {
      category: stack.category,
      question: stack.question,
      error: error.message,
      correct: false
    };
  }
}

// Main benchmark runner
async function main() {
  const options = parseArgs();
  
  console.log('='.repeat(60));
  console.log('Engram LongMemEval-Style Benchmark');
  console.log('='.repeat(60));
  console.log(`Stacks: ${options.stacks}`);
  console.log(`Judge: ${CONFIG.judgeModel}`);
  console.log(`Engram API: ${CONFIG.engramApiUrl}`);
  console.log('');
  
  if (!CONFIG.openAiKey) {
    console.error('Error: OPENAI_API_KEY environment variable required');
    process.exit(1);
  }
  
  // Generate test stacks
  const stacks = [];
  for (let i = 0; i < options.stacks; i++) {
    const category = CONFIG.categories[i % CONFIG.categories.length];
    stacks.push(generateStack(category, i));
  }
  
  // Run tests
  const results = [];
  const startTime = Date.now();
  
  for (let i = 0; i < stacks.length; i++) {
    const stack = stacks[i];
    console.log(`[${i + 1}/${options.stacks}] ${stack.category}`);
    
    const result = await runTest(stack, i, options.verbose);
    results.push(result);
  }
  
  const duration = (Date.now() - startTime) / 1000;
  
  // Calculate scores
  const byCategory = {};
  CONFIG.categories.forEach(c => byCategory[c] = { correct: 0, total: 0 });
  
  results.forEach(r => {
    byCategory[r.category].total++;
    if (r.correct) byCategory[r.category].correct++;
  });
  
  const totalCorrect = results.filter(r => r.correct).length;
  const overallScore = (totalCorrect / results.length * 100).toFixed(2);
  
  // Output results
  console.log('');
  console.log('='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`Overall: ${overallScore}% (${totalCorrect}/${results.length})`);
  console.log(`Duration: ${duration.toFixed(1)}s`);
  console.log('');
  console.log('By Category:');
  
  Object.entries(byCategory).forEach(([cat, stats]) => {
    const score = stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(2) : 'N/A';
    console.log(`  ${cat}: ${score}% (${stats.correct}/${stats.total})`);
  });
  
  // Save results
  const output = {
    timestamp: new Date().toISOString(),
    config: CONFIG,
    options,
    summary: {
      overall: `${overallScore}%`,
      correct: totalCorrect,
      total: results.length,
      duration: `${duration.toFixed(1)}s`
    },
    byCategory,
    results
  };
  
  fs.writeFileSync(options.output, JSON.stringify(output, null, 2));
  console.log('');
  console.log(`Results saved to: ${options.output}`);
  
  // Compare to Hydra DB
  console.log('');
  console.log('='.repeat(60));
  console.log('COMPARISON: Engram vs Hydra DB');
  console.log('='.repeat(60));
  
  const hydraScores = {
    'single-session-info': 100,
    'single-session-preference': 96.67,
    'single-session-assistant': 100,
    'multi-session-reasoning': 76.69,
    'temporal-reasoning': 90.97,
    'knowledge-updates': 97.4
  };
  
  console.log('Category                  | Engram | Hydra DB | Diff');
  console.log('-'.repeat(60));
  Object.entries(byCategory).forEach(([cat, stats]) => {
    const engram = stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(2) : 'N/A';
    const hydra = hydraScores[cat];
    const diff = stats.total > 0 ? (parseFloat(engram) - hydra).toFixed(2) : 'N/A';
    const diffStr = diff !== 'N/A' ? (parseFloat(diff) >= 0 ? `+${diff}` : diff) : 'N/A';
    console.log(`${cat.padEnd(25)} | ${engram.padStart(6)} | ${hydra.toString().padStart(8)} | ${diffStr}`);
  });
  console.log('-'.repeat(60));
  const hydraOverall = 90.79;
  const diffOverall = (parseFloat(overallScore) - hydraOverall).toFixed(2);
  console.log(`${'OVERALL'.padEnd(25)} | ${overallScore.padStart(6)} | ${hydraOverall.toString().padStart(8)} | ${diffOverall >= 0 ? '+' : ''}${diffOverall}`);
}

main().catch(console.error);
