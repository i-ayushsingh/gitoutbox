//! GitOutbox core: pure-std Git inspection, change detection, and safety logic.
//!
//! No native dependencies so it can be unit/integration tested without the
//! Tauri/MSVC toolchain. The local Git CLI is the source of truth; every Git
//! command is built as an argument array (never shell string concatenation).

pub mod git;
pub mod change;
pub mod template;
pub mod scheduler;
pub mod executor;

pub use change::{Change, ChangeType, parse_status};
pub use git::{
    GitError, GitOutput, check_git_installed, git_version, git_identity,
    inspect_repository, get_status, get_current_branch, is_operation_in_progress,
    RepoInspection, GitIdentity,
};
