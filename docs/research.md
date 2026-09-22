# Weaver — Research Documentation

## 1. Problem Statement

Collaborative code editing requires maintaining convergent document state across multiple clients editing simultaneously. Existing systems (e.g., Google Docs, VS Code Live Share) achieve convergence using Conflict-free Replicated Data Types (CRDTs) or Operational Transformation (OT). However, convergence at the text level does not imply correctness at the structural (AST) level — two changes that merge without textual conflict may still produce structurally invalid or semantically incompatible code.

## 2. Research Gap

> *"Existing collaborative code-editing systems can synchronize concurrent textual changes using CRDTs, while AST-based approaches provide structural information about source code. However, the use of machine learning to classify whether concurrent AST-level code changes are structurally compatible or conflicting within a local-first CRDT environment remains insufficiently explored."*

Current approaches either:
- Rely solely on textual/positional conflict detection (line-range overlap), which produces false negatives when changes are non-overlapping but semantically conflicting, and false positives when overlapping changes are actually structurally independent.
- Perform semantic analysis post-merge, which cannot proactively classify changes before merging.

## 3. Research Question

**Can an ML classifier trained on AST structural features meaningfully improve the detection of concurrent code conflicts compared to text/position-based heuristics in a CRDT-based collaborative editing environment?**

## 4. Hypothesis

AST-level structural features — including node type, operation combination, name identity, line-range overlap, and structural distance — provide sufficient discriminatory signal for an ML model to outperform a rule-based baseline in classifying concurrent code changes as compatible or conflicting.

## 5. System Architecture

```
Browser (User A)          Browser (User B)
┌─────────────┐           ┌─────────────┐
│ CodeMirror 6│           │ CodeMirror 6│
│ + Yjs Y.Text│◄──CRDT───►│ + Yjs Y.Text│
│ IndexedDB   │           │ IndexedDB   │
└──────┬──────┘           └──────┬──────┘
       │           y-websocket   │
       └──────────────┬──────────┘
                      │
          ┌───────────▼───────────┐
          │  Node.js Relay Server  │
          │  (y-websocket + REST)  │
          └───────────┬───────────┘
                      │ HTTP
          ┌───────────▼───────────┐
          │  Python FastAPI        │
          │  AST Parser            │
          │  Feature Extractor     │
          │  ML Classifier         │
          │  Dataset Generator     │
          │  Evaluation Module     │
          └───────────────────────┘
```

### Layer Responsibilities

| Layer | Responsibility |
|-------|---------------|
| **CRDT (Yjs)** | Convergent document synchronization, offline support |
| **AST Layer** | Parse Python source, extract structural nodes, diff ASTs |
| **Feature Layer** | Encode concurrent change pairs as ML feature vectors |
| **ML Layer** | Classify feature vectors as Compatible (0) or Potential Conflict (1) |
| **Merge Layer** | Deterministic merge decisions; ML prediction is advisory only |

## 6. CRDT Design

Weaver uses **Yjs** (YATA algorithm — Yet Another Transformation Approach) as its CRDT engine. Yjs provides:

- `Y.Text` — a CRDT-based replicated text type bound to CodeMirror 6
- `WebsocketProvider` (y-websocket) — WebSocket-based synchronization
- `IndexeddbPersistence` (y-indexeddb) — local-first browser persistence

Each character insertion/deletion is represented as a Yjs operation with:
- Client ID (unique per browser session)
- Logical clock ordering (Lamport-compatible)
- Operation type (insert/delete)
- Position information

The CRDT guarantees convergence regardless of operation ordering or network partitions.

> **Note:** The ML classifier does NOT participate in CRDT convergence. It operates as an advisory layer above the CRDT.

## 7. AST Processing

After a code change stabilizes (1.5-second debounce), Weaver:

1. Sends old and new Python source to the `/diff` endpoint
2. Python's `ast.parse()` produces an AST for each version
3. `diff_asts()` walks both ASTs and compares nodes by `(node_type, name)` identity
4. Produces a list of structural change records:

```json
{
  "operation": "modified",
  "node_type": "FunctionDef",
  "name": "calculate",
  "line_start": 2,
  "line_end": 3,
  "parent": "Module"
}
```

Supported structural operations: `added`, `deleted`, `modified` for `FunctionDef`, `ClassDef`, `Import`, `ImportFrom`, `Assign`, `Return`, `If`, `For`, `While`.

## 8. Feature Extraction

For a pair of concurrent changes (A, B), the feature extractor (`analyze_concurrent_changes`) produces:

| Feature | Type | Description |
|---------|------|-------------|
| `same_node_type` | Binary | A and B affect the same AST node type |
| `same_name` | Binary | A and B target the same identifier |
| `same_function` | Binary | Both target the same `FunctionDef` |
| `same_class` | Binary | Both target the same `ClassDef` |
| `line_overlap` | Binary | Line ranges of A and B overlap |
| `overlap_ratio` | Float | Proportion of overlapping lines |
| `structural_distance` | Integer | Line distance between change locations |
| `op_combo_score` | Integer | Risk score for operation combination (modify+modify=3, delete+modify=4) |
| `both_modify` | Binary | Both operations are modifications |
| `delete_and_modify` | Binary | One deletes while the other modifies |
| `node_type_a` | Integer | Encoded AST node type for change A |
| `node_type_b` | Integer | Encoded AST node type for change B |

