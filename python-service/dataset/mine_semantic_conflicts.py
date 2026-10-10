#!/usr/bin/env python3
"""
Mine Semantic (Logical) Conflicts from local Git repositories.

This script finds merge commits, performs a test merge, and if the textual
merge succeeds cleanly, it runs a user-provided test command.
- If the tests PASS, it's a Clean Merge (label 0).
- If the tests FAIL, it's a Semantic Conflict (label 1).

It then extracts AST features for the files involved and saves them to a CSV.
"""

import argparse
import csv
import json
import subprocess
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from ast_parser.parser import analyze_concurrent_changes
from ml.classifier import FEATURE_COLS
from dataset.mine_git_history import (
    git, GitError, merge_commits, changed_python_files,
    read_blob, source_digest, ast_change_pairs
)

def run_tests(repo: Path, test_cmd: str) -> bool:
    """Run the test command in the repository. Returns True if successful."""
    print(f"    Running tests: {test_cmd}")
    try:
        result = subprocess.run(
            test_cmd,
            cwd=str(repo),
            shell=True,
            capture_output=True,
            text=True
        )
        return result.returncode == 0
    except Exception as e:
        print(f"    Test execution failed: {e}")
        return False

def mine_semantic_repo(repo: Path, test_cmd: str, max_merges: int, max_pairs: int) -> list[dict]:
    repo_name = git(repo, "config", "--get", "remote.origin.url", allow_failure=True).stdout.strip() or repo.name
    rows = []
    
    # Save the original HEAD to restore later
    original_branch = git(repo, "branch", "--show-current", allow_failure=True).stdout.strip()
    if not original_branch:
        original_branch = git(repo, "rev-parse", "HEAD").stdout.strip()

    print(f"\nMining {repo_name} (max {max_merges} merges)")
    
    try:
        for merge_commit, base_commit, left_parent, right_parent in merge_commits(repo, max_merges):
            print(f"  Evaluating merge {merge_commit[:7]} (parents: {left_parent[:7]}, {right_parent[:7]})")
            
            # 1. Checkout the left parent cleanly
            git(repo, "checkout", "--force", left_parent)
            git(repo, "clean", "-fdx") # Clean untracked files
            
            # 2. Attempt the merge
            merge_res = git(repo, "merge", "--no-commit", "--no-ff", right_parent, allow_failure=True)
            
            if merge_res.returncode != 0:
                print("    Textual conflict detected. Skipping (we only want semantic conflicts).")
                git(repo, "merge", "--abort", allow_failure=True)
                continue
                
            # 3. It's a clean textual merge! Run tests to see if it's logically sound.
            tests_passed = run_tests(repo, test_cmd)
            
            # Revert the working tree back
            git(repo, "reset", "--hard", "HEAD")
            
            label = 0 if tests_passed else 1
            label_name = "clean_semantic" if tests_passed else "semantic_conflict"
            
            print(f"    -> Semantic Result: {label_name.upper()}")
            
            # 4. Extract AST features for files changed by both parents
            files = changed_python_files(repo, base_commit, left_parent, right_parent)
            for filename in files:
                base = read_blob(repo, base_commit, filename)
                left = read_blob(repo, left_parent, filename)
                right = read_blob(repo, right_parent, filename)
                
                if not (base and left and right): continue
                
                for change_a, change_b in ast_change_pairs(base, left, right, max_pairs):
                    features = analyze_concurrent_changes(change_a, change_b)
                    
                    rows.append({
                        "repository": repo_name,
                        "merge_commit": merge_commit,
                        "file": filename,
                        "label": label,
                        "label_name": label_name,
                        **{f: features.get(f, 0) for f in FEATURE_COLS}
                    })
    finally:
        # Always restore the user's original git state!
        print("Restoring original repository state...")
        git(repo, "reset", "--hard", "HEAD")
        git(repo, "checkout", "--force", original_branch)
        
    return rows

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True, help="Path to local Git repo")
    parser.add_argument("--test-cmd", type=str, required=True, help="Command to run tests (e.g. 'pytest')")
    parser.add_argument("--output", type=Path, required=True, help="CSV output path")
    parser.add_argument("--max-merges", type=int, default=50)
    args = parser.parse_args()
    
    rows = mine_semantic_repo(args.repo.resolve(), args.test_cmd, args.max_merges, 20)
    
    if not rows:
        print("\nNo concurrent Python changes found in the evaluated merges.")
        return
        
    with args.output.open("w", newline="", encoding="utf-8") as f:
        fieldnames = [*FEATURE_COLS, "label", "label_name", "repository", "merge_commit", "file"]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows:
            writer.writerow(r)
            
    print(f"\n✓ Saved {len(rows)} semantic feature rows to {args.output}")
    
if __name__ == "__main__":
    main()
