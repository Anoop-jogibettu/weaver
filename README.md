# Weaver

**ML-Assisted AST-Aware CRDT-Based Local-First Collaborative Python Code Editor**

A research prototype demonstrating:

```
Concurrent Code Edits → CRDT Synchronization → AST Structural Analysis → ML-Based Conflict Classification
```

---

## Quick Start

### Prerequisites
- Node.js 18+
- Python 3.9+

### 1. Install dependencies (once)

```bash
# Frontend + backend
npm install
cd backend && npm install && cd ..

# Python service
cd python-service && pip3 install -r requirements.txt && cd ..
```

### 2. Start everything

```bash
bash start.sh
```

| Service | URL |
|---------|-----|
| **Frontend** | http://localhost:5173 |
| **Node.js relay** | ws://localhost:1234 |
| **Python API** | http://localhost:8000/docs |

---

## Two-User Demo

1. Open **Tab A** → http://localhost:5173 → **Create New Session**
2. Copy the 6-character session ID
3. Open **Tab B** → http://localhost:5173 → **Join Session** → paste ID
4. Both users now share the same Python project via Yjs CRDT

### Demo Scenarios (right panel)

| Scenario | Change A | Change B | ML Result |
|----------|----------|----------|-----------|
| **Compatible** | modify `calculate()` | add `validate()` | ✅ Compatible |
| **Conflict** | modify `calculate()` | modify `calculate()` | ⚠ Potential Conflict |

---

## Research Evaluation

Click **Research Evaluation** in the header to:
1. Generate a synthetic dataset
2. Train the Random Forest / Logistic Regression / Gradient Boosting classifier
3. Run a full evaluation comparing baseline vs ML classifier
4. View confusion matrix, Accuracy, Precision, Recall, F1, FP, FN

---

## Architecture

```
Frontend (Vite + React + CodeMirror 6 + Yjs)
    ↕ y-websocket (CRDT sync)
Backend (Node.js + y-websocket relay)
    ↕ HTTP REST proxy
Python Service (FastAPI)
    ├── AST Parser (Python ast module)
    ├── Feature Extractor
    ├── ML Classifier (scikit-learn)
    ├── Dataset Generator
    └── Evaluation Module
```

## Tests

```bash
# Python (20 tests)
cd python-service && python3 -m pytest ../tests/test_python_service.py -v

# TypeScript type check
npx tsc --noEmit
```

## Project Structure

```
weaver/
├── src/                          # React frontend
│   ├── editor/                   # CodeMirror 6 + Yjs bindings
│   ├── collaboration/            # Yjs CRDT store
│   ├── components/               # SessionGate, CollabPanel
│   ├── conflict-ui/              # ConflictModal
│   ├── research-dashboard/       # ResearchDashboard
│   └── api/                      # API client
├── backend/                      # Node.js relay server
├── python-service/               # FastAPI + scikit-learn
│   ├── ast_parser/               # Python AST module wrapper
│   ├── ml/                       # ML classifier
│   ├── dataset/                  # Synthetic data generator
│   └── evaluation/               # Baseline comparison
├── tests/                        # pytest test suite
├── docs/research.md              # Full research documentation
└── start.sh                      # One-command startup
```

## Research Documentation

See [`docs/research.md`](docs/research.md) for:
- Problem statement & research gap
- Research question & hypothesis
- System architecture
- CRDT design (Yjs/YATA)
- AST processing pipeline
- Feature extraction (12 features)
- ML methodology
- Synthetic dataset generation
- Experimental methodology
- Evaluation metrics
- Limitations & future work

> ⚠ This is a research prototype. The synthetic dataset is designed for demonstration purposes. See docs/research.md for full limitations.
