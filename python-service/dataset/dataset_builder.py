from __future__ import annotations
"""
Weaver Dataset Builder
Converts mined_concurrent_changes.jsonl into a labeled ML feature CSV.

Labeling strategy (improved):
  - If the sample has hunk coordinates (overlap_pairs from miner), use those line
    ranges when calling analyze_concurrent_changes so that AST changes are matched
    to the actual conflicting region — not the whole file.
  - Label = 1 (conflict) only if is_conflict=True AND the two AST changes fall
    within the overlapping hunk's line range.
  - Label = 0 (compatible) otherwise.
  - resolved_content is stored for future seq2seq / LLM fine-tuning use.
"""
import json
import csv
from pathlib import Path

import sys
sys.path.append(str(Path(__file__).parent.parent))

from ast_parser.parser import parse_source, diff_asts, analyze_concurrent_changes
from dataset.generator import FEATURES

MINED_DATA_PATH = Path(__file__).parent / "mined_concurrent_changes.jsonl"
OUT_CSV_PATH    = Path(__file__).parent / "concurrent_changes_mined.csv"


def _changes_in_hunk(changes: list[dict], hunk_start: int | None, hunk_end: int | None) -> list[dict]:
    """Filter AST changes to only those that overlap with the given hunk line range."""
    if hunk_start is None or hunk_end is None:
        return changes
    return [
        c for c in changes
        if c.get("line_start", 0) <= hunk_end and c.get("line_end", 0) >= hunk_start
    ]


def build_dataset() -> None:
    if not MINED_DATA_PATH.exists():
        print(f"Error: {MINED_DATA_PATH} not found. Run github_miner.py first.")
        return

    print(f"Reading mined data from {MINED_DATA_PATH}…")
    with open(MINED_DATA_PATH, encoding="utf-8") as fh:
        lines = fh.readlines()

    print(f"Parsing {len(lines)} samples into AST features…")
    extracted_samples: list[dict] = []

    for i, raw in enumerate(lines):
        raw = raw.strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue

        base_src = data.get("base_content", "")
        p1_src   = data.get("p1_content",   "")
        p2_src   = data.get("p2_content",   "")
        is_conflict = data.get("is_conflict", False)

        # Hunk coordinates (may be None for non-overlapping / compatible samples)
        hunk_p1_start = data.get("hunk_p1_start")
        hunk_p1_end   = data.get("hunk_p1_end")
        hunk_p2_start = data.get("hunk_p2_start")
        hunk_p2_end   = data.get("hunk_p2_end")

        # Parse ASTs
        base_res = parse_source(base_src)
        p1_res   = parse_source(p1_src)
        p2_res   = parse_source(p2_src)

        if not (base_res["success"] and p1_res["success"] and p2_res["success"]):
            continue

        base_nodes = base_res["nodes"]
        p1_nodes   = p1_res["nodes"]
        p2_nodes   = p2_res["nodes"]

        # Diff ASTs
        p1_changes = diff_asts(base_nodes, p1_nodes)
        p2_changes = diff_asts(base_nodes, p2_nodes)

        # If we have hunk coordinates, narrow AST changes to those regions
        # so labels are precise — not file-wide
        p1_in_hunk = _changes_in_hunk(p1_changes, hunk_p1_start, hunk_p1_end)
        p2_in_hunk = _changes_in_hunk(p2_changes, hunk_p2_start, hunk_p2_end)

        # Fall back to all changes if hunk filtering leaves nothing
        effective_p1 = p1_in_hunk if p1_in_hunk else p1_changes
        effective_p2 = p2_in_hunk if p2_in_hunk else p2_changes

        # Generate one ML sample per (change_a, change_b) pair
        for change_a in effective_p1:
            for change_b in effective_p2:
                features = analyze_concurrent_changes(change_a, change_b)

                # Accurate labeling:
                #  - conflict=True AND both changes are in overlapping hunk → label 1
                #  - otherwise → label 0 (compatible)
                in_hunk_a = (hunk_p1_start is None or
                             (change_a.get("line_start", 0) <= (hunk_p1_end or 0) and
                              change_a.get("line_end", 0)   >= (hunk_p1_start or 0)))
                in_hunk_b = (hunk_p2_start is None or
                             (change_b.get("line_start", 0) <= (hunk_p2_end or 0) and
                              change_b.get("line_end", 0)   >= (hunk_p2_start or 0)))

                label = 1 if (is_conflict and in_hunk_a and in_hunk_b) else 0
                features["label"] = label
                extracted_samples.append(features)

        if i > 0 and i % 100 == 0:
            print(f"  {i}/{len(lines)} processed — {len(extracted_samples)} ML samples so far")

    print(f"\nFinished! Total ML samples: {len(extracted_samples)}")

    # Save CSV
    with open(OUT_CSV_PATH, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=FEATURES)
        writer.writeheader()
        writer.writerows(extracted_samples)

    print(f"Saved to {OUT_CSV_PATH}")

    # Quick class balance report
    n_conflict   = sum(1 for s in extracted_samples if s["label"] == 1)
    n_compatible = len(extracted_samples) - n_conflict
    print(f"Class balance  →  conflict: {n_conflict}  compatible: {n_compatible}"
          f"  ratio: {n_conflict / max(1, len(extracted_samples)):.1%}")


if __name__ == "__main__":
    build_dataset()

