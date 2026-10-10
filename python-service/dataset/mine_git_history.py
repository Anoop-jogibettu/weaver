#!/usr/bin/env python3
"""Mine AST-level merge-conflict examples from local Python Git repositories.

This tool never downloads repositories. Pass one or more local repository paths
that you have already cloned and that you are permitted to analyse. For every
two-parent merge commit it finds Python files changed by both parents, recreates
a three-way file merge with ``git merge-file``, and emits pairs of AST changes.

The JSONL output preserves provenance for review; the optional CSV contains the
numeric feature columns expected by Weaver's classifier.

Example (do not run against repositories you are not allowed to analyse):
    python mine_git_history.py \
      --repo /path/to/flask \
      --repo /path/to/requests \
      --output mined_examples.jsonl \
      --csv-output mined_features.csv \
      --max-merges 500
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import itertools
import json
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from ast_parser.parser import analyze_concurrent_changes, diff_asts, parse_source
from ml.classifier import FEATURE_COLS

PYTHON_SUFFIXES = {".py", ".pyw"}


class GitError(RuntimeError):
    """A Git command could not be completed for a repository."""


@dataclass(frozen=True)
class FileMerge:
    label: int
    label_name: str


def git(repo: Path, *args: str, allow_failure: bool = False) -> subprocess.CompletedProcess[str]:
    """Run Git without invoking a shell."""
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if result.returncode and not allow_failure:
        message = result.stderr.strip() or result.stdout.strip() or "unknown Git failure"
        raise GitError(f"git {' '.join(args)}: {message}")
    return result


def read_blob(repo: Path, revision: str, filename: str) -> str | None:
    """Read a tracked text file at a revision; skip deleted/binary/unreadable files."""
    result = git(repo, "show", f"{revision}:{filename}", allow_failure=True)
    if result.returncode:
        return None
    if "\x00" in result.stdout:
        return None
    return result.stdout


def changed_python_files(repo: Path, base: str, left: str, right: str) -> list[str]:
    """Return Python files changed independently by both merge parents."""
    left_files = set(git(repo, "diff", "--name-only", base, left).stdout.splitlines())
    right_files = set(git(repo, "diff", "--name-only", base, right).stdout.splitlines())
    return sorted(
        filename
        for filename in left_files & right_files
        if Path(filename).suffix.lower() in PYTHON_SUFFIXES
    )


def recreate_file_merge(base: str, left: str, right: str) -> FileMerge | None:
    """Use Git's three-way file merger to create a reproducible textual label."""
    with tempfile.TemporaryDirectory(prefix="weaver-merge-") as temp_dir:
        directory = Path(temp_dir)
        left_path = directory / "left.py"
        base_path = directory / "base.py"
        right_path = directory / "right.py"
        left_path.write_text(left, encoding="utf-8")
        base_path.write_text(base, encoding="utf-8")
        right_path.write_text(right, encoding="utf-8")
        result = subprocess.run(
            ["git", "merge-file", "-p", str(left_path), str(base_path), str(right_path)],
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
    if result.returncode == 0:
        return FileMerge(label=0, label_name="compatible")
    if result.returncode == 1:
        return FileMerge(label=1, label_name="text_conflict")
    return None


def source_digest(source: str) -> str:
    return hashlib.sha256(source.encode("utf-8")).hexdigest()[:16]


def ast_change_pairs(base: str, left: str, right: str, max_pairs: int) -> Iterable[tuple[dict[str, Any], dict[str, Any]]]:
    """Yield bounded pairs of structural changes from the two merge parents."""
    base_result = parse_source(base)
    left_result = parse_source(left)
    right_result = parse_source(right)
    if not all(result["success"] for result in (base_result, left_result, right_result)):
        return []

    left_changes = diff_asts(base_result["nodes"], left_result["nodes"])
    right_changes = diff_asts(base_result["nodes"], right_result["nodes"])
    return itertools.islice(itertools.product(left_changes, right_changes), max_pairs)


def merge_commits(repo: Path, maximum: int) -> Iterable[tuple[str, str, str, str]]:
    """Yield merge SHA, merge base, and the first two parent SHAs."""
    commits = git(repo, "rev-list", "--merges", "--all", f"--max-count={maximum}").stdout.splitlines()
    for commit in commits:
        parents = git(repo, "rev-list", "--parents", "-n", "1", commit).stdout.split()
        if len(parents) < 3:
            continue
        left, right = parents[1], parents[2]
        base = git(repo, "merge-base", left, right).stdout.strip()
        if base:
            yield commit, base, left, right


def build_rows(repo: Path, max_merges: int, max_pairs_per_file: int, max_file_bytes: int) -> Iterable[dict[str, Any]]:
    """Create reviewable, classifier-ready rows from one local repository."""
    repo_name = git(repo, "config", "--get", "remote.origin.url", allow_failure=True).stdout.strip() or repo.name
    for merge_commit, base_commit, left_parent, right_parent in merge_commits(repo, max_merges):
        for filename in changed_python_files(repo, base_commit, left_parent, right_parent):
            base = read_blob(repo, base_commit, filename)
            left = read_blob(repo, left_parent, filename)
            right = read_blob(repo, right_parent, filename)
            if base is None or left is None or right is None:
                continue
            if any(len(value.encode("utf-8")) > max_file_bytes for value in (base, left, right)):
                continue
            merge = recreate_file_merge(base, left, right)
            if merge is None:
                continue

            for change_a, change_b in ast_change_pairs(base, left, right, max_pairs_per_file):
                features = analyze_concurrent_changes(change_a, change_b)
                yield {
                    "repository": repo_name,
                    "merge_commit": merge_commit,
                    "merge_base": base_commit,
                    "left_parent": left_parent,
                    "right_parent": right_parent,
                    "file": filename,
                    "label": merge.label,
                    "label_name": merge.label_name,
                    "change_a": change_a,
                    "change_b": change_b,
                    "base_sha256": source_digest(base),
                    "left_sha256": source_digest(left),
                    "right_sha256": source_digest(right),
                    "features": features,
                }


def ensure_new_output(path: Path, overwrite: bool) -> None:
    if path.exists() and not overwrite:
        raise FileExistsError(f"Refusing to overwrite existing output: {path}. Pass --overwrite to replace it.")
    path.parent.mkdir(parents=True, exist_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Mine AST-level Python merge examples from local Git repositories.")
    parser.add_argument("--repo", action="append", required=True, type=Path, help="Local Git repository to analyse; repeat for more repositories.")
    parser.add_argument("--output", required=True, type=Path, help="JSONL destination for reviewable mined examples.")
    parser.add_argument("--csv-output", type=Path, help="Optional classifier-ready CSV destination.")
    parser.add_argument("--max-merges", type=int, default=500, help="Maximum merge commits examined per repository (default: 500).")
    parser.add_argument("--max-pairs-per-file", type=int, default=20, help="Maximum AST change pairs retained from one file (default: 20).")
    parser.add_argument("--max-file-kb", type=int, default=256, help="Skip files larger than this per revision (default: 256 KB).")
    parser.add_argument("--overwrite", action="store_true", help="Allow replacing existing output files.")
    args = parser.parse_args()

    if args.max_merges < 1 or args.max_pairs_per_file < 1 or args.max_file_kb < 1:
        parser.error("--max-merges, --max-pairs-per-file, and --max-file-kb must be positive")

    for repo in args.repo:
        try:
            git(repo, "rev-parse", "--is-inside-work-tree")
        except GitError as error:
            parser.error(f"{repo}: {error}")

    try:
        ensure_new_output(args.output, args.overwrite)
        if args.csv_output:
            if args.csv_output.resolve() == args.output.resolve():
                parser.error("--output and --csv-output must be different files")
            ensure_new_output(args.csv_output, args.overwrite)
    except FileExistsError as error:
        parser.error(str(error))

    rows_written = 0
    conflicts = 0
    csv_file = None
    try:
        with args.output.open("w", encoding="utf-8") as jsonl_file:
            writer = None
            if args.csv_output:
                csv_file = args.csv_output.open("w", newline="", encoding="utf-8")
                writer = csv.DictWriter(csv_file, fieldnames=[*FEATURE_COLS, "label", "label_name", "repository", "merge_commit", "file"])
                writer.writeheader()

            for repo in args.repo:
                for row in build_rows(repo.resolve(), args.max_merges, args.max_pairs_per_file, args.max_file_kb * 1024):
                    jsonl_file.write(json.dumps(row, ensure_ascii=False) + "\n")
                    if writer:
                        writer.writerow({
                            **{feature: row["features"].get(feature, 0) for feature in FEATURE_COLS},
                            "label": row["label"],
                            "label_name": row["label_name"],
                            "repository": row["repository"],
                            "merge_commit": row["merge_commit"],
                            "file": row["file"],
                        })
                    rows_written += 1
                    conflicts += row["label"]
    finally:
        if csv_file:
            csv_file.close()

    print(f"Wrote {rows_written} AST change pairs ({conflicts} text-conflict labels) to {args.output}")
    if args.csv_output:
        print(f"Wrote classifier-ready CSV to {args.csv_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
