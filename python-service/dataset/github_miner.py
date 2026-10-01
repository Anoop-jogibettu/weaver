"""
Weaver GitHub Miner
Mines real-world Python repositories for concurrent merge edits.

Pipeline:
  1. Clone repo as bare
  2. Walk merge commits (2 parents only)
  3. For each concurrently edited .py file:
     - Detect conflict accurately via per-file git merge-tree section scan
     - Extract overlapping diff hunks (not raw full files) for fine-grained labels
     - Capture base / p1 / p2 / resolved content (ground truth)
     - SHA256 fingerprint deduplication across runs
  4. Append to mined_concurrent_changes.jsonl incrementally
  5. validate_dataset() reports accuracy metrics after mining

Improvements over original:
  - Per-file conflict detection (scoped merge-tree section, not global string match)
  - Overlapping hunk extraction so ML model learns at hunk level, not file level
  - resolved_content extracted from actual merge commit (ground truth for supervised learning)
  - SHA256 deduplication to avoid re-writing the same merge across reruns
  - Configurable timeout on every git subprocess call
  - Structured logging to both stdout and miner.log
  - validate_dataset() to assess data quality after mining
"""

import hashlib
import json
import logging
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional, List, Dict, Set, Tuple

# ─── Paths ────────────────────────────────────────────────────────────────────
MINED_DATA_PATH = Path(__file__).parent / "mined_concurrent_changes.jsonl"
COMPLETED_FILE  = Path(__file__).parent / "completed_repos.txt"
SEEN_HASHES_FILE = Path(__file__).parent / "seen_hashes.txt"
LOG_PATH        = Path(__file__).parent / "miner.log"

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    handlers=[
        logging.FileHandler(LOG_PATH, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("weaver-miner")


# ─── Git helpers ──────────────────────────────────────────────────────────────

def run_git(cmd: list, cwd: str = None, timeout: int = 60) -> Optional[str]:
    """Run a git command; return stdout on success, None on failure/timeout."""
    try:
        result = subprocess.run(
            cmd, cwd=cwd,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, errors="replace", timeout=timeout,
        )
        if result.returncode != 0:
            return None
        return result.stdout.strip()
    except subprocess.TimeoutExpired:
        log.warning("git command timed out: %s", " ".join(str(c) for c in cmd[:5]))
        return None
    except Exception as exc:
        log.warning("git error: %s", exc)
        return None


def git_show(ref: str, file_path: str, cwd: str) -> Optional[str]:
    """Return the content of file_path at git ref, or None."""
    return run_git(["git", "show", f"{ref}:{file_path}"], cwd=cwd, timeout=30)


def file_fingerprint(repo_url: str, merge_hash: str, file_path: str) -> str:  # noqa
    """Stable SHA256 fingerprint for deduplication."""
    raw = f"{repo_url}|{merge_hash}|{file_path}"
    return hashlib.sha256(raw.encode()).hexdigest()


# ─── Per-file conflict detection ──────────────────────────────────────────────

def _split_merge_tree_sections(output: str) -> List[str]:
    """
    Split git merge-tree output into per-file sections.
    Each section starts with a header line like 'changed in both' or 'added in remote'.
    """
    sections: List[str] = []
    current: List[str] = []
    header_keywords = ("changed in both", "added in remote", "removed in remote",
                       "added in local", "removed in local", "both added", "both removed")
    for line in output.splitlines():
        stripped = line.strip()
        if any(stripped.startswith(kw) for kw in header_keywords):
            if current:
                sections.append("\n".join(current))
            current = [line]
        else:
            current.append(line)
    if current:
        sections.append("\n".join(current))
    return sections


def is_file_conflicted(mb: str, p1: str, p2: str, file_path: str, cwd: str) -> bool:  # noqa
    """
    Accurately determine if a specific file has a merge conflict.
    Scans only the section of git merge-tree output that mentions file_path.
    Returns True only if that section contains conflict markers (+<<<<<<<).
    """
    output = run_git(["git", "merge-tree", mb, p1, p2], cwd=cwd, timeout=120)
    if not output:
        return False
    for section in _split_merge_tree_sections(output):
        if file_path in section:
            # Conflict markers appear as added lines (+<<<<<<<) in the diff
            if "+<<<<<<< " in section or "+<<<<<<<\n" in section:
                return True
    return False


# ─── Hunk-level extraction ────────────────────────────────────────────────────

def extract_diff_hunks(base: str, branch: str) -> List[Dict]:
    """
    Use Python difflib to extract changed line-ranges between base and branch.
    Returns list of hunk dicts with base and branch coordinates + raw text.
    """
    import difflib
    base_lines   = base.splitlines(keepends=True)
    branch_lines = branch.splitlines(keepends=True)
    matcher = difflib.SequenceMatcher(None, base_lines, branch_lines, autojunk=False)
    hunks = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        hunks.append({
            "base_start":   i1 + 1,
            "base_end":     i2,
            "branch_start": j1 + 1,
            "branch_end":   j2,
            "hunk_base":    "".join(base_lines[i1:i2]),
            "hunk_branch":  "".join(branch_lines[j1:j2]),
        })
    return hunks


def overlapping_hunks(hunks_p1: List[Dict], hunks_p2: List[Dict]) -> List[Tuple]:
    """
    Find hunk pairs from p1 and p2 that overlap in base coordinate space.
    These are the concurrent conflicting regions.
    """
    pairs = []
    for h1 in hunks_p1:
        for h2 in hunks_p2:
            if h1["base_start"] <= h2["base_end"] and h2["base_start"] <= h1["base_end"]:
                pairs.append((h1, h2))
    return pairs


# ─── Core mining function ─────────────────────────────────────────────────────

def mine_repository(repo_url: str, max_merges: int = 1000) -> int:  # noqa
    """
    Clone repo and mine concurrent Python edits.
    Returns the number of new samples written to MINED_DATA_PATH.
    """
    log.info("━" * 60)
    log.info("Mining: %s", repo_url)

    # Load seen fingerprints for deduplication
    seen_hashes: Set[str] = set()
    if SEEN_HASHES_FILE.exists():
        with open(SEEN_HASHES_FILE) as fh:
            seen_hashes = set(fh.read().splitlines())

    new_samples = 0

    with tempfile.TemporaryDirectory() as temp_dir:
        repo_dir = os.path.join(temp_dir, "repo")
        log.info("Cloning (bare)…")
        try:
            subprocess.run(
                ["git", "clone", "--bare", repo_url, repo_dir],
                check=True, capture_output=True, timeout=600,
            )
        except subprocess.TimeoutExpired:
            log.error("Clone timed out: %s", repo_url)
            return 0
        except subprocess.CalledProcessError as exc:
            log.error("Clone failed: %s", exc.stderr.decode()[:300] if exc.stderr else "")
            return 0

        log_output = run_git(["git", "log", "--merges", "--format=%H %P"],
                              cwd=repo_dir, timeout=120)
        if not log_output:
            log.warning("No merge commits in %s", repo_url)
            return 0

        merge_commits = [l for l in log_output.split("\n") if l.strip()]
        log.info("Found %d merge commits. Analyzing up to %d…",
                 len(merge_commits), max_merges)

        for i, line in enumerate(merge_commits):
            if i >= max_merges:
                break

            parts = line.split()
            if len(parts) != 3:
                continue  # skip octopus merges

            merge_hash, p1, p2 = parts[0], parts[1], parts[2]

            mb = run_git(["git", "merge-base", p1, p2], cwd=repo_dir)
            if not mb:
                continue

            p1_diff = run_git(["git", "diff", "--name-only", mb, p1, "--", "*.py"], cwd=repo_dir)
            p2_diff = run_git(["git", "diff", "--name-only", mb, p2, "--", "*.py"], cwd=repo_dir)

            p1_files = set(p1_diff.split("\n")) if p1_diff else set()
            p2_files = set(p2_diff.split("\n")) if p2_diff else set()
            concurrent_files = p1_files & p2_files

            if not concurrent_files:
                continue

            log.info("  [%d/%d] Merge %s — %d concurrent .py files",
                     i + 1, min(len(merge_commits), max_merges),
                     merge_hash[:10], len(concurrent_files))

            for file_path in concurrent_files:
                if not file_path:
                    continue

                # Deduplication
                fp = file_fingerprint(repo_url, merge_hash, file_path)
                if fp in seen_hashes:
                    log.debug("    Skip (dup): %s", file_path)
                    continue

                # Accurate per-file conflict detection
                is_conflict = is_file_conflicted(mb, p1, p2, file_path, repo_dir)

                # Extract contents (ground truth included)
                base_content     = git_show(mb,          file_path, repo_dir)
                p1_content       = git_show(p1,          file_path, repo_dir)
                p2_content       = git_show(p2,          file_path, repo_dir)
                resolved_content = git_show(merge_hash,  file_path, repo_dir)

                if not (base_content and p1_content and p2_content and resolved_content):
                    log.debug("    Skip (missing content): %s", file_path)
                    continue

                # Fine-grained hunk-level extraction
                hunks_p1 = extract_diff_hunks(base_content, p1_content)
                hunks_p2 = extract_diff_hunks(base_content, p2_content)
                overlap_pairs = overlapping_hunks(hunks_p1, hunks_p2)

                if overlap_pairs:
                    # Emit one sample per overlapping hunk pair (conflict-level granularity)
                    for h1, h2 in overlap_pairs:
                        sample = {
                            "repo":             repo_url,
                            "merge_commit":     merge_hash,
                            "file_path":        file_path,
                            "is_conflict":      is_conflict,
                            "hunk_base_start":  h1["base_start"],
                            "hunk_base_end":    h1["base_end"],
                            "hunk_p1_start":    h1["branch_start"],
                            "hunk_p1_end":      h1["branch_end"],
                            "hunk_p2_start":    h2["branch_start"],
                            "hunk_p2_end":      h2["branch_end"],
                            "hunk_base":        h1["hunk_base"],
                            "hunk_p1":          h1["hunk_branch"],
                            "hunk_p2":          h2["hunk_branch"],
                            "base_content":     base_content,
                            "p1_content":       p1_content,
                            "p2_content":       p2_content,
                            "resolved_content": resolved_content,
                        }
                        with open(MINED_DATA_PATH, "a", encoding="utf-8") as out:
                            out.write(json.dumps(sample) + "\n")
                        new_samples += 1
                else:
                    # Non-overlapping concurrent edits → guaranteed compatible example
                    sample = {
                        "repo":             repo_url,
                        "merge_commit":     merge_hash,
                        "file_path":        file_path,
                        "is_conflict":      False,
                        "hunk_base_start":  None,
                        "hunk_base_end":    None,
                        "hunk_p1_start":    None,
                        "hunk_p1_end":      None,
                        "hunk_p2_start":    None,
                        "hunk_p2_end":      None,
                        "hunk_base":        None,
                        "hunk_p1":          None,
                        "hunk_p2":          None,
                        "base_content":     base_content,
                        "p1_content":       p1_content,
                        "p2_content":       p2_content,
                        "resolved_content": resolved_content,
                    }
                    with open(MINED_DATA_PATH, "a", encoding="utf-8") as out:
                        out.write(json.dumps(sample) + "\n")
                    new_samples += 1

                # Mark as processed
                with open(SEEN_HASHES_FILE, "a") as hf:
                    hf.write(fp + "\n")
                seen_hashes.add(fp)

                log.info("    ✓ %s  conflict=%s  overlap_pairs=%d",
                         file_path, is_conflict, len(overlap_pairs))

    log.info("Done: %s — %d new samples", repo_url, new_samples)
    return new_samples


# ─── Dataset validation ───────────────────────────────────────────────────────

def validate_dataset(path: Path = MINED_DATA_PATH) -> Dict:
    """
    Scan the mined JSONL and return quality statistics.
    Call after mining to verify data accuracy before training.
    """
    total = conflict = non_conflict = with_hunks = missing_resolved = malformed = 0
    repos: Set[str] = set()
    required = {"repo", "merge_commit", "file_path", "is_conflict",
                "base_content", "p1_content", "p2_content", "resolved_content"}

    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            raw = raw.strip()
            if not raw:
                continue
            try:
                d = json.loads(raw)
            except json.JSONDecodeError:
                malformed += 1
                continue
            if not required.issubset(d.keys()):
                malformed += 1
                continue

            total += 1
            repos.add(d["repo"])
            if d["is_conflict"]:
                conflict += 1
            else:
                non_conflict += 1
            if d.get("hunk_base") is not None:
                with_hunks += 1
            if not d.get("resolved_content"):
                missing_resolved += 1

    conflict_rate = round(conflict / total * 100, 1) if total else 0
    return {
        "total_samples":          total,
        "malformed_lines":        malformed,
        "conflict":               conflict,
        "non_conflict":           non_conflict,
        "conflict_rate_pct":      conflict_rate,
        "with_hunk_info":         with_hunks,
        "missing_resolved_content": missing_resolved,
        "repos_covered":          len(repos),
        "repos":                  sorted(repos),
    }


# ─── Entry point ──────────────────────────────────────────────────────────────

REPOS_TO_MINE = [
    "https://github.com/django/django.git",
    "https://github.com/pandas-dev/pandas.git",
    "https://github.com/numpy/numpy.git",
    "https://github.com/psf/requests.git",
    "https://github.com/tiangolo/fastapi.git",
    "https://github.com/pallets/flask.git",
    "https://github.com/keras-team/keras.git",
    "https://github.com/scikit-learn/scikit-learn.git",
    "https://github.com/ansible/ansible.git",
    "https://github.com/home-assistant/core.git",
    "https://github.com/scipy/scipy.git",
    "https://github.com/matplotlib/matplotlib.git",
    "https://github.com/pytest-dev/pytest.git",
    "https://github.com/sqlalchemy/sqlalchemy.git",
    "https://github.com/celery/celery.git",
    "https://github.com/scrapy/scrapy.git",
    "https://github.com/tornadoweb/tornado.git",
    "https://github.com/pytorch/pytorch.git",
    "https://github.com/huggingface/transformers.git",
    "https://github.com/encode/django-rest-framework.git",
    "https://github.com/apache/airflow.git",
    "https://github.com/certbot/certbot.git",
    "https://github.com/pydantic/pydantic.git",
    "https://github.com/psf/black.git",
    "https://github.com/sphinx-doc/sphinx.git",
    "https://github.com/ipython/ipython.git",
    "https://github.com/jupyter/notebook.git",
    "https://github.com/dask/dask.git",
    "https://github.com/ray-project/ray.git",
    "https://github.com/bokeh/bokeh.git",
    "https://github.com/plotly/plotly.py.git",
    "https://github.com/mkdocs/mkdocs.git",
    "https://github.com/pypa/pip.git",
    "https://github.com/python-poetry/poetry.git",
    "https://github.com/boto/boto3.git",
    "https://github.com/aws/aws-cli.git",
    "https://github.com/yt-dlp/yt-dlp.git",
    "https://github.com/sqlmapproject/sqlmap.git",
    "https://github.com/Textualize/rich.git",
    "https://github.com/streamlit/streamlit.git",
    "https://github.com/gradio-app/gradio.git",
    "https://github.com/locustio/locust.git",
    "https://github.com/jpadilla/pyjwt.git",
    "https://github.com/tortoise/tortoise-orm.git",
    "https://github.com/gevent/gevent.git",
    "https://github.com/benoitc/gunicorn.git",
    "https://github.com/networkx/networkx.git",
    "https://github.com/pyca/cryptography.git",
    "https://github.com/marshmallow-code/marshmallow.git",
]


if __name__ == "__main__":
    completed_repos: Set[str] = set()
    if COMPLETED_FILE.exists():
        with open(COMPLETED_FILE) as fh:
            completed_repos = set(fh.read().splitlines())

    remaining = [r for r in REPOS_TO_MINE if r not in completed_repos]
    log.info("Mining job: %d repos total, %d remaining", len(REPOS_TO_MINE), len(remaining))

    total_new = 0
    for repo in remaining:
        try:
            n = mine_repository(repo, max_merges=1000)
            total_new += n
            with open(COMPLETED_FILE, "a") as fh:
                fh.write(repo + "\n")
        except Exception as exc:
            log.error("Failed to mine %s: %s", repo, exc)

    log.info("All done. Total new samples this run: %d", total_new)

    if MINED_DATA_PATH.exists():
        stats = validate_dataset()
        log.info("Dataset validation:\n%s", json.dumps(stats, indent=2))
