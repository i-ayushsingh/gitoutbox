//! Safe Git execution engine (spec §12-16, §32).
//!
//! Handles staging assigned paths, committing, pushing, fingerprint
//! validation, pre-staged path detection, and path safety.
//! All Git commands use argument arrays — never shell concatenation.

use std::path::{Path, PathBuf};

use crate::git::{self, GitError};

// ── Path Safety ──────────────────────────────────────────────────────────

/// Validate that a path is safe for GitOutbox to stage.
/// For existing/untracked files: canonicalize and verify inside repo.
/// For deleted files: lexical validation only (file doesn't exist on disk).
pub fn validate_assigned_path(repo_root: &Path, path: &str) -> Result<PathBuf, String> {
    if path.is_empty() {
        return Err("Empty path".into());
    }
    // Reject absolute paths.
    if Path::new(path).is_absolute() {
        return Err(format!("Absolute path rejected: {path}"));
    }
    // Reject Unix-style absolute paths (cross-platform safety).
    if path.starts_with('/') {
        return Err(format!("Absolute path rejected: {path}"));
    }
    // Reject drive-qualified Windows paths (C:\, D:/).
    if path.len() >= 2 && path.as_bytes()[1] == b':' {
        return Err(format!("Drive-qualified path rejected: {path}"));
    }
    // Reject UNC paths (\\server\share).
    if path.starts_with("//") || path.starts_with("\\\\") {
        return Err(format!("UNC path rejected: {path}"));
    }
    // Reject parent traversal at the lexical level.
    for component in Path::new(path).components() {
        if let std::path::Component::ParentDir = component {
            return Err(format!("Parent traversal rejected: {path}"));
        }
    }

    let resolved = repo_root.join(path);

    // If the file exists on disk, canonicalize and verify it's inside repo.
    if resolved.exists() {
        let canonical = resolved
            .canonicalize()
            .map_err(|e| format!("Cannot resolve path '{}': {}", path, e))?;
        let repo_canonical = repo_root
            .canonicalize()
            .map_err(|e| format!("Cannot resolve repo root: {}", e))?;
        if !canonical.starts_with(&repo_canonical) {
            return Err(format!("Path escapes repository: {path}"));
        }
    } else {
        // Deleted file: lexical validation only.
        if let Some(parent) = resolved.parent() {
            if parent.exists() {
                let parent_canonical = parent
                    .canonicalize()
                    .map_err(|e| format!("Cannot resolve parent of '{}': {}", path, e))?;
                let repo_canonical = repo_root
                    .canonicalize()
                    .map_err(|e| format!("Cannot resolve repo root: {}", e))?;
                if !parent_canonical.starts_with(&repo_canonical) {
                    return Err(format!("Path escapes repository: {path}"));
                }
            }
        }
    }

    Ok(resolved)
}

/// Validate all assigned paths for an item.
pub fn validate_all_paths(repo_root: &Path, paths: &[String]) -> Result<(), String> {
    for p in paths {
        validate_assigned_path(repo_root, p)?;
    }
    Ok(())
}

// ── Fingerprint ──────────────────────────────────────────────────────────

/// Structured fingerprint for a queued file.
/// Encodes enough information to detect changes between scheduling and execution.
#[derive(Debug, Clone, PartialEq)]
pub enum Fingerprint {
    /// File exists on disk with this content hash.
    Modified { hash: String },
    /// File is untracked (new, not in Git index) with this content hash.
    Untracked { hash: String },
    /// File was deleted (doesn't exist on disk).
    Deleted,
    /// File was renamed: original_path → current_path with content hash.
    Renamed { original_path: String, hash: String },
}

impl Fingerprint {
    /// Serialize to a versioned string for SQLite storage.
    pub fn to_stored(&self) -> String {
        match self {
            Fingerprint::Modified { hash } => format!("v1:modified:{hash}"),
            Fingerprint::Untracked { hash } => format!("v1:untracked:{hash}"),
            Fingerprint::Deleted => "v1:deleted:".to_string(),
            Fingerprint::Renamed { original_path, hash } => {
                // Encode original_path with URL-encoding for safety.
                let encoded = url_encode(original_path);
                format!("v1:renamed:{encoded}:{hash}")
            }
        }
    }

    /// Deserialize from a stored string.
    pub fn from_stored(s: &str) -> Option<Self> {
        let s = s.strip_prefix("v1:")?;
        let parts: Vec<&str> = s.splitn(3, ':').collect();
        match parts[0] {
            "modified" => {
                let hash = parts.get(1)?.to_string();
                Some(Fingerprint::Modified { hash })
            }
            "untracked" => {
                let hash = parts.get(1)?.to_string();
                Some(Fingerprint::Untracked { hash })
            }
            "deleted" => Some(Fingerprint::Deleted),
            "renamed" => {
                let encoded = parts.get(1)?;
                let hash = parts.get(2)?;
                let original_path = url_decode(encoded);
                Some(Fingerprint::Renamed { original_path, hash: hash.to_string() })
            }
            _ => None,
        }
    }
}

