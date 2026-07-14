//! Commit message template expansion (spec §9).
//!
//! Pure string logic so it is unit-testable without a Tauri runtime. The
//! frontend invokes `expand_template` and renders the same result the
//! scheduler will persist.

/// Per-file context used to resolve filename-specific variables.
#[derive(Debug, Clone, Default)]
pub struct TemplateFile {
    pub path: String,
}

/// Variables resolved from the first file (filename/stem/extension/directory).
fn file_parts(path: &str) -> (String, String, String, String) {
    let p = std::path::Path::new(path);
    let filename = p
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let stem = p
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let extension = p
        .extension()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let directory = p
        .parent()
        .map(|s| {
            let s = s.to_string_lossy();
            if s == "." {
                String::new()
            } else {
                s.into_owned()
            }
        })
        .unwrap_or_default();
    (filename, stem, extension, directory)
}

/// Expand a template against a set of files. Variables:
/// `{filename}` `{stem}` `{extension}` `{directory}` `{path}` are taken from
/// the first file; `{file_count}` from the group size; `{repo}`/`{branch}`
/// from context.
pub fn expand_template(
    template: &str,
    files: &[TemplateFile],
    repo: &str,
    branch: &str,
) -> String {
    let is_multi = files.len() > 1;
    let first = files.first().map(|f| f.path.clone()).unwrap_or_default();
    let (filename, stem, extension, directory) = file_parts(&first);
    let count = files.len();
    let count_str = count.to_string();

    let final_filename = if is_multi { "[multiple files]".to_string() } else { filename };
    let final_stem = if is_multi { "[multiple stems]".to_string() } else { stem };
    let final_extension = if is_multi { "[multiple extensions]".to_string() } else { extension };
    let final_directory = if is_multi { "[multiple directories]".to_string() } else { directory };
    let final_path = if is_multi { "[multiple paths]".to_string() } else { first };

    template
        .replace("{filename}", &final_filename)
        .replace("{stem}", &final_stem)
        .replace("{extension}", &final_extension)
        .replace("{directory}", &final_directory)
        .replace("{path}", &final_path)
        .replace("{file_count}", &count_str)
        .replace("{repo}", repo)
        .replace("{branch}", branch)
}

/// Expand a template for a single file (used in batch one-draft-per-file).
pub fn expand_template_single(
    template: &str,
    file_path: &str,
    repo: &str,
    branch: &str,
) -> String {
    let files = vec![TemplateFile { path: file_path.to_string() }];
    expand_template(template, &files, repo, branch)
}

/// True when the template uses a variable that only makes sense for a single
/// file (filename/stem/extension). Used to warn on multi-file groups (spec §9).
pub fn uses_single_file_variable(template: &str) -> bool {
    template.contains("{filename}")
        || template.contains("{stem}")
        || template.contains("{extension}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(p: &str) -> TemplateFile {
        TemplateFile { path: p.to_string() }
    }

    #[test]
    fn expands_stem_and_directory() {
        let out = expand_template(
            "feat({directory}): add {stem}",
            &[f("src/app.rs")],
            "myrepo",
            "main",
        );
        assert_eq!(out, "feat(src): add app");
    }

    #[test]
    fn expands_extension_and_count() {
        let out = expand_template(
            "chore: {file_count} files in {branch}",
            &[f("a.ts"), f("b.ts")],
            "r",
            "dev",
        );
        assert_eq!(out, "chore: 2 files in dev");
    }

    #[test]
    fn unknown_variable_left_untouched() {
        let out = expand_template("keep {repo} {unknown}", &[f("x")], "r", "b");
        assert_eq!(out, "keep r {unknown}");
    }

    #[test]
    fn single_file_variable_detection() {
        assert!(uses_single_file_variable("fix: update {stem}"));
        assert!(!uses_single_file_variable("chore: {file_count} files"));
    }

    #[test]
    fn expands_path_variable() {
        let out = expand_template("add {path}", &[f("src/deep/file.rs")], "r", "main");
        assert_eq!(out, "add src/deep/file.rs");
    }

    #[test]
    fn expand_template_single_resolves_per_file() {
        let a = expand_template_single("feat({directory}): add {stem}", "maya.json", "repo", "main");
        let b = expand_template_single("feat({directory}): add {stem}", "houdini.json", "repo", "main");
        assert_eq!(a, "feat(): add maya");
        assert_eq!(b, "feat(): add houdini");
    }

    #[test]
    fn expand_template_single_with_directory() {
        let out = expand_template_single("feat({directory}): add {stem}", "shortcuts/maya.json", "repo", "main");
        assert_eq!(out, "feat(shortcuts): add maya");
    }

    #[test]
    fn stem_resolves_json() {
        let out = expand_template_single("feat: add {stem}", "maya.json", "r", "main");
        assert_eq!(out, "feat: add maya");
    }

    #[test]
    fn filename_includes_extension() {
        let out = expand_template_single("add {filename}", "maya.json", "r", "main");
        assert_eq!(out, "add maya.json");
    }

    #[test]
    fn multi_file_variables_placeholders() {
        let out = expand_template(
            "feat({directory}): add {stem} to {filename} ({extension} / {path})",
            &[f("src/a.ts"), f("src/b.ts")],
            "myrepo",
            "main",
        );
        assert_eq!(
            out,
            "feat([multiple directories]): add [multiple stems] to [multiple files] ([multiple extensions] / [multiple paths])"
        );
    }
}
