"""
Weaver Python FastAPI Service
Provides AST parsing, ML classification, dataset generation, and evaluation endpoints.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import ast
from typing import Optional, Any, Dict, List

from ast_parser.parser import parse_source, diff_asts, analyze_concurrent_changes
from dataset.generator import generate_dataset, save_dataset, load_dataset, DATASET_PATH
from ml.classifier import train, predict, get_last_results, is_trained, FEATURE_COLS
from evaluation.evaluator import evaluate_both

import joblib

app = FastAPI(title="Weaver Research Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Request / Response Models ────────────────────────────────────────────────

class ParseRequest(BaseModel):
    source: str
    file: str = "unnamed.py"


class DiffRequest(BaseModel):
    old_source: str
    new_source: str
    file: str = "unnamed.py"


class AnalyzeRequest(BaseModel):
    change_a: dict
    change_b: dict


class ClassifyRequest(BaseModel):
    change_a: dict
    change_b: dict


class TrainRequest(BaseModel):
    algorithm: str = "random_forest"
    n_samples: int = 800

class RunRequest(BaseModel):
    source: str
    filename: str = "script.py"
    stdin: Optional[str] = None
    all_files: Optional[Dict[str, str]] = None

class ReplRequest(BaseModel):
    code: str
    session_id: Optional[str] = None

class FormatRequest(BaseModel):
    source: str

class LintRequest(BaseModel):
    source: str
    filename: str = "script.py"


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "model_trained": is_trained()}


@app.post("/parse")
def parse_endpoint(req: ParseRequest):
    """Parse Python source and return AST node summary."""
    result = parse_source(req.source)
    return result


@app.post("/diff")
def diff_endpoint(req: DiffRequest):
    """
    Compare old and new Python source and return a list of structural changes.
    """
    old_result = parse_source(req.old_source)
    new_result = parse_source(req.new_source)

    if not old_result["success"] or not new_result["success"]:
        return {
            "success": False,
            "changes": [],
            "error": old_result.get("error") or new_result.get("error"),
        }

    changes = diff_asts(old_result["nodes"], new_result["nodes"])
    return {"success": True, "changes": changes, "file": req.file}


@app.post("/analyze")
def analyze_endpoint(req: AnalyzeRequest):
    """
    Analyze the structural relationship between two concurrent AST changes.
    Returns a feature vector suitable for ML classification.
    """
    features = analyze_concurrent_changes(req.change_a, req.change_b)
    return {"success": True, "features": features}


@app.post("/classify")
def classify_endpoint(req: ClassifyRequest):
    """
    Extract features from two concurrent changes and classify them.
    Returns label, confidence, explanation, and feature importances.
    """
    features = analyze_concurrent_changes(req.change_a, req.change_b)
    prediction = predict(features)
    return {
        "success": True,
        "features": features,
        "prediction": prediction,
    }


@app.post("/train")
def train_endpoint(req: TrainRequest):
    """
    Generate synthetic dataset and train the ML classifier.
    Returns training metrics.
    """
    # Generate dataset
    samples = generate_dataset(req.n_samples)
    save_dataset(samples)

    # Load and train
    import pandas as pd
    df = load_dataset()
    results = train(df, algorithm=req.algorithm)
    return {"success": True, "results": results}


@app.get("/model/status")
def model_status():
    """Return current model training results."""
    if not is_trained():
        return {"trained": False, "results": None}
    results = get_last_results()
    return {"trained": True, "results": results}


@app.post("/evaluate")
def evaluate_endpoint():
    """
    Run a full evaluation comparing baseline vs ML classifier.
    Returns metrics for both approaches.
    """
    if not is_trained():
        raise HTTPException(status_code=400, detail="Model not trained yet. Call /train first.")
    if not DATASET_PATH.exists():
        raise HTTPException(status_code=400, detail="Dataset not found. Call /train first.")

    import pandas as pd
    df = load_dataset()
    model = joblib.load(Path(__file__).parent / "ml" / "model.joblib")
    results = evaluate_both(df, model)
    return {"success": True, "evaluation": results}


@app.get("/dataset/stats")
def dataset_stats():
    """Return statistics about the current dataset."""
    if not DATASET_PATH.exists():
        return {"exists": False}
    import pandas as pd
    df = load_dataset()
    return {
        "exists": True,
        "n_samples": len(df),
        "n_compatible": int((df["label"] == 0).sum()),
        "n_conflict": int((df["label"] == 1).sum()),
        "features": FEATURE_COLS,
        "path": str(DATASET_PATH),
    }


@app.post("/demo/scenario")
def demo_scenario(scenario: str = "compatible"):
    """
    Return pre-built demo change pairs for the research demonstration.
    scenario: 'compatible' | 'conflict'
    """
    if scenario == "compatible":
        change_a = {
            "node_type": "FunctionDef", "name": "calculate",
            "operation": "modified", "line_start": 2, "line_end": 3,
            "parent": "Module",
        }
        change_b = {
            "node_type": "FunctionDef", "name": "validate",
            "operation": "added", "line_start": 6, "line_end": 8,
            "parent": "Module",
        }
    else:
        change_a = {
            "node_type": "FunctionDef", "name": "calculate",
            "operation": "modified", "line_start": 2, "line_end": 3,
            "parent": "Module",
        }
        change_b = {
            "node_type": "FunctionDef", "name": "calculate",
            "operation": "modified", "line_start": 2, "line_end": 3,
            "parent": "Module",
        }

    features = analyze_concurrent_changes(change_a, change_b)
    prediction = predict(features)

    return {
        "scenario": scenario,
        "change_a": change_a,
        "change_b": change_b,
        "features": features,
        "prediction": prediction,
    }



# In-memory REPL session namespaces
_repl_sessions: Dict[str, dict] = {}


@app.post("/run")
def run_endpoint(req: RunRequest):
    """
    Execute Python source code in a sandboxed directory subprocess.
    Writes all workspace files into temporary directory to support cross-file imports.
    Returns stdout, stderr, exit_code, and wall time (seconds).
    Hard timeout: 10 seconds.
    """
    import subprocess
    import tempfile
    import time
    import os

    with tempfile.TemporaryDirectory() as tmp_dir:
        # 1. Write all workspace files into tmp_dir so cross-file imports succeed
        if req.all_files:
            for fname, content in req.all_files.items():
                if not fname:
                    continue
                target_path = os.path.join(tmp_dir, fname)
                parent_dir = os.path.dirname(target_path)
                if parent_dir:
                    os.makedirs(parent_dir, exist_ok=True)
                with open(target_path, "w", encoding="utf-8") as f:
                    f.write(content)

        # 2. Write/overwrite active target source file
        active_target = req.filename if req.filename.endswith(".py") else f"{req.filename}.py"
        active_path = os.path.join(tmp_dir, active_target)
        with open(active_path, "w", encoding="utf-8") as f:
            f.write(req.source)

        try:
            t0 = time.monotonic()
            result = subprocess.run(
                [sys.executable, active_target],
                input=req.stdin or "",
                capture_output=True,
                text=True,
                timeout=10,
                cwd=tmp_dir,
            )
            elapsed = round(time.monotonic() - t0, 3)
            return {
                "success": True,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "exit_code": result.returncode,
                "elapsed": elapsed,
                "filename": req.filename,
            }
        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "stdout": "",
                "stderr": "Execution timed out after 10 seconds.",
                "exit_code": -1,
                "elapsed": 10.0,
                "filename": req.filename,
            }
        except Exception as e:
            return {
                "success": False,
                "stdout": "",
                "stderr": str(e),
                "exit_code": -1,
                "elapsed": 0,
                "filename": req.filename,
            }


@app.post("/repl")
def repl_endpoint(req: ReplRequest):
    """
    Execute Python code in an interactive in-memory session.
    Preserves variables and defined functions across evaluations.
    """
    import io
    from contextlib import redirect_stdout, redirect_stderr
    import traceback

    session_key = req.session_id or "default"
    if session_key not in _repl_sessions:
        _repl_sessions[session_key] = {"__name__": "__main__"}

    session_globals = _repl_sessions[session_key]

    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()
    code = req.code.strip()

    if not code:
        return {"success": True, "stdout": "", "stderr": ""}

    try:
        with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
            # Try evaluating as an expression first
            try:
                compiled = compile(code, "<repl>", "eval")
                res = eval(compiled, session_globals)
                if res is not None:
                    print(repr(res))
            except SyntaxError:
                # If syntax error, execute as a statement block
                compiled = compile(code, "<repl>", "exec")
                exec(compiled, session_globals)

        out = stdout_buf.getvalue()
        err = stderr_buf.getvalue()
        return {
            "success": True,
            "stdout": out,
            "stderr": err,
        }
    except Exception as e:
        return {
            "success": False,
            "stdout": stdout_buf.getvalue(),
            "stderr": traceback.format_exc(),
        }


@app.post("/format")
def format_endpoint(req: FormatRequest):
    """
    Format Python source code cleanly.
    Tries autopep8 / black if installed, else AST roundtrip normalization.
    """
    code = req.source

    # Try autopep8
    try:
        import autopep8
        formatted = autopep8.fix_code(code)
        return {"success": True, "formatted": formatted}
    except Exception:
        pass

    # Try black
    try:
        import black
        formatted = black.format_str(code, mode=black.Mode())
        return {"success": True, "formatted": formatted}
    except Exception:
        pass

    # Fallback to ast.unparse (Python 3.9+) if valid syntax
    try:
        tree = ast.parse(code)
        formatted = ast.unparse(tree)
        return {"success": True, "formatted": formatted}
    except Exception as e:
        return {"success": False, "formatted": code, "error": str(e)}


@app.post("/lint")
def lint_endpoint(req: LintRequest):
    """
    Check Python syntax diagnostics using AST parser.
    Returns line, column, and error message.
    """
    diagnostics = []
    try:
        ast.parse(req.source, filename=req.filename)
    except SyntaxError as e:
        diagnostics.append({
            "line": e.lineno or 1,
            "col": e.offset or 1,
            "end_line": getattr(e, "end_lineno", None) or e.lineno or 1,
            "end_col": getattr(e, "end_offset", None) or (e.offset or 1) + 1,
            "message": e.msg or "Syntax error",
            "severity": "error",
        })
    except Exception as e:
        diagnostics.append({
            "line": 1,
            "col": 1,
            "end_line": 1,
            "end_col": 2,
            "message": str(e),
            "severity": "error",
        })
    return {"success": len(diagnostics) == 0, "diagnostics": diagnostics}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
