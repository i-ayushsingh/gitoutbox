//! Integration tests against real temporary Git repositories.
//! Covers the four change types plus spaces/Unicode paths (spec §7, testing skill).

use std::path::{Path, PathBuf};
use std::process::Command;

use gitoutbox_core::{
    get_current_branch, get_status, inspect_repository, is_operation_in_progress, ChangeType,
};

struct TempRepo {
    path: PathBuf,
}

impl TempRepo {
    fn new(tag: &str) -> Self {
        let base = std::env::temp_dir().join(format!(
            "gitoutbox-it-{}-{}-{}",
            tag,
            std::process::id(),
            nanos()
        ));
        std::fs::create_dir_all(&base).unwrap();
        git(&base, &["init", "-b", "main"]);
        git(&base, &["config", "user.name", "Test User"]);
        git(&base, &["config", "user.email", "test@example.com"]);
        // Disable hooks/gpg noise for deterministic tests.
        git(&base, &["config", "commit.gpgsign", "false"]);
        TempRepo { path: base }
    }

    fn write(&self, rel: &str, contents: &str) {
        let full = self.path.join(rel);
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(full, contents).unwrap();
    }

    fn commit_all(&self, msg: &str) {
        git(&self.path, &["add", "-A"]);
        git(&self.path, &["commit", "-m", msg]);
    }
}

impl Drop for TempRepo {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.path).ok();
    }
}

fn nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
}

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .expect("git available");
    assert!(
        status.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&status.stderr)
    );
}

fn find<'a>(changes: &'a [gitoutbox_core::Change], path: &str) -> &'a gitoutbox_core::Change {
    changes
        .iter()
        .find(|c| c.path == path)
        .unwrap_or_else(|| panic!("expected change for {path}, got {changes:?}"))
}

#[test]
fn detects_untracked_modified_deleted() {
    let repo = TempRepo::new("basic");
    repo.write("keep.txt", "one\n");
    repo.write("remove.txt", "bye\n");
    repo.commit_all("init");

    repo.write("keep.txt", "one\ntwo\n"); // modified
    repo.write("brand new.txt", "x\n"); // untracked, path with space
    std::fs::remove_file(repo.path.join("remove.txt")).unwrap(); // deleted

    let changes = get_status(&repo.path).unwrap();

    assert_eq!(find(&changes, "keep.txt").change_type, ChangeType::Modified);
    assert_eq!(find(&changes, "brand new.txt").change_type, ChangeType::Untracked);
    assert_eq!(find(&changes, "remove.txt").change_type, ChangeType::Deleted);
}

#[test]
fn detects_rename() {
    let repo = TempRepo::new("rename");
    repo.write("original.rs", "fn main() {}\n");
    repo.commit_all("init");

    git(&repo.path, &["mv", "original.rs", "renamed.rs"]);

    let changes = get_status(&repo.path).unwrap();
    let renamed = find(&changes, "renamed.rs");
    assert_eq!(renamed.change_type, ChangeType::Renamed);
    assert_eq!(renamed.original_path.as_deref(), Some("original.rs"));
    // The original path must not appear as its own spurious change.
    assert!(changes.iter().all(|c| c.path != "original.rs"));
}

#[test]
fn unstaged_manual_rename_is_not_falsely_merged() {
    // A rename done outside Git (e.g. File Explorer) leaves the working tree
    // with a Deleted tracked file and an Untracked new file. Git's native
    // status rename detection (`-M`) does NOT pair an untracked destination as
    // a rename without first staging intent (`git add -N`), which would mutate
    // the index and is forbidden during inspection (Git safety invariants).
    // The accurate, safe representation is therefore Deleted + Untracked. This
    // test pins that behavior so we never forge a rename during inspection.
    let repo = TempRepo::new("manual-rename");
    repo.write("original.rs", "fn main() {}\n");
    repo.commit_all("init");

    std::fs::rename(repo.path.join("original.rs"), repo.path.join("renamed.rs")).unwrap();

    let changes = get_status(&repo.path).unwrap();
    assert_eq!(find(&changes, "original.rs").change_type, ChangeType::Deleted);
    assert_eq!(find(&changes, "renamed.rs").change_type, ChangeType::Untracked);
    // Content-preserving unstaged moves are shown as two honest entries, not a
    // fabricated rename.
    assert!(changes.iter().all(|c| c.change_type != ChangeType::Renamed));
}

