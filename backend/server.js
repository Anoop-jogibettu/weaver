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
import jwt from 'jsonwebtoken';
import path from 'path';

const app = express();
const PORT = 1234;
const PYTHON_SERVICE = process.env.PYTHON_URL || 'http://localhost:8000';
const JWT_SECRET = process.env.JWT_SECRET || 'weaver-dev-secret-change-in-production';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ─── JWT Helpers ──────────────────────────────────────────────────────────────
function generateSessionToken(sessionId, userId, isHost) {
  return jwt.sign({ sessionId, userId, isHost, iat: Date.now() }, JWT_SECRET, { expiresIn: '24h' });
}

function verifySessionToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function sanitizeFilePath(filePath) {
  // Prevent path traversal: only allow basename, no .. or absolute paths
  const clean = path.basename(filePath);
  if (clean !== filePath || clean.startsWith('.') || clean.includes('..')) {
    return null;
  }
  return clean;
}

// ─── Session store ────────────────────────────────────────────────────────────
// Each session tracks:
//   host        - userId of current host
//   joinOrder   - Map<clientId, {userId, joinedAt}> ordered by join time
//   wsClients   - Map<clientId, ws> for direct messaging

const DEFAULT_FILES = {
  'main.py': `def calculate(x):\n    return x * 2\n\ndef greet(name):\n    return f"Hello, {name}!"\n`,
};

const sessions = new Map();

function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      host: null,
      joinOrder: new Map(),  // clientId -> { userId, userName, joinedAt }
      wsClients: new Map(),  // clientId -> ws socket
      files: { ...DEFAULT_FILES },
      created: Date.now(),
    });
    console.log(`[session] Created: ${sessionId}`);
  }
  return sessions.get(sessionId);
}

function electNewHost(session, sessionId) {
  // Pick the earliest joiner that is still connected (excluding current host)
  let earliest = null;
  let earliestTime = Infinity;
  for (const [cid, info] of session.joinOrder) {
    if (session.wsClients.has(cid) && info.joinedAt < earliestTime) {
      earliest = { cid, ...info };
      earliestTime = info.joinedAt;
    }
  }
  if (!earliest) return null;

  session.host = earliest.userId;
  console.log(`[session] ${sessionId} — new host: ${earliest.userName} (${earliest.userId})`);

  // Broadcast host-transfer to all remaining clients
  const msg = JSON.stringify({
    type: 'host-transfer',
    newHostUserId: earliest.userId,
    newHostUserName: earliest.userName,
    sessionId,
  });
  for (const ws of session.wsClients.values()) {
    try { if (ws.readyState === 1) ws.send(msg); } catch {}
  }
  return earliest;
}

app.get('/health', (_, res) => res.json({ status: 'ok', python: PYTHON_SERVICE }));

// Create a new collaboration session
app.post('/sessions', (req, res) => {
  const sessionId = Math.random().toString(36).slice(2, 8).toUpperCase();
  getOrCreateSession(sessionId);
  res.json({ sessionId });
});

// Get session info
app.get('/sessions/:id', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  res.json({
    sessionId: req.params.id,
    userCount: s.wsClients.size,
    host: s.host,
    files: Object.keys(s.files),
  });
});


// Get file content
app.get('/sessions/:id/files/:file', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  const safeFile = sanitizeFilePath(req.params.file);
  if (!safeFile) return res.status(400).json({ error: 'Invalid file path' });
  const content = s.files[safeFile];
  if (content === undefined) return res.status(404).json({ error: 'File not found' });
  res.json({ file: safeFile, content });
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
app.post('/api/run',      (req, res) => proxyToPython('/run',      'POST', req.body, res));
app.post('/api/repl',     (req, res) => proxyToPython('/repl',     'POST', req.body, res));
app.post('/api/format',   (req, res) => proxyToPython('/format',   'POST', req.body, res));
app.post('/api/lint',     (req, res) => proxyToPython('/lint',     'POST', req.body, res));
app.get('/api/model/status',   (req, res) => proxyToPython('/model/status',   'GET', null, res));
app.get('/api/dataset/stats',  (req, res) => proxyToPython('/dataset/stats',  'GET', null, res));
app.post('/api/smart-merge',   (req, res) => proxyToPython('/smart-merge',    'POST', req.body, res));
app.post('/api/demo/scenario', (req, res) => {
  const scenario = req.query.scenario || 'compatible';
  proxyToPython(`/demo/scenario?scenario=${scenario}`, 'POST', {}, res);
});

// Save/update file content in a session
app.put('/sessions/:id/files/:file', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  const safeFile = sanitizeFilePath(req.params.file);
  if (!safeFile) return res.status(400).json({ error: 'Invalid file path' });
  s.files[safeFile] = req.body.content || '';
  res.json({ ok: true, file: safeFile });
});

