# Problem Statement

## Project Title
**Weaver: A Real-Time Collaborative Python Code Editor with AST-Aware Machine Learning Conflict Detection**

---

## 1. Introduction

The increasing adoption of distributed software development practices has made concurrent code editing a routine aspect of modern engineering workflows. Developers working across different machines, time zones, and branches frequently modify the same source files simultaneously. While version control systems such as Git provide mechanisms to merge these concurrent changes, they operate exclusively at the textual level — comparing raw byte sequences using line-based diff algorithms. This approach is inherently limited: it cannot reason about the *semantic* or *structural* meaning of the changes being merged.

The consequences of this limitation are significant. Merge conflicts are detected only after diverging work has been committed to separate branches, at which point resolving them demands manual effort, disrupts development flow, and can introduce regression defects if resolution is performed incorrectly. Furthermore, structurally incompatible changes — such as two developers simultaneously modifying the body of the same function — may not even produce a textual conflict if the modified lines do not overlap, yet still result in logically broken code after merging.

Real-time collaborative editors such as Google Docs and Visual Studio Code Live Share address concurrency at the character level using Conflict-free Replicated Data Types (CRDTs) or Operational Transformation (OT). These systems guarantee that all peers converge to the same document state. However, convergence at the textual level does not imply correctness at the structural level. Two concurrent edits that merge without textual conflict may still produce structurally invalid or semantically incompatible source code — a problem these systems make no attempt to detect.

---

## 2. Problem Definition

The core problem addressed by this project is as follows:

> **Existing collaborative code editing environments synchronize concurrent text changes using CRDTs but provide no mechanism to detect whether those changes are structurally or semantically compatible at the Abstract Syntax Tree (AST) level. As a result, developers receive no early warning of impending merge conflicts, leading to late detection, costly manual resolution, and potential introduction of structural defects.**

This problem has three distinct dimensions:

### 2.1 Late Conflict Detection
Traditional version control tools detect merge conflicts only at integration time — after two developers have independently committed significant diverging work. By this point, resolution requires understanding the intent of both changesets simultaneously, which is cognitively demanding and error-prone. There is no mechanism to alert developers that their current edits are on a collision course while they are still actively coding.

### 2.2 Structural Blindness of Text-Based Diffing
Git's diff and merge algorithms operate on line ranges. They have no concept of Python's Abstract Syntax Tree — functions, classes, assignments, or imports. As a result:
- Two concurrent edits to the *same function* may not be flagged if they occur on different lines.
- Two concurrent edits to *different functions* on adjacent lines may be incorrectly flagged as conflicting.
- Structural changes such as renaming a function used by another developer's code go completely undetected.

### 2.3 Absence of ML-Based Conflict Classification in CRDT Environments
While research exists separately in (a) CRDT-based collaborative editing and (b) AST-based program analysis, the intersection — using machine learning to classify whether concurrent AST-level changes within a CRDT-synchronized editor are structurally compatible or conflicting — remains insufficiently explored. No production-grade tool currently integrates these three layers into a unified, real-time pipeline.

---

## 3. Research Gap

Existing literature and tools address parts of this problem but not the whole:

| Approach | Limitation |
|---|---|
| CRDT/OT-based editors (Yjs, ShareDB) | Guarantee textual convergence only; no structural analysis |
| Static analysis tools (Pylint, mypy) | Analyze single snapshots; not designed for concurrent change comparison |
| Post-merge conflict detectors | Operate after-the-fact; cannot provide real-time warnings |
| Semantic diff tools | Compare two versions; not designed for multi-peer CRDT environments |
| ML-based bug detection | Not applied to the specific problem of concurrent edit conflict prediction |

> *"The use of machine learning to classify whether concurrent AST-level code changes are structurally compatible or conflicting within a local-first CRDT collaborative editing environment remains insufficiently explored."*

---

## 4. Research Questions

This project investigates the following primary research questions:

**RQ1:** Can an ML classifier trained on AST structural features meaningfully improve the detection of concurrent code conflicts compared to text/position-based heuristics in a CRDT-based collaborative editing environment?

**RQ2:** Which structural features of concurrent AST-level changes carry the most discriminatory signal for conflict classification?

**RQ3:** Can real-world merge commit history from open-source Python repositories serve as a reliable ground-truth source for training such a classifier?

---

## 5. Proposed Solution

This project proposes **Weaver**, a real-time collaborative Python code editor that integrates three layers of conflict awareness:

### 5.1 CRDT-Based Synchronization (Convergence Layer)
Weaver uses **Yjs** (YATA algorithm) to provide conflict-free, real-time text synchronization across multiple peers via WebSockets, with local-first persistence via IndexedDB. This layer guarantees that all clients converge to the same document state regardless of network conditions or edit ordering.

