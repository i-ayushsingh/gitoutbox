import { useEffect, useState } from "react";
import { X, AlertTriangle, Plus, Trash2 } from "lucide-react";
import {
  type Change,
  type QueueItem,
  type QueueItemFile,
  type Template,
} from "../lib/ipc";
import { expandTemplate, usesSingleFileVariable } from "../lib/templates";
import { Button } from "./ui";

export function EditDraftDialog({
  open,
  item,
  changes,
  assignedPaths,
  repoName,
  branch,
  templates,
  onClose,
  onSave,
}: {
  open: boolean;
  item: QueueItem | null;
  changes: Change[];
  assignedPaths: Set<string>;
  repoName: string;
  branch: string;
  templates: Template[];
  onClose: () => void;
  onSave: (commitMessage: string, targetBranch: string, files: QueueItemFile[]) => Promise<void>;
}) {
  const [commitMessage, setCommitMessage] = useState("");
  const [targetBranch, setTargetBranch] = useState("");
  const [files, setFiles] = useState<QueueItemFile[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showAddFiles, setShowAddFiles] = useState(false);

  useEffect(() => {
    if (!open || !item) return;
    setCommitMessage(item.commit_message);
    setTargetBranch(item.target_branch || branch);
    setFiles([...item.files]);
    setTemplateName("");
    setSaving(false);
    setSaveError(null);
    setShowAddFiles(false);
  }, [open, item, branch]);

  if (!open || !item) return null;

  const ctx = { repo: repoName, branch: targetBranch || branch };
  const preview = expandTemplate(commitMessage, files.map((f) => ({ path: f.path })), ctx);
  const warnsSingleVar = files.length > 1 && usesSingleFileVariable(commitMessage);

  // Available files: changes not already in this draft and not owned by another draft.
  const currentPaths = new Set(files.map((f) => f.path));
  const availableChanges = changes.filter(
    (c) => !currentPaths.has(c.path) && !assignedPaths.has(c.path)
  );

  const applyTemplate = (name: string) => {
    setTemplateName(name);
    const tpl = templates.find((t) => t.name === name);
    if (tpl) setCommitMessage(tpl.template);
  };

  const removeFile = (path: string) => {
    setFiles((prev) => prev.filter((f) => f.path !== path));
  };

  const addFile = (change: Change) => {
    setFiles((prev) => [
      ...prev,
      { path: change.path, original_path: change.original_path, change_type: change.change_type },
    ]);
    setShowAddFiles(false);
  };

  const canSave = commitMessage.trim().length > 0 && files.length > 0 && !saving;

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(commitMessage.trim(), targetBranch.trim() || branch, files);
    } catch (e) {
      setSaveError(String(e));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-[var(--radius-dialog)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <span className="text-sm font-medium">Edit draft</span>
          <button
            onClick={onClose}
            className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          {/* Template (optional) */}
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
              Apply template
            </span>
            <select
              value={templateName}
              onChange={(e) => applyTemplate(e.target.value)}
              className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-xs outline-none focus:border-[var(--color-border-strong)]"
            >
              <option value="">(keep current message)</option>
              {templates.map((t) => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </select>
          </label>

          {/* Commit message */}
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
              Commit message
            </span>
            <textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 font-[family-name:var(--font-mono)] text-xs outline-none focus:border-[var(--color-border-strong)]"
            />
          </label>

          {/* Target branch */}
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
              Target branch
            </span>
            <input
              value={targetBranch}
              onChange={(e) => setTargetBranch(e.target.value)}
              placeholder={branch}
              className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 font-[family-name:var(--font-mono)] text-xs outline-none focus:border-[var(--color-border-strong)]"
            />
          </label>

          {/* Preview */}
          <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-faint)]">
              Preview
            </div>
            <div className="font-[family-name:var(--font-mono)] text-xs text-[var(--color-text)]">
              {preview}
            </div>
          </div>

          {warnsSingleVar && (
            <div className="flex items-start gap-2 text-xs text-[var(--color-warn)]">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                This template uses single-file variables (like{" "}
                <code className="bg-[var(--color-surface-2)] px-1 py-0.5 rounded text-[10px]">{`{stem}`}</code>{" "}
                or{" "}
                <code className="bg-[var(--color-surface-2)] px-1 py-0.5 rounded text-[10px]">{`{filename}`}</code>
                ) but this draft has {files.length} files. These variables cannot resolve and are replaced with placeholders.
              </span>
            </div>
          )}

          {/* Assigned files */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                Assigned files ({files.length})
              </span>
              <button
                onClick={() => setShowAddFiles(!showAddFiles)}
                className="flex items-center gap-1 text-[11px] text-[var(--color-accent)] hover:underline"
              >
                <Plus className="h-3 w-3" /> Add file
              </button>
            </div>
            <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg)]">
              {files.map((f) => (
                <div key={f.path} className="flex items-center justify-between border-b border-[var(--color-border)] px-2 py-1 last:border-b-0">
                  <span className="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-xs text-[var(--color-text)]">
                    {f.path}
                  </span>
                  <span className="mx-2 text-[10px] text-[var(--color-faint)]">{f.change_type}</span>
                  <button
                    onClick={() => removeFile(f.path)}
                    className="shrink-0 rounded p-0.5 text-[var(--color-muted)] hover:text-[var(--color-danger)]"
                    title="Remove file"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {files.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-[var(--color-faint)]">
                  No files assigned. Add at least one file.
                </div>
              )}
            </div>
          </div>

          {/* Add file picker */}
          {showAddFiles && availableChanges.length > 0 && (
            <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg)]">
              <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--color-faint)]">
                Available files
              </div>
              <div className="max-h-32 overflow-y-auto">
                {availableChanges.map((c) => (
                  <button
                    key={c.path}
                    onClick={() => addFile(c)}
                    className="flex w-full items-center gap-2 border-t border-[var(--color-border)] px-2 py-1 text-left text-xs hover:bg-[var(--color-surface)]"
                  >
                    <span className="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[var(--color-text)]">
                      {c.path}
                    </span>
                    <span className="shrink-0 text-[10px] text-[var(--color-faint)]">{c.change_type}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {showAddFiles && availableChanges.length === 0 && (
            <div className="text-xs text-[var(--color-faint)]">
              No available files to add. All changes are either assigned or already in this draft.
            </div>
          )}

          {saveError && (
            <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] px-3 py-2 text-xs text-[var(--color-danger)]">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{saveError}</span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--color-border)] px-4 py-3">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={!canSave}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
