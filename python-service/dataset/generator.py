"""
Weaver Synthetic Dataset Generator
Generates labeled pairs of concurrent AST-level changes for ML training.
Labels: 0 = Compatible, 1 = Potential Conflict
"""
import csv
import json
import os
import random
from pathlib import Path

DATASET_PATH = Path(__file__).parent / "concurrent_changes.csv"

FEATURES = [
    "same_node_type",
    "same_name",
    "same_function",
    "same_class",
    "line_overlap",
    "overlap_ratio",
    "structural_distance",
    "op_combo_score",
    "both_modify",
    "delete_and_modify",
    "node_type_a",
    "node_type_b",
    "label",
]


def generate_dataset(n_samples: int = 800) -> list[dict]:
    """Generate n_samples synthetic concurrent change pairs."""
    random.seed(42)
    samples = []

    # --- Compatible examples ---
    compatible_templates = [
        # Two different functions added
        lambda: _make_sample(
            a_type="FunctionDef", a_name=f"func_{random.randint(1,50)}",
            a_op="added", a_start=random.randint(1, 30), a_end=None,
            b_type="FunctionDef", b_name=f"func_{random.randint(51,100)}",
            b_op="added", b_start=random.randint(60, 100), b_end=None,
            label=0,
        ),
        # Modify different functions
        lambda: _make_sample(
            a_type="FunctionDef", a_name=f"calculate",
            a_op="modified", a_start=10, a_end=14,
            b_type="FunctionDef", b_name=f"validate",
            b_op="added", b_start=30, b_end=34,
            label=0,
        ),
        # Two different classes
        lambda: _make_sample(
            a_type="ClassDef", a_name="ModelA",
            a_op="modified", a_start=random.randint(1, 20), a_end=None,
            b_type="ClassDef", b_name="ModelB",
            b_op="added", b_start=random.randint(50, 80), b_end=None,
            label=0,
        ),
        # Add function + modify class (different)
        lambda: _make_sample(
            a_type="FunctionDef", a_name="new_util",
            a_op="added", a_start=random.randint(1, 40), a_end=None,
            b_type="ClassDef", b_name="SomeModel",
            b_op="modified", b_start=random.randint(60, 100), b_end=None,
            label=0,
        ),
        # Import + function (independent)
        lambda: _make_sample(
            a_type="Import", a_name="",
            a_op="added", a_start=1, a_end=1,
            b_type="FunctionDef", b_name="process",
            b_op="added", b_start=random.randint(40, 80), b_end=None,
            label=0,
        ),
        # Modify two distant assignments
        lambda: _make_sample(
            a_type="Assign", a_name="",
            a_op="modified", a_start=random.randint(5, 20), a_end=None,
            b_type="Assign", b_name="",
            b_op="modified", b_start=random.randint(50, 80), b_end=None,
            label=0,
        ),
        # Delete one function, add another (independent)
        lambda: _make_sample(
            a_type="FunctionDef", a_name="old_func",
            a_op="deleted", a_start=random.randint(5, 25), a_end=None,
            b_type="FunctionDef", b_name="new_func",
            b_op="added", b_start=random.randint(60, 90), b_end=None,
            label=0,
        ),
    ]

    # --- Conflict examples ---
    conflict_templates = [
        # Both modify same function
        lambda: _make_same_function_sample("modified", "modified"),
        # Modify same function (one deletes)
        lambda: _make_same_function_sample("modified", "deleted"),
        # Both modify same class
        lambda: _make_same_class_sample("modified", "modified"),
        # Overlapping line ranges, different nodes
        lambda: _make_overlapping_sample(),
        # Same function: add + delete
        lambda: _make_same_function_sample("added", "deleted"),
        # Concurrent modify of same return statement
        lambda: _make_sample(
            a_type="Return", a_name="",
            a_op="modified", a_start=12, a_end=12,
            b_type="Return", b_name="",
            b_op="modified", b_start=12, b_end=12,
            label=1,
        ),
        # Rename + modify same function
        lambda: _make_sample(
            a_type="FunctionDef", a_name="calculate",
            a_op="modified", a_start=10, a_end=14,
            b_type="FunctionDef", b_name="calculate",
            b_op="modified", b_start=10, b_end=14,
            label=1,
        ),
        # Parent/child: class modified + method inside modified
        lambda: _make_sample(
            a_type="ClassDef", a_name="MyModel",
            a_op="modified", a_start=5, a_end=30,
            b_type="FunctionDef", b_name="my_method",
            b_op="modified", b_start=10, b_end=15,
            label=1,
        ),
        # Delete class that other user modified
        lambda: _make_same_class_sample("deleted", "modified"),
    ]

    n_compatible = n_samples // 2
    n_conflict = n_samples - n_compatible

    for _ in range(n_compatible):
        fn = random.choice(compatible_templates)
        samples.append(fn())

    for _ in range(n_conflict):
        fn = random.choice(conflict_templates)
        samples.append(fn())

    random.shuffle(samples)
    return samples


