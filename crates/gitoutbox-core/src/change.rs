//! Change detection: parse `git status --porcelain=v2 -z` into typed changes.
//!
//! The `-z` (NUL-terminated) format is used deliberately so paths containing
//! spaces or Unicode are handled correctly without quoting/escaping.

/// The four change types GitOutbox surfaces (spec §7).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangeType {
    Untracked,
    Modified,
    Deleted,
    Renamed,
}

/// One change row (spec §7). Path is repo-relative, forward-slashed by Git.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Change {
    pub path: String,
    /// Original path for renames; `None` otherwise.
    pub original_path: Option<String>,
    pub change_type: ChangeType,
    /// True when the change is (also) present in the index/staging area.
    pub staged: bool,
}

impl Change {
    /// File name component (after the last `/`).
    pub fn filename(&self) -> &str {
        match self.path.rsplit_once('/') {
            Some((_, name)) => name,
            None => &self.path,
        }
    }

    /// Directory component (before the last `/`), or `""` at repo root.
    pub fn directory(&self) -> &str {
        match self.path.rsplit_once('/') {
            Some((dir, _)) => dir,
            None => "",
        }
    }
}

/// Parse the raw bytes of `git status --porcelain=v2 -z`.
///
/// Record kinds (each terminated by NUL):
/// - `1 <XY> ... <path>`            ordinary changed entry
/// - `2 <XY> ... <path>\0<orig>`    rename/copy (consumes an extra NUL field)
/// - `? <path>`                     untracked
/// - `! <path>`                     ignored (dropped)
/// - `# ...`                        header (dropped)
pub fn parse_status(raw: &[u8]) -> Vec<Change> {
    let mut fields = raw.split(|&b| b == 0).peekable();
    let mut out = Vec::new();

    while let Some(field) = fields.next() {
        if field.is_empty() {
            continue;
        }
        let s = String::from_utf8_lossy(field).into_owned();

        match s.as_bytes()[0] {
            b'#' => {} // branch/header line
            b'!' => {} // ignored
            b'?' => {
                // "? path"
                if let Some(path) = s.get(2..) {
                    out.push(Change {
                        path: path.to_string(),
                        original_path: None,
                        change_type: ChangeType::Untracked,
                        staged: false,
                    });
                }
            }
            b'1' => {
                if let Some(c) = parse_ordinary(&s) {
                    out.push(c);
                }
            }
            b'2' => {
                // Rename/copy: the original path is the NEXT NUL-separated field.
                let orig = fields.next().map(|f| String::from_utf8_lossy(f).into_owned());
                if let Some(c) = parse_rename(&s, orig) {
                    out.push(c);
                }
            }
            _ => {}
        }
    }
    out
}

/// Ordinary entry: `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>`
fn parse_ordinary(s: &str) -> Option<Change> {
    let mut parts = s.splitn(9, ' ');
    parts.next()?; // "1"
    let xy = parts.next()?;
    let path = parts.nth(6)?; // skip sub,mH,mI,mW,hH,hI -> 6 fields, then path
    let (staged, ct) = classify(xy);
    Some(Change {
        path: path.to_string(),
        original_path: None,
        change_type: ct,
        staged,
    })
}

/// Rename entry: `2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>`
/// with `<orig>` supplied from the following NUL field.
fn parse_rename(s: &str, orig: Option<String>) -> Option<Change> {
    let mut parts = s.splitn(10, ' ');
    parts.next()?; // "2"
    let xy = parts.next()?;
    let path = parts.nth(7)?; // skip sub,mH,mI,mW,hH,hI,<Xscore> -> 7 fields, then path
    let staged = xy.as_bytes().first().map_or(false, |&b| b != b'.');
    Some(Change {
        path: path.to_string(),
        original_path: orig,
        change_type: ChangeType::Renamed,
        staged,
    })
}

/// Classify an ordinary XY code. X=index (staged), Y=worktree.
fn classify(xy: &str) -> (bool, ChangeType) {
    let b = xy.as_bytes();
    let x = b.first().copied().unwrap_or(b'.');
    let y = b.get(1).copied().unwrap_or(b'.');
    let staged = x != b'.';
    let ct = if x == b'D' || y == b'D' {
        ChangeType::Deleted
    } else {
        // A (added-to-index) and M both surface as Modified content for Phase 1.
        ChangeType::Modified
    };
    (staged, ct)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn z(records: &[&str]) -> Vec<u8> {
        let mut v = Vec::new();
        for r in records {
            v.extend_from_slice(r.as_bytes());
            v.push(0);
        }
        v
    }

    #[test]
    fn untracked() {
        let raw = z(&["? new file.txt"]);
        let c = parse_status(&raw);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].change_type, ChangeType::Untracked);
        assert_eq!(c[0].path, "new file.txt"); // space preserved
        assert!(!c[0].staged);
    }

    #[test]
    fn modified_worktree() {
        let raw = z(&["1 .M N... 100644 100644 100644 abc abc src/app.rs"]);
        let c = parse_status(&raw);
        assert_eq!(c[0].change_type, ChangeType::Modified);
        assert_eq!(c[0].path, "src/app.rs");
        assert!(!c[0].staged);
    }

    #[test]
    fn modified_staged() {
        let raw = z(&["1 M. N... 100644 100644 100644 abc abc src/app.rs"]);
        let c = parse_status(&raw);
        assert_eq!(c[0].change_type, ChangeType::Modified);
        assert!(c[0].staged);
    }

    #[test]
    fn deleted() {
        let raw = z(&["1 .D N... 100644 100644 000000 abc abc gone.txt"]);
        let c = parse_status(&raw);
        assert_eq!(c[0].change_type, ChangeType::Deleted);
    }

    #[test]
    fn renamed_consumes_orig_field() {
        // type 2 followed by its original-path NUL field, then an untracked entry.
        let raw = z(&[
            "2 R. N... 100644 100644 100644 abc abc R100 new/name.rs",
            "old/name.rs",
            "? other.txt",
        ]);
        let c = parse_status(&raw);
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].change_type, ChangeType::Renamed);
        assert_eq!(c[0].path, "new/name.rs");
        assert_eq!(c[0].original_path.as_deref(), Some("old/name.rs"));
        // The orig field must NOT be misparsed as its own change.
        assert_eq!(c[1].change_type, ChangeType::Untracked);
        assert_eq!(c[1].path, "other.txt");
    }

    #[test]
    fn unicode_path() {
        let raw = z(&["? café/naïve-日本.txt"]);
        let c = parse_status(&raw);
        assert_eq!(c[0].path, "café/naïve-日本.txt");
        assert_eq!(c[0].filename(), "naïve-日本.txt");
        assert_eq!(c[0].directory(), "café");
    }

    #[test]
    fn headers_and_ignored_dropped() {
        let raw = z(&[
            "# branch.oid abc123",
            "# branch.head main",
            "! ignored.log",
            "1 .M N... 100644 100644 100644 a a keep.txt",
        ]);
        let c = parse_status(&raw);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].path, "keep.txt");
    }

    #[test]
    fn filename_and_directory_at_root() {
        let c = Change {
            path: "root.txt".into(),
            original_path: None,
            change_type: ChangeType::Untracked,
            staged: false,
        };
        assert_eq!(c.filename(), "root.txt");
        assert_eq!(c.directory(), "");
    }
}
