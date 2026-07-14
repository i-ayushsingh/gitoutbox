import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { type Template } from "../lib/ipc";
import { expandTemplateSingle } from "../lib/templates";
import { Button } from "./ui";

const TEMPLATE_VARIABLES = [
  { token: "{filename}", label: "filename" },
  { token: "{stem}", label: "stem" },
  { token: "{extension}", label: "extension" },
  { token: "{directory}", label: "directory" },
  { token: "{path}", label: "path" },
  { token: "{repo}", label: "repo" },
  { token: "{branch}", label: "branch" },
  { token: "{file_count}", label: "file_count" },
];

const SYNTHETIC_CTX = { repo: "my-project", branch: "main" };
const SYNTHETIC_PATH = "src/components/Button.tsx";

export function TemplateEditorDialog({
  open,
  existing,
  onClose,
  onSave,
}: {
  open: boolean;
  existing: Template | null;
  onClose: () => void;
  onSave: (name: string, template: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? "");
    setTemplate(existing?.template ?? "");
    setSaving(false);
    setError(null);
  }, [open, existing]);

  if (!open) return null;

  const isEdit = existing != null;
  const preview = template
    ? expandTemplateSingle(template, SYNTHETIC_PATH, SYNTHETIC_CTX)
    : "";

  const insertVariable = (token: string) => {
    const ta = textareaRef.current;
    if (ta) {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const before = template.slice(0, start);
      const after = template.slice(end);
      const next = before + token + after;
      setTemplate(next);
      // Restore cursor position after the inserted token.
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(start + token.length, start + token.length);
      });
    } else {
      setTemplate((prev) => prev + token);
    }
  };

  const canSave = name.trim().length > 0 && template.trim().length > 0 && !saving;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim(), template.trim());
      onClose();
    } catch (e) {
      setError(String(e));
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
          <span className="text-sm font-medium">
            {isEdit ? "Edit template" : "New template"}
          </span>
          <button
            onClick={onClose}
            className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          {/* Name */}
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
              Name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. feat: add {stem}"
              disabled={isEdit}
              className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-xs outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-border-strong)] disabled:opacity-50"
            />
            {isEdit && (
              <span className="mt-0.5 block text-[10px] text-[var(--color-faint)]">
                Template name cannot be changed after creation.
              </span>
            )}
          </label>

          {/* Variables */}
          <div>
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
              Variables
            </span>
            <div className="flex flex-wrap gap-1">
              {TEMPLATE_VARIABLES.map((v) => (
                <button
                  key={v.token}
                  onClick={() => insertVariable(v.token)}
                  className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
                  title={`Insert ${v.token}`}
                >
                  {v.token}
                </button>
              ))}
            </div>
          </div>

          {/* Template text */}
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
              Template
            </span>
            <textarea
              ref={textareaRef}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={3}
              placeholder="feat({directory}): add {stem}"
              className="w-full resize-none rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 font-[family-name:var(--font-mono)] text-xs outline-none focus:border-[var(--color-border-strong)]"
            />
          </label>

          {/* Live preview */}
          {template && (
            <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5">
              <div className="text-[10px] uppercase tracking-wide text-[var(--color-faint)]">
                Preview — {SYNTHETIC_PATH}
              </div>
              <div className="font-[family-name:var(--font-mono)] text-xs text-[var(--color-text)]">
                {preview}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-[var(--radius-control)] border border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] px-3 py-2 text-xs text-[var(--color-danger)]">
              {error}
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--color-border)] px-4 py-3">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={!canSave}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create template"}
          </Button>
        </div>
      </div>
    </div>
  );
}
