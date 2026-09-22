/**
 * Weaver Backend Server
 * - y-websocket relay for Yjs CRDT synchronization
 * - REST proxy to Python FastAPI service
 * - Session management
 */
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { setupWSConnection } from 'y-websocket/bin/utils';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = 1234;
const PYTHON_SERVICE = process.env.PYTHON_URL || 'http://localhost:8000';

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ─── Session store ────────────────────────────────────────────────────────────
const sessions = new Map();

const DEFAULT_FILES = {
  'main.py': `def calculate(x):
    return x * 2

def greet(name):
    return f"Hello, {name}!"
`,
  'utils.py': `def format_output(value):
    return str(value).strip()

def clamp(val, lo, hi):
    return max(lo, min(hi, val))
`,
  'models.py': `class DataModel:
    def __init__(self, data):
        self.data = data

    def validate(self):
        return self.data is not None
`,
};

app.get('/health', (_, res) => res.json({ status: 'ok', python: PYTHON_SERVICE }));

// Create a new collaboration session
app.post('/sessions', (req, res) => {
  const sessionId = Math.random().toString(36).slice(2, 8).toUpperCase();
  sessions.set(sessionId, {
    users: new Set(),
    created: Date.now(),
    files: { ...DEFAULT_FILES },
  });
  console.log(`[session] Created: ${sessionId}`);
  res.json({ sessionId });
});

// Get session info
app.get('/sessions/:id', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  res.json({
    sessionId: req.params.id,
    userCount: s.users.size,
    files: Object.keys(s.files),
  });
});

// Get file content
app.get('/sessions/:id/files/:file', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  const content = s.files[req.params.file];
  if (content === undefined) return res.status(404).json({ error: 'File not found' });
  res.json({ file: req.params.file, content });
});

// ─── Proxy to Python service ──────────────────────────────────────────────────
async function proxyToPython(path, method, body, res) {
  try {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(`${PYTHON_SERVICE}${path}`, opts);
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: 'Python service unavailable', detail: e.message });
  }
}

app.post('/api/parse',    (req, res) => proxyToPython('/parse',    'POST', req.body, res));
app.post('/api/diff',     (req, res) => proxyToPython('/diff',     'POST', req.body, res));
app.post('/api/analyze',  (req, res) => proxyToPython('/analyze',  'POST', req.body, res));
app.post('/api/classify', (req, res) => proxyToPython('/classify', 'POST', req.body, res));
app.post('/api/train',    (req, res) => proxyToPython('/train',    'POST', req.body, res));
app.post('/api/evaluate', (req, res) => proxyToPython('/evaluate', 'POST', {}, res));
app.get('/api/model/status',   (req, res) => proxyToPython('/model/status',   'GET', null, res));
app.get('/api/dataset/stats',  (req, res) => proxyToPython('/dataset/stats',  'GET', null, res));
app.post('/api/demo/scenario', (req, res) => {
  const scenario = req.query.scenario || 'compatible';
  proxyToPython(`/demo/scenario?scenario=${scenario}`, 'POST', {}, res);
});

// ─── HTTP + WebSocket server ──────────────────────────────────────────────────
const server = createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  console.log(`[ws] New connection: ${req.url}`);
  setupWSConnection(ws, req);
});

server.listen(PORT, () => {
  console.log(`\n🧵 Weaver relay server running`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
  console.log(`   REST API:  http://localhost:${PORT}/api/*`);
  console.log(`   Python:    ${PYTHON_SERVICE}`);
  console.log('');
});
