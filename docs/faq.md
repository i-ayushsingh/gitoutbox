# Frequently Asked Questions (FAQ)

---

## 1. General Questions

### Does GitOutbox store my Git credentials or private keys?
No. GitOutbox operates entirely locally and uses your system's native Git CLI. It does not collect, prompt for, or save SSH keys, passwords, or personal access tokens. It relies on your existing credential helpers (such as Git Credential Manager or loaded SSH agents).

### Can I use GitOutbox with private repositories?
Yes. Since GitOutbox uses your local Git configuration, any repository you can commit or push to via your terminal will work with GitOutbox.

### Where is the application database stored?
On Windows, the persistent SQLite database (`gitoutbox.db`) is located in the local AppData directory:
`C:\Users\<username>\AppData\Roaming\app.gitoutbox.desktop\gitoutbox.db`

---

## 2. Troubleshooting & Behavior

### What happens if a push fails because I am offline?
If a push operation fails (e.g. network disconnect), the commit remains saved in Git, and the item's status transitions to `PushPending`. GitOutbox will attempt to retry the push operation up to 3 times using an exponential backoff. If all retries fail, execution halts and the item transitions to `Paused` (`Needs Review`) so you can resolve it when back online.

### Why is my scheduled commit showing "Needs Review"?
This usually happens because of a **fingerprint mismatch**. If you edit files after they are scheduled, the file content hashes in your workspace will differ from the hashes saved when the schedule was created. To prevent committing unexpected changes, GitOutbox pauses execution. To resolve this, open the Draft and click "Update Fingerprint" or edit the contents.

### Can I stage files that have been renamed or moved?
Yes. GitOutbox supports Git's native rename detection (`-M`). If you stage a renamed file, it is correctly identified as `Renamed` (staged rename). Unstaged moves are shown as a pair of `Deleted` + `Untracked` actions, which is the safest representation.

### Does the application need to be open to execute commits?
GitOutbox needs to be running. If you close the main window, the application hides to the system tray and continues running background checks in the tray. If you exit the tray icon completely, background scheduling stops. Any missed commits will be resolved on the next launch according to your configured **Missed Schedule Policy**.

---

## 3. Developer Questions

### Why does the project have two template implementations?
Template parsing is implemented in Rust (`crates/gitoutbox-core/src/template.rs`) and duplicated in TypeScript (`src/lib/templates.ts`). This is intentional: the Rust engine runs headless in the background without a React context, while the TypeScript engine provides a live, character-by-character message preview in the dialog as the user types.

### How do I run integration tests on Windows?
Run `cargo test --all`. The integration suites will create real temporary repositories inside your OS temporary directory, verify staging and lock behaviors, and clean them up automatically on completion.