def _make_sample(
    a_type, a_name, a_op, a_start, a_end,
    b_type, b_name, b_op, b_start, b_end,
    label,
) -> dict:
    if a_end is None:
        a_end = a_start + random.randint(2, 10)
    if b_end is None:
        b_end = b_start + random.randint(2, 10)

    same_node_type = int(a_type == b_type)
    same_name = int(a_name != "" and a_name == b_name)
    same_function = int(a_type == "FunctionDef" and b_type == "FunctionDef" and a_name == b_name)
    same_class = int(a_type == "ClassDef" and b_type == "ClassDef" and a_name == b_name)

    overlap = int(a_start <= b_end and b_start <= a_end)
    a_range = max(1, a_end - a_start)
    b_range = max(1, b_end - b_start)
    overlap_len = max(0, min(a_end, b_end) - max(a_start, b_start))
    overlap_ratio = round(overlap_len / max(a_range, b_range), 4)
    structural_distance = min(abs(a_start - b_start), 500)

    op_combos = {
        ("modified", "modified"): 3, ("deleted", "modified"): 4,
        ("modified", "deleted"): 4, ("deleted", "deleted"): 2,
        ("added", "added"): 1, ("added", "modified"): 1,
        ("modified", "added"): 1, ("added", "deleted"): 1,
        ("deleted", "added"): 1,
    }
    op_combo_score = op_combos.get((a_op, b_op), 0)
    both_modify = int(a_op == "modified" and b_op == "modified")
    delete_and_modify = int(
        (a_op == "deleted" and b_op == "modified") or
        (a_op == "modified" and b_op == "deleted")
    )

    type_map = {"FunctionDef": 1, "ClassDef": 2, "Import": 3, "ImportFrom": 3,
                "Assign": 4, "Return": 5, "If": 6, "For": 7, "While": 8}

    return {
        "same_node_type": same_node_type,
        "same_name": same_name,
        "same_function": same_function,
        "same_class": same_class,
        "line_overlap": overlap,
        "overlap_ratio": overlap_ratio,
        "structural_distance": structural_distance,
        "op_combo_score": op_combo_score,
        "both_modify": both_modify,
        "delete_and_modify": delete_and_modify,
        "node_type_a": type_map.get(a_type, 0),
        "node_type_b": type_map.get(b_type, 0),
        "label": label,
    }


def _make_same_function_sample(op_a, op_b) -> dict:
    name = random.choice(["calculate", "process", "validate", "transform", "fetch"])
    start = random.randint(5, 50)
    end = start + random.randint(3, 15)
    return _make_sample(
        a_type="FunctionDef", a_name=name, a_op=op_a, a_start=start, a_end=end,
        b_type="FunctionDef", b_name=name, b_op=op_b, b_start=start, b_end=end,
        label=1,
    )


def _make_same_class_sample(op_a, op_b) -> dict:
    name = random.choice(["Model", "Controller", "Service", "Repository", "Handler"])
    start = random.randint(5, 40)
    end = start + random.randint(10, 30)
    return _make_sample(
        a_type="ClassDef", a_name=name, a_op=op_a, a_start=start, a_end=end,
        b_type="ClassDef", b_name=name, b_op=op_b, b_start=start, b_end=end,
        label=1,
    )


def _make_overlapping_sample() -> dict:
    start_a = random.randint(10, 40)
    end_a = start_a + random.randint(5, 15)
    start_b = start_a + random.randint(-3, 5)  # likely overlapping
    end_b = start_b + random.randint(5, 15)
    return _make_sample(
        a_type="FunctionDef", a_name="func_overlap_a",
        a_op="modified", a_start=start_a, a_end=end_a,
        b_type="FunctionDef", b_name="func_overlap_b",
        b_op="modified", b_start=start_b, b_end=end_b,
        label=1,
    )


def save_dataset(samples: list[dict], path: Path = DATASET_PATH) -> str:
    """Save dataset to CSV and return path."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FEATURES)
        writer.writeheader()
        writer.writerows(samples)
    return str(path)


def load_dataset(path: Path = DATASET_PATH):
    """Load dataset from CSV."""
    import pandas as pd
    return pd.read_csv(path)


if __name__ == "__main__":
    samples = generate_dataset(800)
    out = save_dataset(samples)
    print(f"Dataset saved: {out} ({len(samples)} samples)")