fn url_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{:02X}", b),
        })
        .collect()
}

fn url_decode(s: &str) -> String {
    let mut result = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(
                std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""),
                16,
            ) {
                result.push(byte);
                i += 3;
                continue;
            }
        }
        result.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(result).unwrap_or_default()
}

/// Compute a fingerprint for a file at the given path.
/// change_type determines the fingerprint kind.
/// For deleted files: if the file still exists on disk, it's been restored → Modified.
pub fn compute_fingerprint(
    repo_root: &Path,
    path: &str,
    change_type: &str,
    original_path: &Option<String>,
) -> Option<Fingerprint> {
    let full_path = repo_root.join(path);
    match change_type {
        "modified" => {
            if full_path.exists() {
                let hash = git_hash_object(repo_root, path)?;
                Some(Fingerprint::Modified { hash })
            } else {
                Some(Fingerprint::Deleted)
            }
        }
        "untracked" => {
            if full_path.exists() {
                let hash = git_hash_object(repo_root, path)?;
                Some(Fingerprint::Untracked { hash })
            } else {
                Some(Fingerprint::Deleted)
            }
        }
        "deleted" => {
            if full_path.exists() {
                // File was deleted at scheduling time but has been restored.
                // Capture as Modified to detect the change.
                let hash = git_hash_object(repo_root, path)?;
                Some(Fingerprint::Modified { hash })
            } else {
                Some(Fingerprint::Deleted)
            }
        }
        "renamed" => {
            if full_path.exists() {
                let hash = git_hash_object(repo_root, path)?;
                let orig = original_path.clone().unwrap_or_default();
                Some(Fingerprint::Renamed { original_path: orig, hash })
            } else {
                Some(Fingerprint::Deleted)
            }
        }
        _ => {
            if full_path.exists() {
                let hash = git_hash_object(repo_root, path)?;
                Some(Fingerprint::Modified { hash })
            } else {
                Some(Fingerprint::Deleted)
            }
        }
    }
}

/// Use `git hash-object` for content hash.
fn git_hash_object(repo_root: &Path, path: &str) -> Option<String> {
    let out = git::run_git_output(repo_root, &["hash-object", path]).ok()?;
    let hash = out.trim();
    if hash.is_empty() { None } else { Some(hash.to_string()) }
}

/// Compute fingerprints for all assigned files.
pub fn compute_fingerprints(
    repo_root: &Path,
    paths: &[String],
    change_types: &[String],
    original_paths: &[Option<String>],
) -> Vec<Option<Fingerprint>> {
    paths
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let ct = change_types.get(i).map(|s| s.as_str()).unwrap_or("modified");
            let op = original_paths.get(i).and_then(|o| o.clone());
            compute_fingerprint(repo_root, p, ct, &op)
        })
        .collect()
}

/// Validate that current fingerprints match expected fingerprints.
/// Returns Ok(()) if all match, Err with the mismatched path if not.
/// Returns Err with MISSING_EXPECTED_FINGERPRINT if expected is None.
pub fn validate_fingerprints(
    repo_root: &Path,
    files: &[crate::git::FileForFingerprint],
    expected: &[Option<String>],
) -> Result<(), String> {
    for (i, file) in files.iter().enumerate() {
        let expected_stored = match expected.get(i) {
            Some(Some(s)) => s.as_str(),
            Some(None) | None => {
                return Err(format!(
                    "MISSING_EXPECTED_FINGERPRINT: No expected fingerprint for '{}'. \
                     Return the item to Draft and reschedule to capture fingerprints.",
                    file.path
                ));
            }
        };
        let expected_fp = Fingerprint::from_stored(expected_stored)
            .ok_or_else(|| format!("Invalid stored fingerprint for '{}': {}", file.path, expected_stored))?;
        let current_fp = compute_fingerprint(
            repo_root,
            &file.path,
            &file.change_type,
            &file.original_path,
        );
        match current_fp {
            Some(cur) => {
                if expected_fp != cur {
                    return Err(format!(
                        "Fingerprint mismatch for '{}': expected {}, got {}",
                        file.path,
                        expected_stored,
                        cur.to_stored()
                    ));
                }
            }
            None => {
                return Err(format!(
                    "Fingerprint mismatch for '{}': file unreadable",
                    file.path
                ));
            }
        }
    }
    Ok(())
}

/// Helper to get the Git index object hash for a given staged path.
fn get_staged_hash(repo_root: &Path, path: &str) -> Option<String> {
    let out = git::run_git_output(repo_root, &["ls-files", "--stage", path]).ok()?;
    let line = out.trim();
    if line.is_empty() {
        return None;
    }
    // Format is: <mode> <hash> <stage>\t<path>
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() >= 2 {
        Some(parts[1].to_string())
    } else {
        None
    }
}

