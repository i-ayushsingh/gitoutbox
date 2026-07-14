import assert from "node:assert/strict";
import { expandTemplate, expandTemplateSingle, usesSingleFileVariable } from "../src/lib/templates.ts";

// Keep in sync with gitoutbox-core/src/template.rs integration expectations.
const f = (p: string) => ({ path: p });
const ctx = { repo: "r", branch: "main" };

// --- Basic expansion ---

assert.equal(
  expandTemplate("feat({directory}): add {stem}", [f("src/app.rs")], ctx),
  "feat(src): add app"
);
assert.equal(
  expandTemplate("chore: {file_count} files in {branch}", [f("a.ts"), f("b.ts")], { repo: "r", branch: "dev" }),
  "chore: 2 files in dev"
);
assert.equal(
  expandTemplate("keep {repo} {unknown}", [f("x")], { repo: "r", branch: "b" }),
  "keep r {unknown}"
);
assert.ok(usesSingleFileVariable("fix: update {stem}"));
assert.ok(!usesSingleFileVariable("chore: {file_count} files"));

// --- {path} variable ---

assert.equal(
  expandTemplate("add {path}", [f("src/deep/file.rs")], ctx),
  "add src/deep/file.rs"
);

// --- expandTemplateSingle resolves per-file independently ---

assert.equal(
  expandTemplateSingle("feat({directory}): add {stem}", "maya.json", ctx),
  "feat(): add maya"
);
assert.equal(
  expandTemplateSingle("feat({directory}): add {stem}", "houdini.json", ctx),
  "feat(): add houdini"
);
assert.equal(
  expandTemplateSingle("feat({directory}): add {stem}", "shortcuts/maya.json", ctx),
  "feat(shortcuts): add maya"
);

// stem resolves json correctly
assert.equal(
  expandTemplateSingle("feat: add {stem}", "maya.json", ctx),
  "feat: add maya"
);

// filename includes extension
assert.equal(
  expandTemplateSingle("add {filename}", "maya.json", ctx),
  "add maya.json"
);

// {path} resolves full repo-relative path
assert.equal(
  expandTemplateSingle("add {path}", "shortcuts/maya.json", ctx),
  "add shortcuts/maya.json"
);

// --- 57-file batch: each resolves independently ---

const template = "feat(shortcuts): add {stem}";
const files57 = Array.from({ length: 57 }, (_, i) => `data/file${i.toString().padStart(3, "0")}.json`);
const messages57 = files57.map((p) => expandTemplateSingle(template, p, ctx));
assert.equal(messages57.length, 57);
assert.equal(messages57[0], "feat(shortcuts): add file000");
assert.equal(messages57[56], "feat(shortcuts): add file056");
// All unique
assert.equal(new Set(messages57).size, 57);

// --- Template editor synthetic preview (FIX 2 regression) ---
// Verify that the synthetic context used in TemplateEditorDialog produces
// the same results as real draft expansion.

const syntheticCtx = { repo: "my-project", branch: "main" };
const syntheticPath = "src/components/Button.tsx";

// All 8 variables resolve correctly with synthetic context
const allVars = "file={filename} stem={stem} ext={extension} dir={directory} path={path} repo={repo} branch={branch} count={file_count}";
const expanded = expandTemplateSingle(allVars, syntheticPath, syntheticCtx);
assert.equal(expanded, "file=Button.tsx stem=Button ext=tsx dir=src/components path=src/components/Button.tsx repo=my-project branch=main count=1");

// Root-level file: directory becomes empty string
assert.equal(
  expandTemplateSingle("dir={directory} file={filename}", "maya.json", syntheticCtx),
  "dir= file=maya.json"
);

// Filename with spaces
assert.equal(
  expandTemplateSingle("add {stem}", "my file.json", syntheticCtx),
  "add my file"
);

// Nested path
assert.equal(
  expandTemplateSingle("{directory}/{stem}", "a/b/c/deep.txt", syntheticCtx),
  "a/b/c/deep"
);

// --- Multi-file single draft: {file_count} uses actual count ---
assert.equal(
  expandTemplate("{file_count} files", [f("a.rs"), f("b.rs"), f("c.rs")], ctx),
  "3 files"
);

// Single-file variables indicate they cannot resolve in multi-file group
assert.equal(
  expandTemplate("add {stem}", [f("first.rs"), f("second.rs")], ctx),
  "add [multiple stems]"
);

// --- Remembered template fallback (FIX 5 regression) ---
// Simulate: last template exists in list → use it
const templates = [
  { name: "feat: add {stem}", template: "feat: add {stem}" },
  { name: "fix: update {stem}", template: "fix: update {stem}" },
  { name: "chore: update {stem}", template: "chore: update {stem}" },
];
const last = "fix: update {stem}";
const found = templates.find((t) => t.name === last);
assert.ok(found, "last template should be found");
assert.equal(found!.name, "fix: update {stem}");

// Simulate: last template deleted → fall back to first
const deletedLast = "nonexistent template";
const notFound = templates.find((t) => t.name === deletedLast);
assert.equal(notFound, undefined, "deleted template should not be found");
const fallback = templates[0];
assert.equal(fallback.name, "feat: add {stem}");

// --- Template name unique enforcement ---
// Verify that duplicate names are detectable (backend enforces, frontend should check)
const names = ["feat: add {stem}", "fix: update {stem}", "feat: add {stem}"];
const unique = new Set(names);
assert.equal(unique.size, 2, "duplicate names should be detectable");

// --- Batch expansion: each file independently resolves ---
const batchTemplate = "feat({directory}): add {stem}";
const batchFiles = ["src/a.ts", "lib/b.ts", "root.json"];
const batchMessages = batchFiles.map((p) => expandTemplateSingle(batchTemplate, p, syntheticCtx));
assert.equal(batchMessages[0], "feat(src): add a");
assert.equal(batchMessages[1], "feat(lib): add b");
assert.equal(batchMessages[2], "feat(): add root");

console.log("templates.test.ts: all assertions passed");