// Rename file in session
app.post('/sessions/:id/files/:file/rename', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  const safeFile = sanitizeFilePath(req.params.file);
  if (!safeFile) return res.status(400).json({ error: 'Invalid file path' });
  const newName = req.body.newName;
  if (!newName) return res.status(400).json({ error: 'newName is required' });
  const safeNewName = sanitizeFilePath(newName);
  if (!safeNewName) return res.status(400).json({ error: 'Invalid new file path' });
  if (s.files[safeFile] !== undefined) {
    s.files[safeNewName] = s.files[safeFile];
    delete s.files[safeFile];
  }
  res.json({ ok: true, oldFile: safeFile, newFile: safeNewName });
});

// Delete file in session
app.delete('/sessions/:id/files/:file', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  const safeFile = sanitizeFilePath(req.params.file);
  if (!safeFile) return res.status(400).json({ error: 'Invalid file path' });
  delete s.files[safeFile];
  res.json({ ok: true, file: safeFile });
});

// ─── HTTP + WebSocket server ──────────────────────────────────────────────────
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Custom connection handler: wraps y-websocket's setupWSConnection and adds
// host-tracking, join-order recording, and failover logic.
wss.on('connection', (ws, req) => {
  // Parse sessionId from URL: /weaver-ABCDEF?token=xxx
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const urlParts = url.pathname.split('/');
  const roomName = urlParts[urlParts.length - 1] || '';
  const sessionId = roomName.replace(/^weaver-/, '');
  const clientId  = Math.random().toString(36).slice(2, 10);

  // Verify JWT token from query param (bypassed for dev)
  const token = url.searchParams.get('token');
  const decoded = token ? verifySessionToken(token) : { userId: 'anonymous' };
  
  console.log(`[ws] New connection: ${req.url} (client: ${clientId})`);


  // Attach y-websocket CRDT sync (this handles all Yjs messages)
  setupWSConnection(ws, req);

  const session = getOrCreateSession(sessionId);
  session.wsClients.set(clientId, ws);

  // First connected client becomes host automatically
  const isFirstClient = session.joinOrder.size === 0;

  // We get userId/userName from a client 'register' message sent right after connection
  // Store a provisional entry; update when register arrives
  session.joinOrder.set(clientId, {
    userId: clientId,       // temp; overwritten on 'register'
    userName: 'Unknown',
    joinedAt: Date.now(),
    isHost: isFirstClient,
  });

  if (isFirstClient) {
    session.host = clientId;
    // Tell this client it is the host
    try {
      ws.send(JSON.stringify({ type: 'host-assign', isHost: true, sessionId }));
    } catch {}
  } else {
    // Tell this client the current host userId
    try {
      ws.send(JSON.stringify({ type: 'host-assign', isHost: false, sessionId, currentHostUserId: session.host }));
    } catch {}
  }

  ws.on('message', (raw) => {
    // Only intercept text/JSON messages; binary are Yjs protocol, ignore
    let str = null;
    if (Buffer.isBuffer(raw) && raw.length > 0 && raw[0] === 123) { // 123 is '{'
      str = raw.toString('utf8');
    } else if (typeof raw === 'string') {
      str = raw;
    }
    
    if (!str || !str.trim().startsWith('{')) return;
    let msg;
    try { msg = JSON.parse(str); } catch { return; }

    if (msg.type === 'register') {
      // Client announcing identity after joining
      const entry = session.joinOrder.get(clientId);
      if (entry) {
        entry.userId   = msg.userId   || clientId;
        entry.userName = msg.userName || 'User';
      }
      if (isFirstClient || session.host === clientId) {
        session.host = msg.userId;
        if (entry) entry.userId = msg.userId;
      }
      console.log(`[session] ${sessionId} register: ${msg.userName} (host=${isFirstClient})`);
    }
  });

  ws.on('close', () => {
    console.log(`[ws] Disconnected: ${req.url} (client: ${clientId})`);
    const entry = session.joinOrder.get(clientId);
    session.wsClients.delete(clientId);
    session.joinOrder.delete(clientId);

    // If the disconnected client was the host, elect a new one
    const wasHost = entry && (entry.userId === session.host || entry.isHost);
    if (wasHost && session.wsClients.size > 0) {
      electNewHost(session, sessionId);
    }

    // Cleanup empty session
    if (session.wsClients.size === 0) {
      console.log(`[session] ${sessionId} — all clients gone, keeping session data`);
    }
  });

  ws.on('error', (err) => {
    console.error(`[ws] Error (${clientId}):`, err.message);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🧵 Weaver relay server running`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
  console.log(`   REST API:  http://localhost:${PORT}/api/*`);
  console.log(`   Python:    ${PYTHON_SERVICE}`);
  console.log('');
});
