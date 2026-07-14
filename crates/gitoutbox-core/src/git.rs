//! Git service: thin, safe wrappers over the local Git CLI.
//!
//! Every command is built with an argument array via `std::process::Command`;
//! paths are passed as arguments, never concatenated into a shell string.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::change::{parse_status, Change};

#[derive(Debug)]
pub enum GitError {
    /// Git executable not found or failed to launch.
    NotInstalled,
    /// Path is not a directory / does not exist.
    NotADirectory(String),
    /// Directory is not inside a Git work tree.
    NotAWorkTree(String),
    /// Git ran but exited non-zero. stderr is sanitized (no URLs/secrets).
    CommandFailed { args: Vec<String>, code: Option<i32>, stderr: String },
    /// Process/IO error launching Git.
    Io(String),
}

impl std::fmt::Display for GitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GitError::NotInstalled => write!(f, "Git is not installed or not on PATH"),
            GitError::NotADirectory(p) => write!(f, "Not a directory: {p}"),
            GitError::NotAWorkTree(p) => write!(f, "Not a Git work tree: {p}"),
            GitError::CommandFailed { args, code, stderr } => write!(
                f,
                "git {} failed (code {:?}): {}",
                args.join(" "),
                code,
                stderr
            ),
            GitError::Io(e) => write!(f, "Failed to run git: {e}"),
        }
    }
}

impl std::error::Error for GitError {}

/// Raw captured output of a Git invocation.
pub struct GitOutput {
    pub stdout: Vec<u8>,
    pub stderr: String,
    pub code: Option<i32>,
    pub success: bool,
}

/// Run `git <args>` in `cwd` (if given), capturing stdout/stderr/exit code.
/// Uses an argument array — no shell, no string concatenation.
fn run_git(cwd: Option<&Path>, args: &[&str]) -> Result<GitOutput, GitError> {
    let mut cmd = Command::new("git");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd.args(args);
    let output = cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            GitError::NotInstalled
        } else {
            GitError::Io(e.to_string())
        }
    })?;
    Ok(GitOutput {
        stdout: output.stdout,
        stderr: sanitize(&String::from_utf8_lossy(&output.stderr)),
        code: output.status.code(),
        success: output.status.success(),
    })
}

/// Require success, else map to `CommandFailed`.
fn checked(cwd: Option<&Path>, args: &[&str]) -> Result<GitOutput, GitError> {
    let out = run_git(cwd, args)?;
    if out.success {
        Ok(out)
    } else {
        Err(GitError::CommandFailed {
            args: args.iter().map(|s| s.to_string()).collect(),
            code: out.code,
            stderr: out.stderr,
        })
    }
}

/// Strip anything that looks like `scheme://user:pass@host` credentials from a
/// string before it can reach a log or error surface (safety invariant §10).
pub fn sanitize(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for token in s.split_whitespace() {
        result.push_str(&sanitize_token(token));
        result.push(' ');
    }
    result.trim_end().to_string()
}

fn sanitize_token(token: &str) -> String {
    // Look for "://" then a userinfo "...@" before the next '/'.
    if let Some(scheme_end) = token.find("://") {
        let after = &token[scheme_end + 3..];
        if let Some(at) = after.find('@') {
            let host_part = &after[at + 1..];
            return format!("{}://<redacted>@{}", &token[..scheme_end], host_part);
        }
    }
    token.to_string()
}

/// True if the `git` executable is available.
pub fn check_git_installed() -> bool {
    run_git(None, &["--version"]).map(|o| o.success).unwrap_or(false)
}

/// `git --version` string (e.g. "git version 2.54.0").
pub fn git_version() -> Result<String, GitError> {
    let out = checked(None, &["--version"])?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Configured Git identity (spec §24 onboarding). Missing values are `None`;
/// GitOutbox never modifies identity without explicit user action.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitIdentity {
    pub name: Option<String>,
    pub email: Option<String>,
}

pub fn git_identity() -> Result<GitIdentity, GitError> {
    Ok(GitIdentity {
        name: config_value("user.name"),
        email: config_value("user.email"),
    })
}

fn config_value(key: &str) -> Option<String> {
    let out = run_git(None, &["config", "--get", key]).ok()?;
    if out.success {
        let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if v.is_empty() { None } else { Some(v) }
    } else {
        None
    }
}

/// Result of inspecting a candidate repository directory.
#[derive(Debug, Clone)]
pub struct RepoInspection {
    pub path: PathBuf,
    pub current_branch: Option<String>,
    pub operation_in_progress: Option<String>,
}

/// Validate `path` is a directory inside a Git work tree and gather basics.
pub fn inspect_repository(path: &Path) -> Result<RepoInspection, GitError> {
    if !path.is_dir() {
        return Err(GitError::NotADirectory(path.display().to_string()));
    }
    let out = run_git(Some(path), &["rev-parse", "--is-inside-work-tree"])?;
    let inside = out.success
        && String::from_utf8_lossy(&out.stdout).trim() == "true";
    if !inside {
        return Err(GitError::NotAWorkTree(path.display().to_string()));
    }
    Ok(RepoInspection {
        path: path.to_path_buf(),
        current_branch: get_current_branch(path).ok(),
        operation_in_progress: is_operation_in_progress(path)?,
    })
}

