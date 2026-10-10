# Weaver

**Real-Time Collaborative Python Code Editor with AST-Aware ML Conflict Guard**

Weaver is a professional collaborative programming environment designed for concurrent Python development. It combines local-first CRDT synchronization (Yjs/YATA), real-time abstract syntax tree (AST) parsing, and machine learning conflict classification to detect and prevent semantic merge collisions as developers type.

The runner supports `.py` and `.pyw` files, nested packages, and workspace imports. It uses the Python interpreter that starts the FastAPI service, so install third-party packages into that same environment. Defaults are a 60-second timeout and 2 GB memory limit; set `WEAVER_RUN_TIMEOUT_SECONDS=0` and/or `WEAVER_RUN_MEMORY_MB=0` before starting the Python service to remove either limit for local work.

```
Concurrent Edits ──► Yjs CRDT Sync ──► Real-time AST Parser ──► ML Conflict Guard ──► Python Runner
```

---

## Key Features

- **Python Workspace**: Open, create, edit, close, and rename `.py` / `.pyw` files, including nested packages, with real-time multi-tab navigation.
- **Inline File Renaming**: Rename any file directly from the Explorer sidebar or tab strip with validation and state preservation.
- **Indentation Guide Lines**: Visual indentation guide lines with active block highlighting for Python control flow and function scopes.
- **Python Execution**: Run Python scripts directly within the editor with real-time stdout, stderr, execution duration, exit codes, and stdin support.
- **Real-Time Collaboration**: Peer presence, live cursor sharing, and conflict-free concurrent editing powered by Yjs CRDTs over WebSockets.
- **AST Conflict Guard**: Monitors active functions and classes across peers to detect overlapping modifications before commits occur.

---

## Quick Start

### Prerequisites
- **Node.js**: v18 or later
- **Python**: 3.9 or later

### 1. Install Dependencies

```bash
# Frontend root
npm install

# Backend relay
cd backend && npm install && cd ..

# Python AST & execution service
cd python-service && pip3 install -r requirements.txt && cd ..
```

### 2. Start Services

Start all services with a single command:

```bash
bash start.sh
```

Or start them individually:

| Service | Command | Port / URL |
|---|---|---|
| **Python Service** | `cd python-service && python3 -m uvicorn main:app --host 127.0.0.1 --port 8000` | `http://localhost:8000/docs` |
| **Node.js Relay** | `cd backend && node server.js` | `ws://localhost:1234` / `http://localhost:1234` |
| **Frontend UI** | `npm run dev` | `http://localhost:5173` |

---

## Collaboration Workflow

1. Open `http://localhost:5173` in Browser 1 and click **New Workspace**.
2. Click **Copy** next to the Workspace ID in the header or sidebar.
3. Open `http://localhost:5173` in Browser 2, click **Join Workspace**, and enter the Workspace ID.
4. Both users can concurrently edit, rename files, run scripts, and inspect live AST conflict guard updates.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| <kbd>⌘↵</kbd> / <kbd>Ctrl+Enter</kbd> | Run active Python script |
| <kbd>⌘S</kbd> / <kbd>Ctrl+S</kbd> | Save active file to disk |
| Double-click tab or file item | Inline file rename |
| <kbd>Enter</kbd> / <kbd>Esc</kbd> | Confirm / Cancel file rename |

---

## Architecture

```
Frontend (React 19 + TypeScript + CodeMirror 6 + Yjs)
    ├── CodeEditor: CodeMirror 6 with Python highlighting & indentation guides
    ├── OutputPanel: Execution output, exit codes, and stdin stream
    └── CollabPanel: Real-time peer awareness & AST conflict monitor
          ↕ y-websocket (CRDT synchronizer)
Backend (Express + WebSocket Server)
    ├── Yjs CRDT WebSocket relay (port 1234)
    └── REST API proxy to Python service
          ↕ HTTP /api/*
Python Service (FastAPI)
    ├── AST Parser (Python ast module & node locator)
    ├── Feature Extractor (12 structural & semantic features)
    ├── ML Conflict Predictor (Gradient Boosting / Random Forest)
    └── Python Runner (subprocess executor with a 10s hard timeout)
```
