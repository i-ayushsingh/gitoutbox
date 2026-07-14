# Git Safety Contract

GitOutbox operates under a strict, non-destructive safety contract designed to protect your repository state and prevent accidental commits or pushes of unintended code.

---

## 1. Safety Principles

1. **Your Workspace is Sacred**: GitOutbox will never auto-stash, auto-checkout, hard reset, or force-push. It adapts to your environment; it does not force your environment to adapt to it.
2. **Explicit Staging Only**: Staging operates on exact paths. It will never run broad commands like `git add .` or `git add -A`.
3. **Fail Closed**: Any validation mismatch, network failure, or preflight error results in immediate suspension of execution (no commit made, no push run, worker pauses).
4. **No Credential Harvesting**: GitOutbox uses your existing terminal Git authentication (e.g. SSH keys, credential helpers). It never collects, stores, or prompts for credentials.

---

## 2. Fingerprint Protection (Content Gates)

When you schedule a draft, GitOutbox computes a "fingerprint" of the files:
* For each assigned file, it records the file path, size, state (e.g. Modified, Untracked, Deleted), and computes a SHA-256 hash of its contents.
* When the schedule time is reached, GitOutbox re-calculates the fingerprints of the files in your workspace.
* **Invariant**: If any hash, path, or file size differs, the workspace has changed since the schedule was created. GitOutbox immediately aborts, marks the item as `Paused` (`Needs Review`), and notifies you. This prevents you from accidentally committing changes you made after scheduling the item.

---

## 3. Staging and Index Verification (Double-Verification Gate)

Even though GitOutbox stages files by their explicit relative paths, there is a risk that unrelated changes could be staged (for example, due to Git hooks or unexpected file moves).

To protect against this, GitOutbox implements a **double-verification gate**:
1. Staged files are added via `git add path1 path2 ...`.
2. The executor immediately calls `git status --porcelain=v2 -z` to inspect the Git index.
3. It parses all files currently in the index (staged changes).
4. **Verification Invariant**: The set of staged paths in the index must be **exactly equal** to the set of assigned paths in the queue item. If any extra file is found staged (or any assigned file is missing), the executor runs a soft reset to unstage the files and aborts the execution.

---

## 4. Pre-Staged Protected States

If you are actively working in a repository, you might have changes staged in your index (`git add`ed but not committed) when a scheduled item becomes due.
* **Invariant**: If GitOutbox detects any pre-staged files in the repository during preflight checks, it immediately aborts and pauses.
* **Why**: This prevents GitOutbox from accidentally absorbing your active, staged changes into the scheduled background commit.

---

## 5. Branch and Merge Preflights

* **Branch Gate**: GitOutbox checks your active branch using `git symbolic-ref`. If your workspace is on `feature-branch` but the scheduled item targets `main`, execution halts and pauses. GitOutbox will **never** checkout branches in your workspace.
* **Unsafe Operation Gate**: GitOutbox checks for files indicating active conflicts or state manipulations. If any of the following files are found in the `.git/` folder, execution is blocked:
  - `MERGE_HEAD` (Merge in progress)
  - `REBASE_HEAD` or `rebase-apply/` (Rebase in progress)
  - `CHERRY_PICK_HEAD` (Cherry-pick in progress)
  - `REVERT_HEAD` (Revert in progress)
  - `BISECT_LOG` (Bisect in progress)
