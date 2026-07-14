import assert from "node:assert/strict";
import { switchRepo, type SelectionState } from "../src/lib/selection.ts";

// Issue 5: cross-repository selection isolation.
const a = new Set(["repoA/src/a.rs", "repoA/src/b.rs"]);

// Switching to a different repository clears the selection.
const afterSwitch: SelectionState = switchRepo({ repoId: 1, selected: a }, 2);
assert.equal(afterSwitch.repoId, 2);
assert.equal(afterSwitch.selected.size, 0);

// Selecting the same repository is a no-op (preserves in-repo toggles).
const noop: SelectionState = switchRepo({ repoId: 1, selected: a }, 1);
assert.equal(noop.selected.size, 2);
assert.ok(noop.selected.has("repoA/src/a.rs"));

console.log("selection.test.ts: all assertions passed");