## 9. ML Methodology

### Algorithm Selection

Weaver uses scikit-learn classifiers:

- **Random Forest** (default) — ensemble, handles non-linear boundaries, provides feature importances
- **Logistic Regression** — linear baseline, fast, interpretable coefficients
- **Gradient Boosting** — boosted trees, potentially higher accuracy

### Training Process

1. Generate synthetic dataset (800 samples by default)
2. 80/20 stratified train/test split
3. Fit selected classifier on training split
4. Evaluate on held-out test split
5. Serialize trained model with `joblib`

### Labels

- `0` = Compatible (changes are structurally independent, safe to auto-merge)
- `1` = Potential Conflict (changes may produce structural incompatibility)

### Confidence Threshold

If `predict_proba` confidence < 0.60, the prediction is reported as "Uncertain — manual resolution required" regardless of the raw label.

## 10. Dataset Generation

The synthetic dataset (`dataset/concurrent_changes.csv`) contains labeled pairs of concurrent AST-level changes. It is generated by `dataset/generator.py` using controlled templates:

**Compatible examples (label=0):**
- Two different functions added
- Modify different functions
- Two different classes
- Add function + modify different class
- Import + independent function
- Modify distant assignments
- Delete one function, add another

**Conflict examples (label=1):**
- Both modify same function
- Modify same function + delete
- Both modify same class
- Overlapping line ranges
- Same function: add + delete
- Concurrent modify of same Return statement
- Rename + modify same function
- Parent (ClassDef) + child (FunctionDef) concurrent modification

> **Limitation:** This is a synthetic, prototype dataset. It does not capture the full distribution of real-world concurrent edits. Results should not be generalized without validation on real concurrent edit logs from production collaborative editing sessions.

## 11. Experimental Methodology

1. Generate dataset via `/train` endpoint
2. Train ML classifier (Random Forest by default)
3. Evaluate ML classifier on held-out test set
4. Run baseline (rule-based overlap + same-name) on same test set
5. Compare metrics: Accuracy, Precision, Recall, F1, False Positives, False Negatives, Classification Time

All metrics are computed by running actual experiments in the application. Results are not fabricated.

## 12. Evaluation Metrics

| Metric | Definition |
|--------|-----------|
| **Accuracy** | (TP + TN) / Total |
| **Precision** | TP / (TP + FP) — of all flagged conflicts, how many are real |
| **Recall** | TP / (TP + FN) — of all real conflicts, how many were caught |
| **F1-Score** | 2 × (Precision × Recall) / (Precision + Recall) |
| **False Positives** | Compatible pairs incorrectly flagged as conflict |
| **False Negatives** | Actual conflicts missed by the detector |
| **Avg. Classification Time** | Mean time per sample (milliseconds) |

## 13. Limitations

1. **Synthetic dataset** — Real-world concurrent edit patterns may differ from templates.
2. **Python-only** — Only Python source files are analyzed. No multi-language support.
3. **No semantic analysis** — Changes to function *behavior* (semantics) are not analyzed, only structural location.
4. **Prototype transport** — The WebSocket relay is not production-scale; designed for demonstration with 2–4 users.
5. **No authentication** — Session IDs provide collaboration context, not security.
6. **AST precision** — Some structural changes (e.g., renames across files) may not be fully captured.
7. **ML is advisory** — The model does not and cannot autonomously modify code. All merge decisions remain under user control.

## 14. Future Work

1. **Real-world dataset** — Collect concurrent edit logs from real open-source collaboration events
2. **Semantic analysis** — Integrate type inference or data-flow analysis for deeper conflict detection
3. **Multi-language support** — Extend AST parsing to JavaScript (using tree-sitter), Java, etc.
4. **Online learning** — Update the classifier incrementally as users resolve/accept conflicts
5. **Formal evaluation** — User study measuring developer productivity with vs. without ML assistance
6. **Production CRDT** — Evaluate alternative CRDT designs (e.g., RGA, TreeDoc) for code-specific use cases
7. **Dependency analysis** — Detect cross-function dependency conflicts (e.g., caller/callee renames)

## 15. Distinction of Contributions

| Component | Existing Technology | Weaver Contribution |
|-----------|-------------------|---------------------|
| CRDT synchronization | Yjs (YATA algorithm) | Integration + metadata tagging |
| Python AST parsing | Python `ast` module | Structural diff + change record extraction |
| ML conflict classification | scikit-learn | Feature engineering + classification pipeline |
| Local-first persistence | Yjs + IndexedDB | Editor integration |
| **AST + CRDT + ML pipeline** | **None found** | **Novel research contribution** |

Weaver does not claim to solve semantic merge conflicts. It demonstrates a novel pipeline connecting CRDT-level change events to AST structural analysis to ML-based classification, and provides evidence that this approach may improve upon text-based heuristics.
