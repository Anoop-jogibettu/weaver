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
from typing import Optional, Any

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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
