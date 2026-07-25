import { useState } from "react";
import { FileText, Plus, Copy, Pencil, Trash2, Code2, HelpCircle } from "lucide-react";
import type { Template } from "../lib/ipc";
import { EmptyState, Button } from "./ui";
import { TemplateEditorDialog } from "./TemplateEditorDialog";

const VARIABLES_HELP = [
  { var: "{filename}", desc: "Full filename with extension (e.g. index.tsx)" },
  { var: "{stem}", desc: "Filename without extension (e.g. index)" },
  { var: "{extension}", desc: "File extension (e.g. tsx)" },
  { var: "{directory}", desc: "Parent directory name (e.g. components)" },
  { var: "{path}", desc: "Relative file path (e.g. src/components/index.tsx)" },
  { var: "{repo}", desc: "Repository name (e.g. gitoutbox)" },
  { var: "{branch}", desc: "Target branch name (e.g. main)" },
  { var: "{file_count}", desc: "Number of files in commit (e.g. 3)" },
];

export function TemplatesView({
  templates,
  onRefresh,
  onCreate,
  onUpdate,
  onDuplicate,
  onDelete,
}: {
  templates: Template[];
  onRefresh: () => void;
  onCreate: (name: string, template: string) => Promise<void>;
  onUpdate: (name: string, template: string) => Promise<void>;
  onDuplicate: (sourceName: string) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const handleCreate = () => {
    setEditingTemplate(null);
    setEditorOpen(true);
  };

  const handleEdit = (tpl: Template) => {
    setEditingTemplate(tpl);
    setEditorOpen(true);
  };

  const handleSave = async (name: string, template: string) => {
    if (editingTemplate) {
      await onUpdate(name, template);
    } else {
      await onCreate(name, template);
    }
    onRefresh();
  };

  const handleDuplicate = async (name: string) => {
    await onDuplicate(name);
    onRefresh();
  };

  const handleDelete = async (name: string) => {
    await onDelete(name);
    onRefresh();
    setConfirmDelete(null);
  };

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg)] select-none">
      {/* Top Header */}
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <FileText className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
          <span className="text-sm font-semibold text-[var(--color-text)]">Commit Templates</span>
          <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-muted)] border border-[var(--color-border)]">
            {templates.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHelp(!showHelp)}
            className="flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
            title="Variables Reference"
          >
            <HelpCircle className="h-3.5 w-3.5" />
            <span>Variables</span>
          </button>
          <Button variant="primary" onClick={handleCreate}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New Template
          </Button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-5 pb-20">
        {/* Helper Banner */}
        {showHelp && (
          <div className="mb-5 rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 animate-fadeIn">
            <div className="flex items-center justify-between mb-3 border-b border-[var(--color-border)] pb-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text)]">
                <Code2 className="h-4 w-4 text-[var(--color-accent)]" />
                Template Variable Reference
              </div>
              <button
                onClick={() => setShowHelp(false)}
                className="text-[10px] text-[var(--color-faint)] hover:text-[var(--color-text)] uppercase tracking-wider cursor-pointer"
              >
                Close
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {VARIABLES_HELP.map((item) => (
                <div key={item.var} className="flex items-start gap-2 rounded bg-[var(--color-surface-2)] p-2 border border-[var(--color-border)]">
                  <code className="shrink-0 font-[family-name:var(--font-mono)] text-[11px] font-bold text-[var(--color-accent)]">{item.var}</code>
                  <span className="text-[11px] text-[var(--color-muted)] leading-snug">{item.desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Templates List */}
        {templates.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No commit templates yet"
            hint="Create custom message templates with dynamic variables to speed up draft scheduling."
            action={
              <Button variant="primary" onClick={handleCreate} className="mt-2">
                <Plus className="h-3.5 w-3.5 mr-1" /> Create First Template
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {templates.map((tpl) => (
              <div
                key={tpl.name}
                className="group relative flex flex-col justify-between rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-all duration-150 hover:border-[var(--color-border-strong)] shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[var(--color-text)] truncate">{tpl.name}</span>
                    </div>
                    <div className="mt-2 rounded-[var(--radius-control)] bg-[var(--color-surface-2)] border border-[var(--color-border)] p-2.5 font-[family-name:var(--font-mono)] text-xs text-[var(--color-text)] whitespace-pre-wrap break-words leading-relaxed">
                      {tpl.template}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => handleEdit(tpl)}
                      className="flex items-center gap-1 rounded-[var(--radius-control)] border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
                      title="Edit template"
                    >
                      <Pencil className="h-3 w-3" />
                      <span>Edit</span>
                    </button>
                    <button
                      onClick={() => handleDuplicate(tpl.name)}
                      className="flex items-center gap-1 rounded-[var(--radius-control)] border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
                      title="Duplicate template"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => setConfirmDelete(tpl.name)}
                      className="flex items-center gap-1 rounded-[var(--radius-control)] border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_15%,transparent)] transition-colors cursor-pointer"
                      title="Delete template"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmDelete(null)}>
          <div
            className="w-full max-w-sm rounded-[var(--radius-dialog)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">Delete template?</h3>
              <p className="mt-2 text-xs text-[var(--color-muted)] leading-relaxed">
                Are you sure you want to delete &ldquo;{confirmDelete}&rdquo;? Draft commits using this template pattern will retain their text.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-4 py-3">
              <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => handleDelete(confirmDelete)}>
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Template editor dialog */}
      <TemplateEditorDialog
        open={editorOpen}
        existing={editingTemplate}
        onClose={() => setEditorOpen(false)}
        onSave={handleSave}
      />
    </div>
  );
}
