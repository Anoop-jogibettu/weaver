"""
Weaver Python Service Tests
Tests for AST parser, dataset generator, and ML classifier.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from ast_parser.parser import (
    parse_source, diff_asts, analyze_concurrent_changes, node_to_dict,
)
from dataset.generator import generate_dataset, _make_sample
from ml.classifier import train, predict, FEATURE_COLS


# ─── AST Parser Tests ─────────────────────────────────────────────────────────

class TestASTParser:
    def test_parse_valid_source(self):
        src = "def foo():\n    return 1\n"
        result = parse_source(src)
        assert result["success"] is True
        assert len(result["nodes"]) > 0

    def test_parse_invalid_source(self):
        result = parse_source("def foo(:\n    pass\n")
        assert result["success"] is False
        assert "error" in result

    def test_parse_function_node(self):
        src = "def calculate(x):\n    return x * 2\n"
        result = parse_source(src)
        fns = [n for n in result["nodes"] if n["node_type"] == "FunctionDef"]
        assert len(fns) == 1
        assert fns[0]["name"] == "calculate"

    def test_parse_class_node(self):
        src = "class MyModel:\n    def __init__(self):\n        pass\n"
        result = parse_source(src)
        classes = [n for n in result["nodes"] if n["node_type"] == "ClassDef"]
        assert len(classes) == 1
        assert classes[0]["name"] == "MyModel"

    def test_diff_function_added(self):
        old = "def foo():\n    return 1\n"
        new = "def foo():\n    return 1\n\ndef bar():\n    return 2\n"
        old_nodes = parse_source(old)["nodes"]
        new_nodes = parse_source(new)["nodes"]
        changes = diff_asts(old_nodes, new_nodes)
        added = [c for c in changes if c["operation"] == "added" and c["name"] == "bar"]
        assert len(added) == 1

    def test_diff_function_modified(self):
        old = "def foo():\n    return 1\n"
        new = "def foo():\n    return 999\n"
        old_nodes = parse_source(old)["nodes"]
        new_nodes = parse_source(new)["nodes"]
        changes = diff_asts(old_nodes, new_nodes)
        modified = [c for c in changes if c["operation"] == "modified"]
        assert len(modified) >= 1

    def test_diff_function_deleted(self):
        old = "def foo():\n    return 1\n\ndef bar():\n    return 2\n"
        new = "def foo():\n    return 1\n"
        old_nodes = parse_source(old)["nodes"]
        new_nodes = parse_source(new)["nodes"]
        changes = diff_asts(old_nodes, new_nodes)
        deleted = [c for c in changes if c["operation"] == "deleted" and c["name"] == "bar"]
        assert len(deleted) == 1


# ─── Concurrent Change Analysis Tests ─────────────────────────────────────────

class TestConcurrentAnalysis:
    def test_same_function_detected(self):
        a = {"node_type": "FunctionDef", "name": "calc", "operation": "modified", "line_start": 1, "line_end": 5}
        b = {"node_type": "FunctionDef", "name": "calc", "operation": "modified", "line_start": 1, "line_end": 5}
        features = analyze_concurrent_changes(a, b)
        assert features["same_function"] == 1
        assert features["same_name"] == 1
        assert features["both_modify"] == 1

    def test_different_functions_independent(self):
        a = {"node_type": "FunctionDef", "name": "calc", "operation": "modified", "line_start": 1, "line_end": 5}
        b = {"node_type": "FunctionDef", "name": "validate", "operation": "added", "line_start": 20, "line_end": 25}
        features = analyze_concurrent_changes(a, b)
        assert features["same_function"] == 0
        assert features["same_name"] == 0

    def test_line_overlap_detected(self):
        a = {"node_type": "FunctionDef", "name": "f", "operation": "modified", "line_start": 5, "line_end": 15}
        b = {"node_type": "FunctionDef", "name": "g", "operation": "modified", "line_start": 10, "line_end": 20}
        features = analyze_concurrent_changes(a, b)
        assert features["line_overlap"] == 1
        assert features["overlap_ratio"] > 0

    def test_delete_modify_combo(self):
        a = {"node_type": "FunctionDef", "name": "calc", "operation": "deleted", "line_start": 1, "line_end": 5}
        b = {"node_type": "FunctionDef", "name": "calc", "operation": "modified", "line_start": 1, "line_end": 5}
        features = analyze_concurrent_changes(a, b)
        assert features["delete_and_modify"] == 1
        assert features["op_combo_score"] == 4

    def test_feature_completeness(self):
        a = {"node_type": "FunctionDef", "name": "f", "operation": "modified", "line_start": 1, "line_end": 3}
        b = {"node_type": "ClassDef", "name": "C", "operation": "added", "line_start": 10, "line_end": 15}
        features = analyze_concurrent_changes(a, b)
        for col in FEATURE_COLS:
            assert col in features, f"Missing feature: {col}"


# ─── Dataset Generator Tests ──────────────────────────────────────────────────

class TestDatasetGenerator:
    def test_generates_correct_count(self):
        samples = generate_dataset(100)
        assert len(samples) == 100

    def test_balanced_labels(self):
        samples = generate_dataset(200)
        labels = [s["label"] for s in samples]
        compatible = labels.count(0)
        conflict = labels.count(1)
        # Should be roughly 50/50
        assert abs(compatible - conflict) <= 20

    def test_all_features_present(self):
        samples = generate_dataset(10)
        for s in samples:
            for col in FEATURE_COLS:
                assert col in s

    def test_labels_are_binary(self):
        samples = generate_dataset(50)
        for s in samples:
            assert s["label"] in (0, 1)


# ─── ML Classifier Tests ──────────────────────────────────────────────────────

class TestMLClassifier:
    def test_train_and_predict(self):
        import pandas as pd
        samples = generate_dataset(200)
        df = pd.DataFrame(samples)
        results = train(df, algorithm="random_forest")
        assert results["accuracy"] > 0.5
        assert "confusion_matrix" in results

    def test_predict_same_function_conflict(self):
        from ml.classifier import predict
        features = {
            "same_node_type": 1, "same_name": 1, "same_function": 1, "same_class": 0,
            "line_overlap": 1, "overlap_ratio": 1.0, "structural_distance": 0,
            "op_combo_score": 3, "both_modify": 1, "delete_and_modify": 0,
            "node_type_a": 1, "node_type_b": 1,
        }
        result = predict(features)
        assert "label" in result
        assert "confidence" in result
        assert result["confidence"] >= 0.0

    def test_predict_independent_compatible(self):
        from ml.classifier import predict
        features = {
            "same_node_type": 1, "same_name": 0, "same_function": 0, "same_class": 0,
            "line_overlap": 0, "overlap_ratio": 0.0, "structural_distance": 50,
            "op_combo_score": 1, "both_modify": 0, "delete_and_modify": 0,
            "node_type_a": 1, "node_type_b": 1,
        }
        result = predict(features)
        assert "label" in result

    def test_training_metrics_present(self):
        import pandas as pd
        samples = generate_dataset(200)
        df = pd.DataFrame(samples)
        results = train(df, algorithm="logistic_regression")
        for metric in ["accuracy", "precision", "recall", "f1"]:
            assert metric in results
            assert 0.0 <= results[metric] <= 1.0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