### 5.2 Live AST Differencing (Structural Layer)
After each edit stabilizes (1.5-second debounce), the modified Python source is sent to a FastAPI backend service. The service uses Python's built-in `ast` module to parse both the previous and current versions, performs structural AST differencing, and produces structured change records identifying the node type, name, operation (added/deleted/modified), parent scope, and line range of each structural change.

### 5.3 ML-Based Conflict Classification (Intelligence Layer)
Concurrent change pairs from different peers are encoded as 12-dimensional feature vectors capturing structural overlap, operation type combinations, name identity, and structural distance. A machine learning classifier (Random Forest / Gradient Boosting) trained on labeled data predicts whether the pair constitutes a potential conflict (label = 1) or a compatible concurrent edit (label = 0), and surfaces the result as a real-time warning in the editor interface.

### 5.4 Dataset Construction
The training dataset is constructed by mining real merge commit histories from **50 major open-source Python repositories** (including Django, PyTorch, NumPy, scikit-learn, and Hugging Face Transformers). For each two-parent merge commit, concurrently edited Python files are identified, per-file conflict status is determined via `git merge-tree`, and overlapping diff hunks are extracted at hunk-level granularity — providing ground-truth labels for supervised learning.

---

## 6. Objectives

1. Design and implement a local-first, real-time collaborative Python code editor with CRDT-based synchronization.
2. Build a live AST differencing pipeline capable of tracking per-peer structural code changes in real time.
3. Engineer a feature extraction module that encodes concurrent AST change pairs into ML-compatible feature vectors.
4. Construct a labeled training dataset by mining real-world merge conflict history from open-source Python repositories.
5. Train and evaluate ML classifiers (Random Forest, Gradient Boosting, Logistic Regression) and compare them against a rule-based baseline on accuracy, precision, recall, F1-score, and inference latency.
6. Integrate the ML classifier into the editor as a real-time advisory conflict guard with confidence-based uncertainty reporting.

---

## 7. Scope and Constraints

| Dimension | Scope |
|---|---|
| **Language** | Python source files only |
| **Conflict Type** | Structural / AST-level conflicts (not full semantic / data-flow conflicts) |
| **Collaboration Scale** | Prototype-scale (2–4 concurrent users) |
| **ML Role** | Advisory only; all merge decisions remain under user control |
| **Dataset** | Real-world mined data from 50 open-source Python repositories |
| **Deployment** | Local development environment; not production-hardened |

---

## 8. Expected Outcomes

1. A functional collaborative code editor demonstrating the integrated CRDT + AST + ML pipeline.
2. A labeled dataset of concurrent Python code change pairs mined from real-world repositories.
3. Quantitative evidence that AST-based ML classification outperforms text/position-based heuristics on conflict detection accuracy.
4. Identification of the most predictive structural features for concurrent conflict classification.
5. A reproducible evaluation framework for comparing classifier performance against baseline detectors.

---

## 9. Significance

This work is significant for the following reasons:

- It addresses a practical, high-frequency problem in modern collaborative software development.
- It proposes and validates a novel three-layer pipeline (CRDT + AST + ML) that has not been explored in prior literature as a unified system.
- It produces a real-world training dataset from 50 production-grade Python repositories, contributing a reusable resource for future research in this area.
- The findings can inform the design of next-generation IDE extensions and collaborative editing platforms that provide semantics-aware conflict detection.

---

## 10. References (Preliminary)

1. Nicolaescu, P., Jahns, K., Derntl, M., & Klamma, R. (2016). *Near Real-Time Peer-to-Peer Shared Editing on Extensible Data Types.* ACM CSCW.
2. Sun, C., & Ellis, C. (1998). *Operational Transformation in Real-Time Group Editors: Issues, Algorithms, and Achievements.* ACM CSCW.
3. Binkley, D., & Harman, M. (2004). *A Survey of Empirical Results on Program Slicing.* Advances in Computers, Elsevier.
4. Hunt, J., & McIlroy, M. (1976). *An Algorithm for Differential File Comparison.* Bell Labs Technical Report.
5. Pedregosa, F., et al. (2011). *Scikit-learn: Machine Learning in Python.* Journal of Machine Learning Research, 12, 2825–2830.
6. Zimmermann, T., Zeller, A., Weißgerber, P., & Diehl, S. (2005). *Mining Version Histories to Guide Software Changes.* IEEE Transactions on Software Engineering.
7. GitHub. (2023). *The State of the Octoverse: Collaborative Development Trends.* GitHub Inc.