/// Run `git <args>` in `cwd`, capturing stdout as a UTF-8 string.
pub fn run_git_output(cwd: &Path, args: &[&str]) -> Result<String, GitError> {
    let out = checked(Some(cwd), args)?;
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Run `git <args>` in `cwd`, returning the full output or error.
pub fn run_git_checked(cwd: &Path, args: &[&str]) -> Result<GitOutput, GitError> {
    checked(Some(cwd), args)
}

/// File info needed for fingerprint computation.
pub struct FileForFingerprint {
    pub path: String,
    pub change_type: String,
    pub original_path: Option<String>,
}

/// Current branch name, or an error if detached/unavailable.
pub fn get_current_branch(path: &Path) -> Result<String, GitError> {
    let out = checked(Some(path), &["rev-parse", "--abbrev-ref", "HEAD"])?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Detect an in-progress unsafe Git operation (spec §13). Returns the op name
/// if one is active. GitOutbox must pause — never abort/resolve it.
pub fn is_operation_in_progress(path: &Path) -> Result<Option<String>, GitError> {
    let out = checked(Some(path), &["rev-parse", "--git-dir"])?;
    let git_dir_raw = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let git_dir = {
        let p = Path::new(&git_dir_raw);
        if p.is_absolute() { p.to_path_buf() } else { path.join(p) }
    };
    Ok(detect_operation(&git_dir))
}

/// Pure check against a git-dir layout (testable without a real repo).
pub fn detect_operation(git_dir: &Path) -> Option<String> {
    let checks: &[(&str, &str)] = &[
        ("rebase-merge", "rebase"),
        ("rebase-apply", "rebase"),
        ("MERGE_HEAD", "merge"),
        ("CHERRY_PICK_HEAD", "cherry-pick"),
        ("REVERT_HEAD", "revert"),
        ("BISECT_LOG", "bisect"),
    ];
    for (marker, name) in checks {
        if git_dir.join(marker).exists() {
            return Some((*name).to_string());
        }
    }
    None
}

/// Typed list of changes via `git status --porcelain=v2 -z`.
pub fn get_status(path: &Path) -> Result<Vec<Change>, GitError> {
    // `-uall` lists individual untracked files, not collapsed directories, so
    // GitOutbox can offer whole-file selection (spec §7).
    // `-M` turns on Git-native rename detection for staged/recorded renames
    // (e.g. `git mv`, or a manually-moved-and-staged file): Git then reports a
    // single Renamed entry instead of delete+add. Note: a *purely unstaged*
    // manual move (deleted tracked file + untracked new file) is NOT paired as
    // a rename by `git status` without staging intent (`git add -N`), which
    // would mutate the index and is forbidden during inspection. Such moves are
    // represented accurately as Deleted + Untracked (see integration tests).
    let out = checked(Some(path), &["status", "--porcelain=v2", "-z", "-uall", "-M"])?;
    Ok(parse_status(&out.stdout))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_is_installed_in_env() {
        // This crate's whole reason for existing is to talk to the Git CLI.
        assert!(check_git_installed());
    }

    #[test]
    fn version_reports_git() {
        let v = git_version().unwrap();
        assert!(v.starts_with("git version"), "got: {v}");
    }

    #[test]
    fn sanitize_redacts_credentials_in_url() {
        let s = sanitize("fatal: could not read https://user:secret@github.com/x/y.git");
        assert!(!s.contains("secret"), "leaked: {s}");
        assert!(s.contains("github.com/x/y.git"));
        assert!(s.contains("<redacted>"));
    }

    #[test]
    fn sanitize_leaves_plain_text() {
        assert_eq!(sanitize("hello world"), "hello world");
    }

    #[test]
    fn detect_operation_finds_markers() {
        let dir = std::env::temp_dir().join(format!("gl-op-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(detect_operation(&dir), None);
        std::fs::write(dir.join("MERGE_HEAD"), b"x").unwrap();
        assert_eq!(detect_operation(&dir).as_deref(), Some("merge"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn inspect_rejects_non_worktree() {
        let dir = std::env::temp_dir();
        let r = inspect_repository(&dir);
        // temp dir is (almost certainly) not a git work tree
        assert!(matches!(r, Err(GitError::NotAWorkTree(_)) | Err(GitError::CommandFailed { .. })));
    }

    #[test]
    fn inspect_rejects_missing_dir() {
        let missing = std::env::temp_dir().join("gl-does-not-exist-xyz");
        assert!(matches!(inspect_repository(&missing), Err(GitError::NotADirectory(_))));
    }
}
