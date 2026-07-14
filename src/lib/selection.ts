// Selection state lives at the App level and must be isolated per active
// repository (QA Issue 5): switching repositories must never carry file
// selections from one repo into another repo's commit group.

export type SelectionState = {
  repoId: number | null;
  selected: Set<string>;
};

// Returns a new state with an empty selection whenever the active repository
// changes. Selecting a different repo clears; re-selecting the same repo is a
// no-op so in-repo toggles are preserved.
export function switchRepo(state: SelectionState, nextRepoId: number): SelectionState {
  if (state.repoId === nextRepoId) return state;
  return { repoId: nextRepoId, selected: new Set() };
}
