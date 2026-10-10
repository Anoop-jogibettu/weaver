#!/usr/bin/env python3
from __future__ import annotations
"""
Weaver Real-World Dataset Miner
================================
Mines REAL merge conflict data from GitHub Python repositories.

Pipeline:
  1. Fetch top Python repos by stars via GitHub Search API
  2. Fetch closed/merged Pull Requests for each repo
  3. Get the list of modified .py files in each PR
  4. Download raw Python source at base_sha and head_sha for each file
  5. Run Weaver's AST parser + analyze_concurrent_changes() on every pair
     of AST changes found across the two versions
  6. Label each change-pair:
       - label=1 (Conflict)  → PR was NOT mergeable (or had conflicts)
       - label=0 (Compatible) → PR merged cleanly
  7. Save the final dataset as dataset_real.csv with all 12 ML features

How much data do we need for 85%+ accuracy?
  - With Random Forest on well-distributed data: ~1500–2000 samples is
    sufficient for >85%. We target 3000 real samples for headroom.
  - To achieve this without a PAT: very hard (60 req/hr limit).
  - With a GitHub PAT: 5000 req/hr → easily achievable.

Usage:
  export GITHUB_TOKEN="ghp_your_token_here"   # strongly recommended
  python3 github_dataset_miner.py
"""

import sys
import os
import time
import requests
import pandas as pd
from pathlib import Path
from itertools import combinations

# ── Add python-service root so imports work ──────────────────────────────────
sys.path.insert(0, str(Path(__file__).parent))
from ast_parser.parser import parse_source, diff_asts, analyze_concurrent_changes

# ── GitHub API Setup ─────────────────────────────────────────────────────────
# Read token from env var OR from a local .github_token file (more secure)
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN")
if not GITHUB_TOKEN:
    token_file = Path(__file__).parent / ".github_token"
    if token_file.exists():
        t = token_file.read_text().strip()
        if t and not t.startswith("ghp_paste"):
            GITHUB_TOKEN = t

HEADERS = {"Accept": "application/vnd.github.v3+json"}
if GITHUB_TOKEN:
    HEADERS["Authorization"] = f"token {GITHUB_TOKEN}"
    print("✓ GitHub PAT detected — using authenticated requests (5000 req/hr)")
else:
    print("⚠ No token found. Add it to python-service/.github_token file")

BASE_URL = "https://api.github.com"

# ── Tunable Parameters ────────────────────────────────────────────────────────
TOP_REPOS       = 50      # Number of top Python repos to mine
PRS_PER_REPO    = 100     # PRs to inspect per repo (more = more data)
FILES_PER_PR    = 10      # Max .py files to analyse per PR (API cost control)
TARGET_SAMPLES  = 100000  # Stop early once we have this many feature rows
OUTPUT_CSV      = Path(__file__).parent / "dataset_real.csv"
MINED_PRS_LOG   = Path(__file__).parent / ".mined_prs.log"
SLEEP_BETWEEN   = 0.5    # Seconds to wait between API calls (be polite)


# ── Helpers ───────────────────────────────────────────────────────────────────

def api_get(url: str, params: dict = None, retries: int = 3) -> "requests.Response | None":
    """GET with automatic rate-limit back-off and retry."""
    for attempt in range(retries):
        try:
            resp = requests.get(url, headers=HEADERS, params=params, timeout=15)
            if resp.status_code == 200:
                return resp
            if resp.status_code in (403, 429):
                reset = int(resp.headers.get("X-RateLimit-Reset", time.time() + 60))
                wait  = max(reset - time.time(), 1)
                print(f"  ⏳ Rate-limited. Sleeping {wait:.0f}s …")
                time.sleep(wait)
            elif resp.status_code == 422:
                return None  # GitHub can't compute mergeability for this PR
            else:
                time.sleep(2 ** attempt)  # exponential back-off
        except requests.exceptions.RequestException as e:
            print(f"  ⚠ Network error: {e}. Retrying ...")
            time.sleep(2 ** attempt)
            
    return None


def fetch_raw_file(repo: str, sha: str, filepath: str) -> "str | None":
    """Download the raw text of a single file at a given commit SHA."""
    url = f"{BASE_URL}/repos/{repo}/contents/{filepath}?ref={sha}"
    resp = api_get(url)
    if resp is None:
        return None
    data = resp.json()
    if isinstance(data, dict) and data.get("encoding") == "base64":
        import base64
        try:
            return base64.b64decode(data["content"]).decode("utf-8", errors="replace")
        except Exception:
            return None
    return None


def extract_feature_rows(base_source: str, head_source: str, label: int) -> list[dict]:
    """
    Run Weaver's AST pipeline on two versions of a file.
    Returns a list of feature-row dicts (one per change-pair), each with 'label'.
    """
    base_result = parse_source(base_source)
    head_result = parse_source(head_source)

    if not base_result["success"] or not head_result["success"]:
        return []

    # Get the structural diff (what changed between base and head)
    changes = diff_asts(base_result["nodes"], head_result["nodes"])
    if len(changes) < 2:
        return []

    rows = []
    # Generate all pairwise combinations of concurrent changes
    for change_a, change_b in combinations(changes, 2):
        features = analyze_concurrent_changes(change_a, change_b)
        features["label"] = label
        rows.append(features)
        if len(rows) >= 20:  # Cap per-file pairs to keep dataset balanced
            break
    return rows


# ── Main Mining Pipeline ───────────────────────────────────────────────────────

