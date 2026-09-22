"""
Weaver AST Parser Module
Parses Python source code using the built-in ast module and extracts structural changes.
"""
import ast
import hashlib
from typing import Any, Optional


def parse_source(source: str) -> dict:
    """Parse Python source code and return a JSON-serializable AST summary."""
    try:
        tree = ast.parse(source)
        return {
            "success": True,
            "nodes": extract_nodes(tree),
            "raw_source_hash": hashlib.md5(source.encode()).hexdigest(),
        }
    except SyntaxError as e:
        return {
            "success": False,
            "error": str(e),
            "nodes": [],
            "raw_source_hash": "",
        }


def extract_nodes(tree: ast.AST) -> list[dict]:
    """Extract a flat list of significant AST nodes."""
    nodes = []
    for node in ast.walk(tree):
        info = node_to_dict(node)
        if info:
            nodes.append(info)
    return nodes


def node_to_dict(node: ast.AST) -> Optional[dict]:
    """Convert an AST node to a dictionary representation."""
    if isinstance(node, ast.FunctionDef) or isinstance(node, ast.AsyncFunctionDef):
        return {
            "node_type": "FunctionDef",
            "name": node.name,
            "line_start": node.lineno,
            "line_end": getattr(node, "end_lineno", node.lineno),
            "args": [arg.arg for arg in node.args.args],
            "decorators": [
                ast.unparse(d) if hasattr(ast, "unparse") else ""
                for d in node.decorator_list
            ],
        }
    elif isinstance(node, ast.ClassDef):
        return {
            "node_type": "ClassDef",
            "name": node.name,
            "line_start": node.lineno,
            "line_end": getattr(node, "end_lineno", node.lineno),
            "bases": [
                ast.unparse(b) if hasattr(ast, "unparse") else ""
                for b in node.bases
            ],
        }
    elif isinstance(node, ast.Import):
        return {
            "node_type": "Import",
            "names": [alias.name for alias in node.names],
            "line_start": node.lineno,
            "line_end": getattr(node, "end_lineno", node.lineno),
        }
    elif isinstance(node, ast.ImportFrom):
        return {
            "node_type": "ImportFrom",
            "module": node.module or "",
            "names": [alias.name for alias in node.names],
            "line_start": node.lineno,
            "line_end": getattr(node, "end_lineno", node.lineno),
        }
    elif isinstance(node, ast.Assign):
        targets = []
        for t in node.targets:
            try:
                targets.append(ast.unparse(t) if hasattr(ast, "unparse") else "")
            except Exception:
                targets.append("?")
        return {
            "node_type": "Assign",
            "targets": targets,
            "line_start": node.lineno,
            "line_end": getattr(node, "end_lineno", node.lineno),
        }
    elif isinstance(node, ast.Return):
        return {
            "node_type": "Return",
            "line_start": node.lineno,
            "line_end": getattr(node, "end_lineno", node.lineno),
            "value": (
                ast.unparse(node.value)
                if (hasattr(ast, "unparse") and node.value)
                else ""
            ),
        }
    elif isinstance(node, ast.If):
        return {
            "node_type": "If",
            "line_start": node.lineno,
            "line_end": getattr(node, "end_lineno", node.lineno),
            "test": (
                ast.unparse(node.test) if hasattr(ast, "unparse") else ""
            ),
        }
    elif isinstance(node, ast.For):
        return {
            "node_type": "For",
            "line_start": node.lineno,
            "line_end": getattr(node, "end_lineno", node.lineno),
        }
    elif isinstance(node, ast.While):
        return {
            "node_type": "While",
            "line_start": node.lineno,
            "line_end": getattr(node, "end_lineno", node.lineno),
        }
    return None


