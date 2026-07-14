import { useEffect, useState } from "react";
import { X, AlertTriangle, Settings } from "lucide-react";
import {
  type QueueItem,
  type QueueItemFile,
  type Template,
} from "../lib/ipc";
import { expandTemplate, usesSingleFileVariable } from "../lib/templates";
import { Button } from "./ui";

const LAST_TEMPLATE_KEY = "gitoutbox.lastTemplate";

export interface ComposerTarget {
  files: QueueItemFile[];
  existing: QueueItem | null;
}

export function ComposerDialog({
  open,
  target,
  repoName,
  branch,
  templates,
  onClose,
  onSave,
  onNavigateToTemplates,
}: {
  open: boolean;
  target: ComposerTarget | null;
  repoName: string;
  branch: string;
  templates: Template[];
  onClose: () => void;
  onSave: (
    id: number | null,
    commitMessage: string,
    files: QueueItemFile[]
  ) => Promise<void> | void;
  onNavigateToTemplates?: () => void;
}) {
  const existing = target?.existing ?? null;
  const [message, setMessage] = useState("");
  const [templateName, setTemplateName] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = target?.existing;
    setMessage(t?.commit_message ?? "");
    setSaving(false);
    setSaveError(null);

    // Restore last-used template preference.
    const last = localStorage.getItem(LAST_TEMPLATE_KEY);
    if (last && templates.some((t) => t.name === last)) {
      setTemplateName(last);
    } else if (templates.length > 0) {
      setTemplateName(templates[0].name);
    } else {
      setTemplateName("");
    }
  }, [open, target]);

  // When templates load after the dialog is already open, set default.
  useEffect(() => {
    if (open && templates.length > 0 && !templateName) {
      const last = localStorage.getItem(LAST_TEMPLATE_KEY);
      if (last && templates.some((t) => t.name === last)) {
        setTemplateName(last);
      } else {
        setTemplateName(templates[0].name);
      }
    }
  }, [open, templates, templateName]);

  if (!open || !target) return null;

  const files = target.files;

  const applyTemplate = (name: string) => {
    setTemplateName(name);
    const tpl = templates.find((t) => t.name === name);
    if (tpl) {
      setMessage(tpl.template);
      localStorage.setItem(LAST_TEMPLATE_KEY, name);
    }
  };

  const preview = expandTemplate(
    message,
    files.map((f) => ({ path: f.path })),
    { repo: repoName, branch }
  );
  const warnsSingleVar =
    files.length > 1 && usesSingleFileVariable(message);

  const canSave = message.trim().length > 0 && files.length > 0 && !saving;

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(
        existing?.id ?? null,
        message.trim(),
        files
      );
      onClose();
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-[var(--radius-dialog)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <span className="text-sm font-medium">
            {existing ? "Edit draft commit" : "New draft commit"}
          </span>
          <button
            onClick={onClose}
            className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-3">
          <div className="text-xs text-[var(--color-muted)]">
            {files.length} {files.length === 1 ? "file" : "files"} in this draft
          </div>

          {/* Template selection */}
          {templates.length > 0 ? (
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                Template
              </span>
              <select
                value={templateName}
                onChange={(e) => applyTemplate(e.target.value)}
                className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-xs outline-none focus:border-[var(--color-border-strong)]"
              >
                {templates.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-muted)]">
              No templates yet.
              {onNavigateToTemplates && (
                <button
                  onClick={onNavigateToTemplates}
                  className="flex items-center gap-1 text-[var(--color-accent)] hover:underline"
                >
                  <Settings className="h-3 w-3" /> Create template
                </button>
              )}
            </div>
          )}

          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
              Commit message
            </span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 font-[family-name:var(--font-mono)] text-xs outline-none focus:border-[var(--color-border-strong)]"
            />
          </label>

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
          {saveError && (
            <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] px-3 py-2 text-xs text-[var(--color-danger)]">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>Failed to create draft: {saveError}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-4 py-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!canSave}>
            {existing ? "Save" : "Create draft"}
          </Button>
        </div>
      </div>
    </div>
  );
}