/// Verify that index (staged) file contents match expected fingerprints.
/// Returns Ok(()) if all match, Err with the mismatched path details if not.
pub fn verify_staged_fingerprints(
    repo_root: &Path,
    files: &[crate::git::FileForFingerprint],
    expected: &[Option<String>],
) -> Result<(), String> {
    for (i, file) in files.iter().enumerate() {
        let expected_stored = match expected.get(i) {
            Some(Some(s)) => s.as_str(),
            Some(None) | None => continue,
        };
        let expected_fp = Fingerprint::from_stored(expected_stored)
            .ok_or_else(|| format!("Invalid stored fingerprint: {}", expected_stored))?;

        let current_fp = match &expected_fp {
            Fingerprint::Deleted => {
                let exists = repo_root.join(&file.path).exists();
                if exists {
                    return Err(format!("Staged fingerprint mismatch: '{}' exists on disk but was expected to be deleted", file.path));
                }
                if get_staged_hash(repo_root, &file.path).is_some() {
                    return Err(format!("Staged fingerprint mismatch: '{}' is in the index but was expected to be deleted", file.path));
                }
                Fingerprint::Deleted
            }
            Fingerprint::Renamed { original_path, .. } => {
                let hash = get_staged_hash(repo_root, &file.path)
                    .ok_or_else(|| format!("Staged fingerprint mismatch: renamed file '{}' not found in staging area", file.path))?;
                Fingerprint::Renamed {
                    original_path: original_path.clone(),
                    hash,
                }
            }
            Fingerprint::Modified { .. } | Fingerprint::Untracked { .. } => {
                let hash = get_staged_hash(repo_root, &file.path)
                    .ok_or_else(|| format!("Staged fingerprint mismatch: file '{}' not found in staging area", file.path))?;
                Fingerprint::Modified { hash }
            }
        };

        if expected_fp != current_fp {
            return Err(format!(
                "Fingerprint mismatch for '{}' after staging: expected {}, got {}",
                file.path,
                expected_stored,
                current_fp.to_stored()
            ));
        }
    }
    Ok(())
}

/// Reset (unstage) a list of paths using `git reset HEAD -- <paths>`.
pub fn unstage_paths(repo_root: &Path, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut args: Vec<&str> = vec!["reset", "HEAD", "--"];
    for p in paths {
        args.push(p.as_str());
    }
    // We swallow potential error codes if git reset fails during error recovery,
    // but try to report it.
    let mut cmd = std::process::Command::new("git");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd.current_dir(repo_root).args(&args).output().map_err(|e| format!("Failed to run git reset: {e}"))?;
    Ok(())
}

// ── Pre-staged path detection ────────────────────────────────────────────

