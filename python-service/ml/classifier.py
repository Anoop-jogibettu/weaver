"""
Weaver ML Classifier
Trains and serves an ML model to classify concurrent AST changes as
Compatible (0) or Potential Conflict (1).
"""
import json
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    confusion_matrix,
)
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline

MODEL_PATH = Path(__file__).parent / "model.joblib"
SCALER_PATH = Path(__file__).parent / "scaler.joblib"
RESULTS_PATH = Path(__file__).parent / "last_results.json"

FEATURE_COLS = [
    "same_node_type", "same_name", "same_function", "same_class",
    "line_overlap", "overlap_ratio", "structural_distance",
    "op_combo_score", "both_modify", "delete_and_modify",
    "node_type_a", "node_type_b",
]

FEATURE_DESCRIPTIONS = {
    "same_node_type": "Both changes affect the same AST node type",
    "same_name": "Both changes target an identifier with the same name",
    "same_function": "Both changes target the same function definition",
    "same_class": "Both changes target the same class definition",
    "line_overlap": "The line ranges of the two changes overlap",
    "overlap_ratio": "Ratio of overlapping lines to total affected lines",
    "structural_distance": "Line distance between the two change locations",
    "op_combo_score": "Risk score of the operation combination (modify+modify=3, delete+modify=4)",
    "both_modify": "Both operations are modifications",
    "delete_and_modify": "One operation deletes while the other modifies",
    "node_type_a": "Encoded AST node type for change A",
    "node_type_b": "Encoded AST node type for change B",
}


def train(df: pd.DataFrame, algorithm: str = "random_forest") -> dict:
    """Train the classifier and save to disk. Returns training metrics."""
    X = df[FEATURE_COLS].values
    y = df["label"].values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    model = _build_model(algorithm)

    start = time.time()
    model.fit(X_train, y_train)
    training_time = round(time.time() - start, 4)

    y_pred = model.predict(X_test)
    cm = confusion_matrix(y_test, y_pred).tolist()

    results = {
        "algorithm": algorithm,
        "n_samples": len(df),
        "n_train": len(X_train),
        "n_test": len(X_test),
        "n_compatible": int((y == 0).sum()),
        "n_conflict": int((y == 1).sum()),
        "training_time_s": training_time,
        "accuracy": round(accuracy_score(y_test, y_pred), 4),
        "precision": round(precision_score(y_test, y_pred, zero_division=0), 4),
        "recall": round(recall_score(y_test, y_pred, zero_division=0), 4),
        "f1": round(f1_score(y_test, y_pred, zero_division=0), 4),
        "confusion_matrix": cm,
        "false_positives": cm[0][1] if len(cm) > 1 else 0,
        "false_negatives": cm[1][0] if len(cm) > 1 else 0,
        "features": FEATURE_COLS,
    }

    joblib.dump(model, MODEL_PATH)
    with open(RESULTS_PATH, "w") as f:
        json.dump(results, f, indent=2)

    return results


def _build_model(algorithm: str):
    """Build sklearn pipeline based on algorithm name."""
    classifiers = {
        "random_forest": RandomForestClassifier(
            n_estimators=100, random_state=42, class_weight="balanced"
        ),
        "logistic_regression": Pipeline([
            ("scaler", StandardScaler()),
            ("clf", LogisticRegression(random_state=42, max_iter=1000, class_weight="balanced")),
        ]),
        "gradient_boosting": GradientBoostingClassifier(
            n_estimators=100, random_state=42
        ),
    }
    return classifiers.get(algorithm, classifiers["random_forest"])


def predict(features: dict) -> dict:
    """
    Classify a pair of concurrent changes.
    features: dict with keys matching FEATURE_COLS
    Returns: label (0/1), confidence, explanation
    """
    if not MODEL_PATH.exists():
        return {
            "label": 0,
            "confidence": 0.0,
            "prediction": "Compatible",
            "explanation": "Model not trained yet",
            "feature_importances": {},
        }

    model = joblib.load(MODEL_PATH)
    x = np.array([[features.get(col, 0) for col in FEATURE_COLS]])

    start = time.time()
    label = int(model.predict(x)[0])
    proba = model.predict_proba(x)[0]
    inference_time_ms = round((time.time() - start) * 1000, 3)
    confidence = round(float(proba[label]), 4)

    # Feature importances (for RandomForest only)
    importances = {}
    try:
        clf = model
        if hasattr(model, "named_steps"):
            clf = model.named_steps.get("clf", model)
        if hasattr(clf, "feature_importances_"):
            imp = clf.feature_importances_
            importances = {
                FEATURE_COLS[i]: round(float(imp[i]), 4)
                for i in range(len(FEATURE_COLS))
            }
            importances = dict(
                sorted(importances.items(), key=lambda x: x[1], reverse=True)[:5]
            )
    except Exception:
        pass

    # Build explanation
    active_features = []
    for col, desc in FEATURE_DESCRIPTIONS.items():
        val = features.get(col, 0)
        if col in ("same_function", "same_class", "same_name") and val == 1:
            active_features.append(desc)
        elif col in ("line_overlap", "both_modify", "delete_and_modify") and val == 1:
            active_features.append(desc)
        elif col == "op_combo_score" and val >= 3:
            active_features.append(f"{desc} (score={val})")
        elif col == "overlap_ratio" and val > 0.3:
            active_features.append(f"{desc} ({val:.0%})")

    explanation = "; ".join(active_features) if active_features else "Based on structural feature analysis"

    # Low confidence → uncertain
    prediction_label = "Compatible" if label == 0 else "Potential Conflict"
    if confidence < 0.6:
        prediction_label = "Uncertain – manual resolution required"

    return {
        "label": label,
        "confidence": confidence,
        "prediction": prediction_label,
        "explanation": explanation,
        "feature_importances": importances,
        "inference_time_ms": inference_time_ms,
    }


def get_last_results() -> dict:
    """Return last training/evaluation results."""
    if RESULTS_PATH.exists():
        with open(RESULTS_PATH) as f:
            return json.load(f)
    return {}


def is_trained() -> bool:
    return MODEL_PATH.exists()
