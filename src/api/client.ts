// Weaver API Client — communicates with Node.js backend which proxies to Python service

const BASE = `http://${window.location.hostname}:1234`;

async function call(method: string, path: string, body?: unknown) {
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.detail || err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Session API ──────────────────────────────────────────────────────────────
export const createSession = () => call('POST', '/sessions');
export const getSession = (id: string) => call('GET', `/sessions/${id}`);
export const getFile = (sessionId: string, file: string) =>
  call('GET', `/sessions/${sessionId}/files/${file}`);
export const saveFile = (sessionId: string, file: string, content: string) =>
  call('PUT', `/sessions/${sessionId}/files/${file}`, { content });

// ─── AST / ML API ─────────────────────────────────────────────────────────────
export const parseSource = (source: string, file = 'main.py') =>
  call('POST', '/api/parse', { source, file });

export const diffSource = (oldSource: string, newSource: string, file = 'main.py') =>
  call('POST', '/api/diff', { old_source: oldSource, new_source: newSource, file });

export const analyzeChanges = (changeA: unknown, changeB: unknown) =>
  call('POST', '/api/analyze', { change_a: changeA, change_b: changeB });

export const classifyChanges = (changeA: unknown, changeB: unknown) =>
  call('POST', '/api/classify', { change_a: changeA, change_b: changeB });

// ─── Code Execution & Tooling ─────────────────────────────────────────────────
export const runCode = (
  source: string,
  filename = 'script.py',
  stdin = '',
  all_files?: Record<string, string>,
) => call('POST', '/api/run', { source, filename, stdin, all_files });

export const runRepl = (code: string, sessionId?: string) =>
  call('POST', '/api/repl', { code, session_id: sessionId });

export const formatCode = (source: string) =>
  call('POST', '/api/format', { source });

export const lintCode = (source: string, filename = 'script.py') =>
  call('POST', '/api/lint', { source, filename });

// ─── ML Training / Evaluation ─────────────────────────────────────────────────
export const trainModel = (algorithm = 'random_forest', nSamples = 100000) =>
  call('POST', '/api/train', { algorithm, n_samples: nSamples });

export const evaluateModel = () => call('POST', '/api/evaluate');

export const getModelStatus = () => call('GET', '/api/model/status');

export const getDatasetStats = () => call('GET', '/api/dataset/stats');

// ─── Demo Scenarios ───────────────────────────────────────────────────────────
export const runDemoScenario = (scenario: 'compatible' | 'conflict') =>
  call('POST', `/api/demo/scenario?scenario=${scenario}`);

export const smartMerge = (hostCode: string, collaboratorCode: string, filename: string) =>
  call('POST', '/api/smart-merge', { host_code: hostCode, collaborator_code: collaboratorCode, filename });