/// Get currently staged paths from the Git index.
pub fn get_staged_paths(repo_root: &Path) -> Result<Vec<String>, GitError> {
    let out = git::run_git_checked(repo_root, &["diff", "--cached", "--name-only", "-z"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let paths: Vec<String> = stdout
        .split('\0')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();
    Ok(paths)
}

/// Check for unexpected pre-staged paths.
/// Returns Ok(()) if no unexpected staged paths, Err with the list if found.
pub fn check_pre_staged(repo_root: &Path, assigned_paths: &[String]) -> Result<(), Vec<String>> {
    let staged = get_staged_paths(repo_root).unwrap_or_default();
    if staged.is_empty() {
        return Ok(());
    }
    let assigned_set: std::collections::HashSet<&String> = assigned_paths.iter().collect();
    let unexpected: Vec<String> = staged
        .iter()
        .filter(|p| !assigned_set.contains(p))
        .cloned()
        .collect();
    if unexpected.is_empty() {
        Ok(())
    } else {
        Err(unexpected)
    }
}

/// Fail-closed variant used by production orchestration. An inability to read
/// the index is itself a safety failure and must never be treated as clean.
pub fn check_pre_staged_strict(repo_root: &Path, assigned_paths: &[String]) -> Result<(), String> {
    let staged = get_staged_paths(repo_root)
        .map_err(|e| format!("Cannot inspect pre-staged paths: {e}"))?;
    let assigned_set: std::collections::HashSet<&str> = assigned_paths.iter().map(String::as_str).collect();
    let unexpected: Vec<String> = staged
        .into_iter()
        .filter(|path| !assigned_set.contains(path.as_str()))
        .collect();
    if unexpected.is_empty() {
        Ok(())
    } else {
        Err(format!("Unexpected pre-staged paths: {}", unexpected.join(", ")))
    }
}

// ── Staging ──────────────────────────────────────────────────────────────

/// Stage ONLY the assigned paths. Uses `git add -- <paths>`.
/// Never uses `git add .` or `git add -A`.
pub fn stage_assigned_paths(repo_root: &Path, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Err("No paths to stage".into());
    }
    let mut args: Vec<&str> = vec!["add", "--"];
    for p in paths {
        args.push(p.as_str());
    }
    git::run_git_checked(repo_root, &args)
        .map_err(|e| format!("Failed to stage paths: {e}"))?;
    Ok(())
}

/// Verify that staged paths exactly match expected assigned paths.
pub fn verify_staged_paths(
    repo_root: &Path,
    expected_paths: &[String],
) -> Result<(), String> {
    let staged = get_staged_paths(repo_root)
        .map_err(|e| format!("Cannot read staged paths: {e}"))?;
    let expected_set: std::collections::HashSet<&String> = expected_paths.iter().collect();
    let staged_set: std::collections::HashSet<&String> = staged.iter().collect();

    let missing: Vec<&String> = expected_set.difference(&staged_set).cloned().collect();
    let extra: Vec<&String> = staged_set.difference(&expected_set).cloned().collect();

    if missing.is_empty() && extra.is_empty() {
        return Ok(());
    }
    let mut msg = String::from("Staged path verification failed:");
    if !missing.is_empty() {
        msg.push_str(&format!(" missing={:?}", missing));
    }
    if !extra.is_empty() {
        msg.push_str(&format!(" unexpected={:?}", extra));
    }
    Err(msg)
}

// ── Commit ───────────────────────────────────────────────────────────────

/// Create a Git commit with the given message. Returns the commit hash via rev-parse HEAD.
pub fn create_commit(repo_root: &Path, message: &str) -> Result<String, String> {
    git::run_git_checked(repo_root, &["commit", "-m", message])
        .map_err(|e| format!("Commit failed: {e}"))?;
    // Use rev-parse HEAD for reliable hash capture.
    get_head_hash(repo_root).map_err(|e| format!("Cannot read commit hash: {e}"))
}

// ── Push ─────────────────────────────────────────────────────────────────

/// Check if the current branch has a valid upstream configured.
pub fn has_upstream(repo_root: &Path) -> bool {
    git::run_git_checked(repo_root, &["rev-parse", "--abbrev-ref", "@{upstream}"]).is_ok()
}

/// Push the current branch to its configured upstream.
/// Does NOT automatically set upstream. If no upstream is configured,
/// returns an error with NO_UPSTREAM reason.
pub fn push_current_branch(repo_root: &Path) -> Result<String, String> {
    if !has_upstream(repo_root) {
        return Err("NO_UPSTREAM: No upstream configured for current branch. \
                    Local commit was created but push cannot proceed. \
                    Configure upstream with: git push -u origin <branch>"
            .to_string());
    }
    let out = git::run_git_checked(repo_root, &["push"])
        .map_err(|e| format!("Push failed: {e}"))?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

// ── Commit hash persistence ──────────────────────────────────────────────

/// Get the HEAD commit hash via `git rev-parse HEAD`.
pub fn get_head_hash(repo_root: &Path) -> Result<String, GitError> {
    let out = git::run_git_checked(repo_root, &["rev-parse", "HEAD"])?;
    let hash = String::from_utf8_lossy(&out.stdout).trim().to_string();
    // Validate it looks like a hex hash (at least 7 chars).
    if hash.len() >= 7 && hash.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(hash)
    } else {
        Err(GitError::Io(format!("Invalid commit hash: {hash}")))
    }
}

/// Get the parent of HEAD (HEAD~1) via `git rev-parse HEAD~1`.
pub fn get_head_parent(repo_root: &Path) -> Result<String, GitError> {
    let out = git::run_git_checked(repo_root, &["rev-parse", "HEAD~1"])?;
    let hash = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if hash.len() >= 7 && hash.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(hash)
    } else {
        Err(GitError::Io(format!("Invalid parent hash: {hash}")))
    }
}

/// Get the commit message of HEAD via `git log -1 --format=%s`.
pub fn get_head_message(repo_root: &Path) -> Result<String, GitError> {
    let out = git::run_git_checked(repo_root, &["log", "-1", "--format=%s"])?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Get the complete HEAD commit message, preserving internal newlines.
pub fn get_head_message_full(repo_root: &Path) -> Result<String, GitError> {
    let out = git::run_git_checked(repo_root, &["log", "-1", "--format=%B"])?;
    Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_string())
}

