"""
Weaver Evaluation Module
Compares the ML classifier against a rule-based baseline detector.
"""
import time
from typing import Any

import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score, confusion_matrix
)

FEATURE_COLS = [
    "same_node_type", "same_name", "same_function", "same_class",
    "line_overlap", "overlap_ratio", "structural_distance",
    "op_combo_score", "both_modify", "delete_and_modify",
    "node_type_a", "node_type_b",
]


def baseline_predict(row: dict) -> int:
    """
    Rule-based baseline detector.
    Uses only line overlap and same-name heuristics (text/position-based).
    """
    if row.get("line_overlap", 0) == 1:
        return 1
    if row.get("same_name", 0) == 1 and row.get("op_combo_score", 0) >= 3:
        return 1
    return 0


def evaluate_both(df: pd.DataFrame, ml_model) -> dict:
    """
    Run baseline and ML on the test split and return comparative metrics.
    """
    from sklearn.model_selection import train_test_split
    import joblib

    X = df[FEATURE_COLS].values
    y = df["label"].values
    _, X_test, _, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

    test_df = pd.DataFrame(X_test, columns=FEATURE_COLS)
    test_df["label"] = y_test

    # --- Baseline ---
    t0 = time.time()
    baseline_preds = test_df.apply(lambda r: baseline_predict(r.to_dict()), axis=1).values
    baseline_time = round((time.time() - t0) * 1000 / len(y_test), 4)

    # --- ML ---
    t0 = time.time()
    ml_preds = ml_model.predict(X_test)
    ml_time = round((time.time() - t0) * 1000 / len(y_test), 4)

    def metrics(y_true, y_pred, avg_time_ms):
        cm = confusion_matrix(y_true, y_pred).tolist()
        return {
            "accuracy": round(accuracy_score(y_true, y_pred), 4),
            "precision": round(precision_score(y_true, y_pred, zero_division=0), 4),
            "recall": round(recall_score(y_true, y_pred, zero_division=0), 4),
            "f1": round(f1_score(y_true, y_pred, zero_division=0), 4),
            "confusion_matrix": cm,
            "false_positives": cm[0][1] if len(cm) > 1 else 0,
            "false_negatives": cm[1][0] if len(cm) > 1 else 0,
            "avg_classification_time_ms": avg_time_ms,
        }

    return {
        "n_test_samples": int(len(y_test)),
        "n_compatible": int((y_test == 0).sum()),
        "n_conflict": int((y_test == 1).sum()),
        "baseline": metrics(y_test, baseline_preds, baseline_time),
        "ml_classifier": metrics(y_test, ml_preds, ml_time),
    }
