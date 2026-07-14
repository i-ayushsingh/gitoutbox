import { useEffect, useMemo, useState } from "react";
import { X, AlertTriangle, Loader2, Settings } from "lucide-react";
import { type QueueItemFile, type Template } from "../lib/ipc";
import { expandTemplateSingle, usesSingleFileVariable } from "../lib/templates";
import { Button } from "./ui";

const LAST_TEMPLATE_KEY = "gitoutbox.lastTemplate";

export interface BatchDraftTarget {
  files: QueueItemFile[];
}

export function BatchDraftDialog({
  open,
  target,
  repoName,
  branch,
  templates,
  onClose,
  onConfirm,
  onNavigateToTemplates,
}: {
  open: boolean;
  target: BatchDraftTarget | null;
  repoName: string;
  branch: string;
  templates: Template[];
  onClose: () => void;
  onConfirm: (templateText: string) => Promise<void>;
  onNavigateToTemplates?: () => void;
}) {
  const [templateName, setTemplateName] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [useTemplate, setUseTemplate] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);

  const files = target?.files ?? [];

  useEffect(() => {
    if (!open) return;
    setCustomMessage("");
    setUseTemplate(true);
    setSaving(false);
    setSaveError(null);
    setShowPreview(true);

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

  // When templates load after dialog open, set default.
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

  // All hooks must be called before any early return (React Rules of Hooks).
  const selectedTemplate = templates.find((t) => t.name === templateName);
  const templateText = useTemplate ? (selectedTemplate?.template ?? "") : customMessage;
  const warnsSingleVar = useTemplate && files.length > 1 && usesSingleFileVariable(templateText);

  const ctx = { repo: repoName, branch };

  const previews = useMemo(() => {
    if (!templateText) return [];
    return files.map((f) => ({
      path: f.path,
      message: expandTemplateSingle(templateText, f.path, ctx),
    }));
  }, [templateText, files, repoName, branch]);

  if (!open || !target) return null;

  const canCreate = templateText.trim().length > 0 && files.length > 0 && !saving;

  const handleConfirm = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // Remember the selected template for next time.
      if (useTemplate && templateName) {
        localStorage.setItem(LAST_TEMPLATE_KEY, templateName);
      }
      await onConfirm(templateText.trim());
    } catch (e) {
      setSaveError(String(e));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex w-full max-w-xl max-h-[85vh] flex-col rounded-[var(--radius-dialog)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <span className="text-sm font-medium">
            Create {files.length} draft {files.length === 1 ? "commit" : "commits"}
          </span>
          <button
            onClick={onClose}
            className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          {/* Template selection */}
          <div>
            <div className="mb-1 flex items-center gap-3 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  checked={useTemplate}
                  onChange={() => setUseTemplate(true)}
                  className="accent-[var(--color-accent)]"
                />
                Template
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  checked={!useTemplate}
                  onChange={() => setUseTemplate(false)}
                  className="accent-[var(--color-accent)]"
                />
                Custom message
              </label>
            </div>

            {useTemplate ? (
              templates.length > 0 ? (
                <select
                  value={templateName}
                  onChange={(e) => {
                    setTemplateName(e.target.value);
                    localStorage.setItem(LAST_TEMPLATE_KEY, e.target.value);
                  }}
                  className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-xs outline-none focus:border-[var(--color-border-strong)]"
                >
                  {templates.map((t) => (
                    <option key={t.name} value={t.name}>{t.name}</option>
                  ))}
                </select>
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
              )
            ) : (
              <textarea
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                rows={2}
                placeholder="Commit message"
                className="w-full resize-none rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 font-[family-name:var(--font-mono)] text-xs outline-none focus:border-[var(--color-border-strong)]"
              />
            )}
          </div>

          {useTemplate && selectedTemplate && (
            <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5">
              <div className="text-[10px] uppercase tracking-wide text-[var(--color-faint)]">
                Template content
              </div>
              <div className="font-[family-name:var(--font-mono)] text-xs text-[var(--color-muted)]">
                {selectedTemplate.template}
              </div>
            </div>
          )}

          {warnsSingleVar && (
            <div className="flex items-center gap-2 text-xs text-[var(--color-warn)]">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              This template uses a single-file variable. Each file resolves independently.
            </div>
          )}

          {/* Preview */}
          {previews.length > 0 && (
            <div>
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="mb-1 text-[11px] uppercase tracking-wide text-[var(--color-faint)] hover:text-[var(--color-text)]"
              >
                Preview {showPreview ? "▾" : "▸"}
              </button>
              {showPreview && (
                <div className="max-h-48 overflow-y-auto rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg)]">
                  {previews.map((p) => (
                    <div key={p.path} className="flex items-start gap-2 border-b border-[var(--color-border)] px-2 py-1 last:border-b-0">
                      <span className="shrink-0 font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-faint)]">
                        {p.path}
                      </span>
                      <span className="text-[var(--color-border-strong)]">→</span>
                      <span className="min-w-0 flex-1 font-[family-name:var(--font-mono)] text-xs text-[var(--color-text)] break-all">
                        {p.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {saveError && (
            <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] px-3 py-2 text-xs text-[var(--color-danger)]">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{saveError}</span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-[var(--color-border)] px-4 py-3">
          <span className="text-xs text-[var(--color-muted)]">
            {files.length} draft {files.length === 1 ? "commit" : "commits"} will be created
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleConfirm} disabled={!canCreate}>
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                `Create ${files.length} draft${files.length === 1 ? "" : "s"}`
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