/// Return the paths represented by HEAD's diff against its first parent.
/// Renames contribute both the original and destination path.
pub fn get_head_commit_paths(repo_root: &Path) -> Result<Vec<String>, GitError> {
    let out = git::run_git_checked(
        repo_root,
        &["diff-tree", "--no-commit-id", "--name-status", "-r", "-M", "-z", "HEAD"],
    )?;
    let fields: Vec<&[u8]> = out.stdout.split(|b| *b == 0).filter(|f| !f.is_empty()).collect();
    let mut paths = Vec::new();
    let mut i = 0;
    while i < fields.len() {
        let status = String::from_utf8_lossy(fields[i]);
        let kind = status.as_bytes().first().copied().unwrap_or(b'?');
        match kind {
            b'R' | b'C' => {
                if i + 2 >= fields.len() {
                    return Err(GitError::Io("Malformed commit path output".into()));
                }
                paths.push(String::from_utf8_lossy(fields[i + 1]).to_string());
                paths.push(String::from_utf8_lossy(fields[i + 2]).to_string());
                i += 3;
            }
            _ => {
                if i + 1 >= fields.len() {
                    return Err(GitError::Io("Malformed commit path output".into()));
                }
                paths.push(String::from_utf8_lossy(fields[i + 1]).to_string());
                i += 2;
            }
        }
    }
    paths.sort();
    Ok(paths)
}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn temp_repo(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "gitoutbox-exec-{}-{}-{}",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        git_cmd(&dir, &["init", "-b", "main"]);
        git_cmd(&dir, &["config", "user.name", "Tester"]);
        git_cmd(&dir, &["config", "user.email", "t@example.com"]);
        git_cmd(&dir, &["config", "commit.gpgsign", "false"]);
        std::fs::write(dir.join(".gitkeep"), "").unwrap();
        commit_all(&dir, "init");
        dir
    }

    fn git_cmd(dir: &Path, args: &[&str]) {
        let s = Command::new("git")
            .current_dir(dir)
            .args(args)
            .output()
            .expect("git available");
        assert!(s.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&s.stderr));
    }

    fn commit_all(dir: &Path, msg: &str) {
        git_cmd(dir, &["add", "-A"]);
        git_cmd(dir, &["commit", "-m", msg]);
    }

    // ── Path safety tests ──

    #[test]
    fn valid_relative_path() {
        let repo = temp_repo("path-ok");
        std::fs::write(repo.join("a.rs"), "fn a(){}\n").unwrap();
        commit_all(&repo, "init");
        assert!(validate_assigned_path(&repo, "a.rs").is_ok());
    }

    #[test]
    fn reject_empty_path() {
        let repo = temp_repo("path-empty");
        assert!(validate_assigned_path(&repo, "").is_err());
    }

    #[test]
    fn reject_absolute_path() {
        let repo = temp_repo("path-abs");
        assert!(validate_assigned_path(&repo, "/etc/passwd").is_err());
    }

    #[test]
    fn reject_parent_traversal() {
        let repo = temp_repo("path-dotdot");
        assert!(validate_assigned_path(&repo, "../outside.txt").is_err());
    }

    #[test]
    fn reject_deep_traversal() {
        let repo = temp_repo("path-deep");
        assert!(validate_assigned_path(&repo, "../../etc/passwd").is_err());
    }

    #[test]
    fn reject_drive_qualified() {
        let repo = temp_repo("path-drive");
        assert!(validate_assigned_path(&repo, "C:\\Windows\\system32").is_err());
    }

    #[test]
    fn spaces_in_path() {
        let repo = temp_repo("path-spaces");
        std::fs::write(repo.join("my file.rs"), "fn a(){}\n").unwrap();
        commit_all(&repo, "init");
        assert!(validate_assigned_path(&repo, "my file.rs").is_ok());
    }

    #[test]
    fn nested_path() {
        let repo = temp_repo("path-nested");
        std::fs::create_dir_all(repo.join("src/deep")).unwrap();
        std::fs::write(repo.join("src/deep/file.rs"), "fn a(){}\n").unwrap();
        commit_all(&repo, "init");
        assert!(validate_assigned_path(&repo, "src/deep/file.rs").is_ok());
    }

    #[test]
    fn deleted_file_passes_lexical_validation() {
        let repo = temp_repo("path-del");
        std::fs::write(repo.join("a.rs"), "fn a(){}\n").unwrap();
        commit_all(&repo, "init");
        std::fs::remove_file(repo.join("a.rs")).unwrap();
        // Deleted file should pass validation (lexical check).
        assert!(validate_assigned_path(&repo, "a.rs").is_ok());
    }

    #[test]
    fn deleted_file_nested_passes() {
        let repo = temp_repo("path-del-nested");
        std::fs::create_dir_all(repo.join("src")).unwrap();
        std::fs::write(repo.join("src/a.rs"), "fn a(){}\n").unwrap();
        commit_all(&repo, "init");
        std::fs::remove_file(repo.join("src/a.rs")).unwrap();
        assert!(validate_assigned_path(&repo, "src/a.rs").is_ok());
    }

    // ── Fingerprint tests ──

    #[test]
    fn fingerprint_structured_format() {
        let fp = Fingerprint::Modified { hash: "abc123".to_string() };
        assert_eq!(fp.to_stored(), "v1:modified:abc123");
        let back = Fingerprint::from_stored("v1:modified:abc123").unwrap();
        assert_eq!(fp, back);
    }

    #[test]
    fn fingerprint_untracked_format() {
        let fp = Fingerprint::Untracked { hash: "def456".to_string() };
        assert_eq!(fp.to_stored(), "v1:untracked:def456");
        assert_eq!(Fingerprint::from_stored(&fp.to_stored()).unwrap(), fp);
    }

    #[test]
    fn fingerprint_deleted_format() {
        let fp = Fingerprint::Deleted;
        assert_eq!(fp.to_stored(), "v1:deleted:");
        assert_eq!(Fingerprint::from_stored(&fp.to_stored()).unwrap(), fp);
    }

    #[test]
    fn fingerprint_renamed_format() {
        let fp = Fingerprint::Renamed {
            original_path: "old/path.txt".to_string(),
            hash: "abc123".to_string(),
        };
        let stored = fp.to_stored();
        assert!(stored.starts_with("v1:renamed:"));
        assert_eq!(Fingerprint::from_stored(&stored).unwrap(), fp);
    }

    #[test]
    fn fingerprint_modified_unchanged_passes() {
        let repo = temp_repo("fp-mod-ok");
        std::fs::write(repo.join("a.rs"), "fn a(){}\n").unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("a.rs"), "fn a() { 1 }\n").unwrap();
        let fp = compute_fingerprint(&repo, "a.rs", "modified", &None).unwrap();
        assert!(validate_fingerprints(
            &repo,
            &[crate::git::FileForFingerprint {
                path: "a.rs".into(),
                change_type: "modified".into(),
                original_path: None,
            }],
            &[Some(fp.to_stored())]
        ).is_ok());
    }

    #[test]
    fn fingerprint_modified_changed_pauses() {
        let repo = temp_repo("fp-mod-chg");
        std::fs::write(repo.join("a.rs"), "fn a(){}\n").unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("a.rs"), "fn a() { 1 }\n").unwrap();
        let fp = compute_fingerprint(&repo, "a.rs", "modified", &None).unwrap();
        std::fs::write(repo.join("a.rs"), "fn a() { 2 }\n").unwrap();
        assert!(validate_fingerprints(
            &repo,
            &[crate::git::FileForFingerprint {
                path: "a.rs".into(),
                change_type: "modified".into(),
                original_path: None,
            }],
            &[Some(fp.to_stored())]
        ).is_err());
    }

    #[test]
    fn fingerprint_untracked_unchanged_passes() {
        let repo = temp_repo("fp-untr-ok");
        std::fs::write(repo.join("new.rs"), "fn new(){}\n").unwrap();
        let fp = compute_fingerprint(&repo, "new.rs", "untracked", &None).unwrap();
        assert!(validate_fingerprints(
            &repo,
            &[crate::git::FileForFingerprint {
                path: "new.rs".into(),
                change_type: "untracked".into(),
                original_path: None,
            }],
            &[Some(fp.to_stored())]
        ).is_ok());
    }

    #[test]
    fn fingerprint_untracked_changed_pauses() {
        let repo = temp_repo("fp-untr-chg");
        std::fs::write(repo.join("new.rs"), "fn new(){}\n").unwrap();
        let fp = compute_fingerprint(&repo, "new.rs", "untracked", &None).unwrap();
        std::fs::write(repo.join("new.rs"), "fn new() { 1 }\n").unwrap();
        assert!(validate_fingerprints(
            &repo,
            &[crate::git::FileForFingerprint {
                path: "new.rs".into(),
                change_type: "untracked".into(),
                original_path: None,
            }],
            &[Some(fp.to_stored())]
        ).is_err());
    }

    #[test]
    fn fingerprint_deleted_unchanged_passes() {
        let repo = temp_repo("fp-del-ok");
        std::fs::write(repo.join("a.rs"), "fn a(){}\n").unwrap();
        commit_all(&repo, "init");
        std::fs::remove_file(repo.join("a.rs")).unwrap();
        let fp = compute_fingerprint(&repo, "a.rs", "deleted", &None).unwrap();
        assert!(validate_fingerprints(
            &repo,
            &[crate::git::FileForFingerprint {
                path: "a.rs".into(),
                change_type: "deleted".into(),
                original_path: None,
            }],
            &[Some(fp.to_stored())]
        ).is_ok());
    }

    #[test]
    fn fingerprint_deleted_restored_pauses() {
        let repo = temp_repo("fp-del-rst");
        std::fs::write(repo.join("a.rs"), "fn a(){}\n").unwrap();
        commit_all(&repo, "init");
        std::fs::remove_file(repo.join("a.rs")).unwrap();
        let fp = compute_fingerprint(&repo, "a.rs", "deleted", &None).unwrap();
        // Restore the file.
        std::fs::write(repo.join("a.rs"), "fn a() { restored }\n").unwrap();
        assert!(validate_fingerprints(
            &repo,
            &[crate::git::FileForFingerprint {
                path: "a.rs".into(),
                change_type: "deleted".into(),
                original_path: None,
            }],
            &[Some(fp.to_stored())]
        ).is_err());
    }

    #[test]
    fn fingerprint_missing_rejects_execution() {
        let repo = temp_repo("fp-miss");
        std::fs::write(repo.join("a.rs"), "fn a(){}\n").unwrap();
        commit_all(&repo, "init");
        // No expected fingerprint (None) must reject.
        assert!(validate_fingerprints(
            &repo,
            &[crate::git::FileForFingerprint {
                path: "a.rs".into(),
                change_type: "modified".into(),
                original_path: None,
            }],
            &[None]
        ).is_err());
        let err = validate_fingerprints(
            &repo,
            &[crate::git::FileForFingerprint {
                path: "a.rs".into(),
                change_type: "modified".into(),
                original_path: None,
            }],
            &[None]
        ).unwrap_err();
        assert!(err.contains("MISSING_EXPECTED_FINGERPRINT"));
    }

    #[test]
    fn fingerprint_persists_across_reopen() {
        let fp = Fingerprint::Modified { hash: "abc123def456".to_string() };
        let stored = fp.to_stored();
        // Simulate DB reopen by deserializing.
        let restored = Fingerprint::from_stored(&stored).unwrap();
        assert_eq!(fp, restored);
    }

    // ── Pre-staged path tests ──

    #[test]
    fn no_pre_staged_passes() {
        let repo = temp_repo("pre-none");
        assert!(check_pre_staged(&repo, &["a.rs".into()]).is_ok());
    }

    #[test]
    fn unexpected_pre_staged_detected() {
        let repo = temp_repo("pre-unexpected");
        std::fs::write(repo.join("a.rs"), "a\n").unwrap();
        std::fs::write(repo.join("b.rs"), "b\n").unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("a.rs"), "a2\n").unwrap();
        std::fs::write(repo.join("b.rs"), "b2\n").unwrap();
        git_cmd(&repo, &["add", "b.rs"]);
        assert!(check_pre_staged(&repo, &["a.rs".into()]).is_err());
    }

    #[test]
    fn assigned_overlap_ok() {
        let repo = temp_repo("pre-overlap");
        std::fs::write(repo.join("a.rs"), "a\n").unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("a.rs"), "a2\n").unwrap();
        git_cmd(&repo, &["add", "a.rs"]);
        assert!(check_pre_staged(&repo, &["a.rs".into()]).is_ok());
    }

    // ── Staging tests ──

    #[test]
    fn stage_one_modified_file() {
        let repo = temp_repo("stage-mod");
        std::fs::write(repo.join("a.rs"), "fn a(){}\n").unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("a.rs"), "fn a() { 1 }\n").unwrap();
        stage_assigned_paths(&repo, &["a.rs".into()]).unwrap();
        let staged = get_staged_paths(&repo).unwrap();
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0], "a.rs");
    }

    #[test]
    fn stage_one_untracked_file() {
        let repo = temp_repo("stage-untracked");
        std::fs::write(repo.join("new.rs"), "fn new(){}\n").unwrap();
        stage_assigned_paths(&repo, &["new.rs".into()]).unwrap();
        let staged = get_staged_paths(&repo).unwrap();
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0], "new.rs");
    }

    #[test]
    fn stage_deleted_file() {
        let repo = temp_repo("stage-del");
        std::fs::write(repo.join("a.rs"), "fn a(){}\n").unwrap();
        commit_all(&repo, "init");
        std::fs::remove_file(repo.join("a.rs")).unwrap();
        stage_assigned_paths(&repo, &["a.rs".into()]).unwrap();
        let staged = get_staged_paths(&repo).unwrap();
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0], "a.rs");
    }

    #[test]
    fn stage_multiple_files() {
        let repo = temp_repo("stage-multi");
        std::fs::write(repo.join("a.rs"), "a\n").unwrap();
        std::fs::write(repo.join("b.rs"), "b\n").unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("a.rs"), "a2\n").unwrap();
        std::fs::write(repo.join("b.rs"), "b2\n").unwrap();
        stage_assigned_paths(&repo, &["a.rs".into(), "b.rs".into()]).unwrap();
        let staged = get_staged_paths(&repo).unwrap();
        assert_eq!(staged.len(), 2);
    }

    #[test]
    fn unrelated_file_remains_unstaged() {
        let repo = temp_repo("stage-unrelated");
        std::fs::write(repo.join("a.rs"), "a\n").unwrap();
        std::fs::write(repo.join("b.rs"), "b\n").unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("a.rs"), "a2\n").unwrap();
        std::fs::write(repo.join("b.rs"), "b2\n").unwrap();
        stage_assigned_paths(&repo, &["a.rs".into()]).unwrap();
        let staged = get_staged_paths(&repo).unwrap();
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0], "a.rs");
        let status = crate::git::get_status(&repo).unwrap();
        assert!(status.iter().any(|c| c.path == "b.rs" && !c.staged));
    }

    // ── Commit tests ──

    #[test]
    fn commit_creates_one_commit() {
        let repo = temp_repo("commit-one");
        std::fs::write(repo.join("a.rs"), "a\n").unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("a.rs"), "a2\n").unwrap();
        stage_assigned_paths(&repo, &["a.rs".into()]).unwrap();
        let hash = create_commit(&repo, "test commit").unwrap();
        assert!(hash.len() >= 7);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn commit_hash_matches_head() {
        let repo = temp_repo("commit-hash");
        std::fs::write(repo.join("a.rs"), "a\n").unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("a.rs"), "a2\n").unwrap();
        stage_assigned_paths(&repo, &["a.rs".into()]).unwrap();
        let hash = create_commit(&repo, "test").unwrap();
        let head = get_head_hash(&repo).unwrap();
        assert_eq!(hash, head);
    }

    #[test]
    fn commit_preserves_message() {
        let repo = temp_repo("commit-msg");
        std::fs::write(repo.join("a.rs"), "a\n").unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("a.rs"), "a2\n").unwrap();
        stage_assigned_paths(&repo, &["a.rs".into()]).unwrap();
        let _hash = create_commit(&repo, "feat: add module\n\nDetailed description").unwrap();
        let out = std::process::Command::new("git")
            .current_dir(&repo)
            .args(["log", "-1", "--format=%s"])
            .output()
            .unwrap();
        let subject = String::from_utf8_lossy(&out.stdout).trim().to_string();
        assert_eq!(subject, "feat: add module");
    }

    // ── Push tests ──

    #[test]
    fn push_to_configured_upstream() {
        let bare = std::env::temp_dir().join(format!(
            "gitoutbox-push-ok-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&bare).unwrap();
        git_cmd(&bare, &["init", "--bare", "-b", "main"]);

        let repo = temp_repo("push-work");
        git_cmd(&repo, &["remote", "add", "origin", bare.to_str().unwrap()]);
        git_cmd(&repo, &["push", "--set-upstream", "origin", "main"]);

        std::fs::write(repo.join("a.rs"), "a\n").unwrap();
        commit_all(&repo, "add a");
        push_current_branch(&repo).unwrap();

        let out = std::process::Command::new("git")
            .current_dir(&bare)
            .args(["log", "--oneline"])
            .output()
            .unwrap();
        let log = String::from_utf8_lossy(&out.stdout);
        assert!(log.contains("add a"));
        std::fs::remove_dir_all(&bare).ok();
    }

    #[test]
    fn push_rejected_without_upstream() {
        let repo = temp_repo("push-no-up");
        // No remote configured.
        std::fs::write(repo.join("a.rs"), "a\n").unwrap();
        commit_all(&repo, "add a");
        let result = push_current_branch(&repo);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("NO_UPSTREAM"));
    }

    #[test]
    fn push_does_not_modify_git_config() {
        let repo = temp_repo("push-config");
        let config_before = std::fs::read_to_string(repo.join(".git/config")).unwrap();
        let result = push_current_branch(&repo);
        // Should fail (no upstream) without modifying config.
        assert!(result.is_err());
        let config_after = std::fs::read_to_string(repo.join(".git/config")).unwrap();
        assert_eq!(config_before, config_after);
    }

    // ── Misc ──

    #[test]
    fn no_checkout_or_stash() {
        let repo = temp_repo("no-checkout");
        let before = crate::git::get_current_branch(&repo).unwrap();
        std::fs::write(repo.join("a.rs"), "a\n").unwrap();
        stage_assigned_paths(&repo, &["a.rs".into()]).unwrap();
        create_commit(&repo, "test").unwrap();
        let after = crate::git::get_current_branch(&repo).unwrap();
        assert_eq!(before, after);
    }

    #[test]
    fn never_stage_all() {
        let repo = temp_repo("never-all");
        std::fs::write(repo.join("a.rs"), "a\n").unwrap();
        std::fs::write(repo.join("b.rs"), "b\n").unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("a.rs"), "a2\n").unwrap();
        std::fs::write(repo.join("b.rs"), "b2\n").unwrap();
        stage_assigned_paths(&repo, &["a.rs".into()]).unwrap();
        let staged = get_staged_paths(&repo).unwrap();
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0], "a.rs");
        assert!(!staged.contains(&"b.rs".to_string()));
    }

    #[test]
    fn verify_staged_paths_passes() {
        let repo = temp_repo("verify-ok");
        std::fs::write(repo.join("a.rs"), "a\n").unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("a.rs"), "a2\n").unwrap();
        stage_assigned_paths(&repo, &["a.rs".into()]).unwrap();
        assert!(verify_staged_paths(&repo, &["a.rs".into()]).is_ok());
    }

    #[test]
    fn verify_staged_paths_fails_on_extra() {
        let repo = temp_repo("verify-extra");
        std::fs::write(repo.join("a.rs"), "a\n").unwrap();
        std::fs::write(repo.join("b.rs"), "b\n").unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("a.rs"), "a2\n").unwrap();
        std::fs::write(repo.join("b.rs"), "b2\n").unwrap();
        stage_assigned_paths(&repo, &["a.rs".into(), "b.rs".into()]).unwrap();
        assert!(verify_staged_paths(&repo, &["a.rs".into()]).is_err());
    }
}