#[test]
fn staged_rename_via_add_is_detected() {
    // When the user stages the move (so both sides are known to Git), `-M`
    // reports a single Renamed entry rather than delete+add.
    let repo = TempRepo::new("staged-rename");
    repo.write("original.rs", "fn main() {}\n");
    repo.commit_all("init");

    std::fs::rename(repo.path.join("original.rs"), repo.path.join("renamed.rs")).unwrap();
    git(&repo.path, &["add", "original.rs", "renamed.rs"]);

    let changes = get_status(&repo.path).unwrap();
    let renamed = find(&changes, "renamed.rs");
    assert_eq!(renamed.change_type, ChangeType::Renamed);
    assert_eq!(renamed.original_path.as_deref(), Some("original.rs"));
}

#[test]
fn handles_unicode_paths() {
    let repo = TempRepo::new("unicode");
    repo.write("café/naïve-日本.txt", "hello\n");

    let changes = get_status(&repo.path).unwrap();
    let c = find(&changes, "café/naïve-日本.txt");
    assert_eq!(c.change_type, ChangeType::Untracked);
    assert_eq!(c.filename(), "naïve-日本.txt");
    assert_eq!(c.directory(), "café");
}

#[test]
fn inspect_reports_branch_and_no_operation() {
    let repo = TempRepo::new("inspect");
    repo.write("a.txt", "a\n");
    repo.commit_all("init");

    let info = inspect_repository(&repo.path).unwrap();
    assert_eq!(info.current_branch.as_deref(), Some("main"));
    assert_eq!(info.operation_in_progress, None);
    assert_eq!(get_current_branch(&repo.path).unwrap(), "main");
    assert_eq!(is_operation_in_progress(&repo.path).unwrap(), None);
}

#[test]
fn detects_in_progress_merge() {
    let repo = TempRepo::new("merge");
    repo.write("base.txt", "base\n");
    repo.commit_all("base");

    // Create divergent branches that conflict on the same file.
    git(&repo.path, &["checkout", "-b", "feature"]);
    repo.write("base.txt", "feature change\n");
    repo.commit_all("feature");

    git(&repo.path, &["checkout", "main"]);
    repo.write("base.txt", "main change\n");
    repo.commit_all("main");

    // Attempt a merge that conflicts; leaves MERGE_HEAD in place.
    let _ = Command::new("git")
        .current_dir(&repo.path)
        .args(["merge", "feature"])
        .output()
        .unwrap();

    let op = is_operation_in_progress(&repo.path).unwrap();
    assert_eq!(op.as_deref(), Some("merge"), "expected merge in progress");
}

#[test]
fn git_mv_rename_in_fresh_repo() {
    // Issue 5: verify `git mv` rename detection in a fresh temporary repo.
    // "bad source" in prior manual QA is likely a stale test-repo state problem.
    let repo = TempRepo::new("git-mv-fresh");
    repo.write("README.md", "# Hello\n");
    repo.commit_all("init");

    // Verify source exists before rename.
    assert!(repo.path.join("README.md").exists());
    let before = get_status(&repo.path).unwrap();
    assert!(before.is_empty(), "clean working tree before mv");

    git(&repo.path, &["mv", "README.md", "padhle.md"]);

    let changes = get_status(&repo.path).unwrap();
    let renamed = find(&changes, "padhle.md");
    assert_eq!(renamed.change_type, ChangeType::Renamed);
    assert_eq!(renamed.original_path.as_deref(), Some("README.md"));
    assert!(changes.iter().all(|c| c.path != "README.md"));
}