def get_top_repos(n: int) -> list[str]:
    print(f"\n{'='*60}")
    print(f"Step 1: Fetching top {n} Python repos …")
    resp = api_get(f"{BASE_URL}/search/repositories",
                   params={"q": "language:python stars:>1000",
                            "sort": "stars", "order": "desc", "per_page": n})
    if resp is None:
        print("  ✗ Failed to fetch repos.")
        return []
    repos = [r["full_name"] for r in resp.json().get("items", [])]
    for r in repos:
        print(f"  ✓ {r}")
    return repos


def mine_repo(repo: str, current_total: int, target: int, mined_prs: set) -> int:
    print(f"\n{'─'*60}")
    print(f"Mining: {repo}  (collected so far: {current_total}/{target})")

    # Fetch closed PRs (both merged and rejected → both labels)
    resp = api_get(f"{BASE_URL}/repos/{repo}/pulls",
                   params={"state": "closed", "per_page": PRS_PER_REPO, "sort": "updated"})
    if resp is None:
        print("  ✗ Could not fetch PRs.")
        return current_total

    prs = resp.json()
    print(f"  Found {len(prs)} PRs to process …")

    for pr in prs:
        if current_total >= target:
            return current_total

        pr_number  = pr["number"]
        pr_id      = f"{repo}#{pr_number}"
        if pr_id in mined_prs:
            continue

        pr_number  = pr["number"]
        base_sha   = pr["base"]["sha"]
        head_sha   = pr["head"]["sha"]
        was_merged = pr["merged_at"] is not None

        # Determine the conflict label.
        # A PR that was never merged AND is closed = rejected/conflicted → label 1
        # A PR that was merged cleanly              → label 0
        # Note: GitHub's `mergeable` field only works on *open* PRs.
        # For closed PRs we use merge status as a reliable proxy.
        label = 0 if was_merged else 1

        # Fetch the list of files changed in this PR
        files_resp = api_get(f"{BASE_URL}/repos/{repo}/pulls/{pr_number}/files",
                              params={"per_page": 30})
        if files_resp is None:
            continue

        py_files = [
            f["filename"] for f in files_resp.json()
            if f["filename"].endswith(".py") and f.get("status") == "modified"
        ][:FILES_PER_PR]

        if not py_files:
            time.sleep(SLEEP_BETWEEN)
            continue

        new_rows = 0
        for filepath in py_files:
            if current_total >= target:
                return current_total

            base_src = fetch_raw_file(repo, base_sha, filepath)
            head_src = fetch_raw_file(repo, head_sha, filepath)

            if base_src is None or head_src is None:
                continue

            rows = extract_feature_rows(base_src, head_src, label)
            if rows:
                df = pd.DataFrame(rows)
                # Ensure all features exist
                feature_cols = [
                    "same_node_type", "same_name", "same_function", "same_class",
                    "line_overlap", "overlap_ratio", "structural_distance",
                    "op_combo_score", "both_modify", "delete_and_modify",
                    "node_type_a", "node_type_b", "label"
                ]
                for col in feature_cols:
                    if col not in df.columns: df[col] = 0
                df = df[feature_cols]
                
                # Append to CSV
                header = not OUTPUT_CSV.exists()
                df.to_csv(OUTPUT_CSV, mode='a', index=False, header=header)
                new_rows += len(rows)
                current_total += len(rows)
                
            time.sleep(SLEEP_BETWEEN)

        status = "🔴 Conflict" if label == 1 else "🟢 Merged"
        print(f"  PR #{pr_number:5d} | {status} | .py files: {len(py_files)} | new rows: +{new_rows} | total: {current_total}")
        
        with open(MINED_PRS_LOG, "a") as f:
            f.write(f"{pr_id}\n")
        mined_prs.add(pr_id)
        
        time.sleep(SLEEP_BETWEEN)
    return current_total


def main():
    print("\n" + "="*60)
    print("  Weaver GitHub Dataset Miner")
    print(f"  Target: {TARGET_SAMPLES} real feature samples")
    print(f"  Output: {OUTPUT_CSV}")
    print("="*60)

    repos   = get_top_repos(TOP_REPOS)

    current_total = 0
    if OUTPUT_CSV.exists():
        try: current_total = len(pd.read_csv(OUTPUT_CSV))
        except: pass

    mined_prs = set()
    if MINED_PRS_LOG.exists():
        mined_prs = set(MINED_PRS_LOG.read_text().splitlines())

    for repo in repos:
        if current_total >= TARGET_SAMPLES:
            break
        current_total = mine_repo(repo, current_total, TARGET_SAMPLES, mined_prs)

    if not OUTPUT_CSV.exists():
        print("\n✗ No data collected. Check terminal for errors.")
        return

    df = pd.read_csv(OUTPUT_CSV)

    print(f"\n{'='*60}")
    print(f"✓ DONE! Saved {len(df)} real samples → {OUTPUT_CSV}")
    print(f"  Class distribution:")
    print(df["label"].value_counts().to_string())

    # --- Auto-train the model on the new real dataset ---
    print(f"\nAuto-training ML model on real dataset …")
    from ml.classifier import train as ml_train
    results = ml_train(df.drop(columns=["label"]).assign(label=df["label"]))
    print(f"  Accuracy : {results['accuracy']:.1%}")
    print(f"  Precision: {results['precision']:.1%}")
    print(f"  Recall   : {results['recall']:.1%}")
    print(f"  F1 Score : {results['f1']:.1%}")
    print(f"\n✓ Model saved to ml/model.joblib — Weaver is now using real-world data!")


if __name__ == "__main__":
    main()
