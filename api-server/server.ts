import express from 'express';
import { Engram } from '@cartisien/engram';

const app = express();
app.use(express.json());

const memory = new Engram({ dbPath: './engram-api.db' });

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'engram-api', version: '0.1.0' });
});

// Store a memory
app.post('/memory/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { content, role = 'user', metadata } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    const entry = await memory.remember(sessionId, content, role, metadata);
    res.json({ success: true, entry });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Recall memories
app.get('/memory/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { query, limit = '10', role, before, after } = req.query;

    const options: any = {};
    if (role) options.role = role;
    if (before) options.before = new Date(before as string);
    if (after) options.after = new Date(after as string);

    const entries = await memory.recall(
      sessionId,
      query as string | undefined,
      parseInt(limit as string, 10),
      options
    );

    res.json({ success: true, count: entries.length, entries });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Get conversation history
app.get('/history/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { limit = '20' } = req.query;

    const entries = await memory.history(sessionId, parseInt(limit as string, 10));

    res.json({ success: true, count: entries.length, entries });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Delete memories
app.delete('/memory/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { id, before } = req.query;

    const options: any = {};
    if (id) options.id = id as string;
    if (before) options.before = new Date(before as string);

    const deleted = await memory.forget(sessionId, options);

    res.json({ success: true, deleted });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Get session stats
app.get('/stats/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const stats = await memory.stats(sessionId);

    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// List all sessions
app.get('/sessions', async (req, res) => {
  try {
    const stats = await memory.stats('test');
    res.json({ success: true, message: 'Sessions endpoint - implement with query' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

const PORT = process.env.PORT || 3455;

app.listen(PORT, () => {
  console.log('Engram API Server running on http://localhost:' + PORT);
  console.log('');
  console.log('Endpoints:');
  console.log('  POST   /memory/:sessionId     - Store memory');
  console.log('  GET    /memory/:sessionId     - Recall memories');
  console.log('  GET    /history/:sessionId    - Get conversation history');
  console.log('  DELETE /memory/:sessionId     - Delete memories');
  console.log('  GET    /stats/:sessionId      - Get session stats');
  console.log('  GET    /sessions              - List all sessions');
  console.log('  GET    /health                - Health check');
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await memory.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await memory.close();
  process.exit(0);
});
