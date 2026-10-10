# Git-history dataset miner

`mine_git_history.py` mines examples only from local Git repositories you pass
with `--repo`; it never clones, downloads, or modifies those repositories.

It finds two-parent merge commits, identifies Python files changed by both
parents, recreates a three-way file merge with `git merge-file`, then derives
Weaver's AST feature vectors from each pair of branch changes.

The JSONL output includes provenance and AST changes for review. The optional
CSV output contains the numeric classifier feature columns plus a binary label:

- `0` / `compatible`: Git could merge the file without conflict markers.
- `1` / `text_conflict`: Git's three-way merge produced conflict markers.

Example:

```bash
cd python-service/dataset
python mine_git_history.py \
  --repo /absolute/path/to/a-python-repository \
  --output ../../data/mined_examples.jsonl \
  --csv-output ../../data/mined_features.csv \
  --max-merges 500
```

Review and balance the mined examples before training. A clean textual merge is
not automatically a semantic merge, so semantic-conflict labels should be added
through tests or manual review.