def diff_asts(old_nodes: list[dict], new_nodes: list[dict]) -> list[dict]:
    """
    Compare two lists of AST nodes and produce a list of structural changes.
    Returns a list of change records.
    """
    changes = []

    # Index by (node_type, name) where name exists
    def index_by_name(nodes):
        idx = {}
        for n in nodes:
            key = (n["node_type"], n.get("name", f"line:{n['line_start']}"))
            idx[key] = n
        return idx

    old_idx = index_by_name(old_nodes)
    new_idx = index_by_name(new_nodes)

    old_keys = set(old_idx.keys())
    new_keys = set(new_idx.keys())

    # Added nodes
    for k in new_keys - old_keys:
        node = new_idx[k]
        changes.append(
            {
                "operation": "added",
                "node_type": node["node_type"],
                "name": node.get("name", ""),
                "line_start": node["line_start"],
                "line_end": node["line_end"],
                "parent": "Module",
            }
        )

    # Deleted nodes
    for k in old_keys - new_keys:
        node = old_idx[k]
        changes.append(
            {
                "operation": "deleted",
                "node_type": node["node_type"],
                "name": node.get("name", ""),
                "line_start": node["line_start"],
                "line_end": node["line_end"],
                "parent": "Module",
            }
        )

    # Modified nodes
    for k in old_keys & new_keys:
        old_node = old_idx[k]
        new_node = new_idx[k]
        if old_node != new_node:
            changes.append(
                {
                    "operation": "modified",
                    "node_type": new_node["node_type"],
                    "name": new_node.get("name", ""),
                    "line_start": new_node["line_start"],
                    "line_end": new_node["line_end"],
                    "old_line_start": old_node["line_start"],
                    "old_line_end": old_node["line_end"],
                    "parent": "Module",
                }
            )

    return changes


def analyze_concurrent_changes(
    change_a: dict, change_b: dict
) -> dict:
    """
    Analyze the relationship between two concurrent AST-level changes.
    Returns a feature vector for ML classification.
    """
    a_type = change_a.get("node_type", "")
    b_type = change_b.get("node_type", "")
    a_name = change_a.get("name", "")
    b_name = change_b.get("name", "")
    a_op = change_a.get("operation", "")
    b_op = change_b.get("operation", "")
    a_start = change_a.get("line_start", 0)
    a_end = change_a.get("line_end", 0)
    b_start = change_b.get("line_start", 0)
    b_end = change_b.get("line_end", 0)

    same_node_type = int(a_type == b_type)
    same_name = int(a_name != "" and a_name == b_name)
    same_function = int(
        a_type == "FunctionDef"
        and b_type == "FunctionDef"
        and a_name == b_name
    )
    same_class = int(
        a_type == "ClassDef"
        and b_type == "ClassDef"
        and a_name == b_name
    )

    # Line overlap
    overlap = int(
        a_start <= b_end and b_start <= a_end and a_start > 0 and b_start > 0
    )
    overlap_ratio = 0.0
    if a_start > 0 and b_start > 0:
        a_range = max(1, a_end - a_start)
        b_range = max(1, b_end - b_start)
        overlap_len = max(0, min(a_end, b_end) - max(a_start, b_start))
        overlap_ratio = overlap_len / max(a_range, b_range)

    structural_distance = abs(a_start - b_start) if (a_start > 0 and b_start > 0) else 999

    op_combo = _op_combo_score(a_op, b_op)
    both_modify = int(a_op == "modified" and b_op == "modified")
    delete_and_modify = int(
        (a_op == "deleted" and b_op == "modified")
        or (a_op == "modified" and b_op == "deleted")
    )
    node_type_a_encoded = _encode_node_type(a_type)
    node_type_b_encoded = _encode_node_type(b_type)

    return {
        "same_node_type": same_node_type,
        "same_name": same_name,
        "same_function": same_function,
        "same_class": same_class,
        "line_overlap": overlap,
        "overlap_ratio": round(overlap_ratio, 4),
        "structural_distance": min(structural_distance, 500),
        "op_combo_score": op_combo,
        "both_modify": both_modify,
        "delete_and_modify": delete_and_modify,
        "node_type_a": node_type_a_encoded,
        "node_type_b": node_type_b_encoded,
    }


def _encode_node_type(node_type: str) -> int:
    mapping = {
        "FunctionDef": 1,
        "ClassDef": 2,
        "Import": 3,
        "ImportFrom": 3,
        "Assign": 4,
        "Return": 5,
        "If": 6,
        "For": 7,
        "While": 8,
    }
    return mapping.get(node_type, 0)


def _op_combo_score(op_a: str, op_b: str) -> int:
    """Return a conflict-risk score for the operation combination."""
    combos = {
        ("modified", "modified"): 3,
        ("deleted", "modified"): 4,
        ("modified", "deleted"): 4,
        ("deleted", "deleted"): 2,
        ("added", "added"): 1,
        ("added", "modified"): 1,
        ("modified", "added"): 1,
        ("added", "deleted"): 1,
        ("deleted", "added"): 1,
    }
    return combos.get((op_a, op_b), 0)
