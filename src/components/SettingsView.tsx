import { useEffect, useState } from "react";
import { Pencil, Copy, Trash2, Settings, Plus, FileText, MoreVertical } from "lucide-react";
import { api, type Template } from "../lib/ipc";
import { EmptyState, Button } from "./ui";
import { TemplateEditorDialog } from "./TemplateEditorDialog";

const EXECUTION_MODES = [
  { value: "commit_only", label: "Commit only", desc: "Commit staged files. No push." },
  { value: "commit_and_push", label: "Commit and push", desc: "Commit then push to upstream." },
  { value: "push_at_end", label: "Push at end", desc: "Commit each item, push once when all complete." },
] as const;

const MISSED_SCHEDULE_POLICIES = [
  { value: "run_immediately", label: "Run immediately", desc: "Execute missed commits immediately on startup." },
  { value: "skip", label: "Skip missed items", desc: "Mark missed scheduled commits as Skipped." },
  { value: "ask", label: "Ask me", desc: "Pause missed commits and request review." },
  { value: "redistribute", label: "Redistribute remaining", desc: "Shift missed commits forward, preserving original gaps." },
] as const;

export function SettingsView({
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
  const [contextMenu, setContextMenu] = useState<string | null>(null);
  const [executionMode, setExecutionMode] = useState("commit_only");
  const [modeLoading, setModeLoading] = useState(true);
  const [missedPolicy, setMissedPolicy] = useState("run_immediately");
  const [policyLoading, setPolicyLoading] = useState(true);

  useEffect(() => {
    api.getExecutionMode().then((mode) => {
      setExecutionMode(mode);
      setModeLoading(false);
    }).catch(() => setModeLoading(false));

    api.getMissedSchedulePolicy().then((policy) => {
      setMissedPolicy(policy);
      setPolicyLoading(false);
    }).catch(() => setPolicyLoading(false));
  }, []);

  const handleModeChange = async (mode: string) => {
    const prev = executionMode;
    setExecutionMode(mode);
    try {
      await api.setExecutionMode(mode);
    } catch {
      setExecutionMode(prev);
    }
  };

  const handlePolicyChange = async (policy: string) => {
    const prev = missedPolicy;
    setMissedPolicy(policy);
    try {
      await api.setMissedSchedulePolicy(policy);
    } catch {
      setMissedPolicy(prev);
    }
  };

  const handleCreate = () => {
    setEditingTemplate(null);
    setEditorOpen(true);
  };

  const handleEdit = (tpl: Template) => {
    setEditingTemplate(tpl);
    setEditorOpen(true);
    setContextMenu(null);
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
    setContextMenu(null);
  };

  const handleDelete = async (name: string) => {
    await onDelete(name);
    onRefresh();
    setConfirmDelete(null);
    setContextMenu(null);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-2.5">
        <Settings className="h-4 w-4 text-[var(--color-muted)]" strokeWidth={1.75} />
        <span className="text-sm font-medium">Settings</span>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Execution section */}
        <div className="mb-6">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--color-faint)]">
            Execution
          </h2>
          <div className="rounded-[var(--radius-control)] border border-[var(--color-border)]">
            {EXECUTION_MODES.map((mode) => (
              <label
                key={mode.value}
                className="flex cursor-pointer items-start gap-3 border-b border-[var(--color-border)] px-3 py-2 last:border-b-0 hover:bg-[var(--color-surface)]"
              >
                <input
                  type="radio"
                  name="execution_mode"
                  value={mode.value}
                  checked={executionMode === mode.value}
                  onChange={() => handleModeChange(mode.value)}
                  disabled={modeLoading}
                  className="mt-0.5 accent-[var(--color-accent)]"
                />
                <div>
                  <div className="text-xs font-medium text-[var(--color-text)]">{mode.label}</div>
                  <div className="text-[10px] text-[var(--color-faint)]">{mode.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Missed Schedules Policy section */}
        <div className="mb-6">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--color-faint)]">
            Missed Schedules Policy
          </h2>
          <div className="rounded-[var(--radius-control)] border border-[var(--color-border)]">
            {MISSED_SCHEDULE_POLICIES.map((policy) => (
              <label
                key={policy.value}
                className="flex cursor-pointer items-start gap-3 border-b border-[var(--color-border)] px-3 py-2 last:border-b-0 hover:bg-[var(--color-surface)]"
              >
                <input
                  type="radio"
                  name="missed_schedule_policy"
                  value={policy.value}
                  checked={missedPolicy === policy.value}
                  onChange={() => handlePolicyChange(policy.value)}
                  disabled={policyLoading}
                  className="mt-0.5 accent-[var(--color-accent)]"
                />
                <div>
                  <div className="text-xs font-medium text-[var(--color-text)]">{policy.label}</div>
                  <div className="text-[10px] text-[var(--color-faint)]">{policy.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Commit Templates section */}
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--color-faint)]">
              Commit Templates
            </h2>
            <Button variant="default" onClick={handleCreate}>
              <Plus className="h-3 w-3" /> New template
            </Button>
          </div>

          {templates.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No templates yet"
              hint="Create a template to reuse commit messages with variables like {stem} and {directory}."
              action={
                <Button variant="primary" onClick={handleCreate}>
                  <Plus className="h-3 w-3" /> Create template
                </Button>
              }
            />
          ) : (
            <div className="rounded-[var(--radius-control)] border border-[var(--color-border)]">
              {templates.map((tpl) => (
                <div
                  key={tpl.name}
                  className="group relative flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-[var(--color-text)]">
                      {tpl.name}
                    </div>
                    <div className="mt-0.5 truncate font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-faint)]">
                      {tpl.template}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleEdit(tpl)}
                      className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                      title="Edit"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => setContextMenu(contextMenu === tpl.name ? null : tpl.name)}
                      className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                      title="More actions"
                    >
                      <MoreVertical className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Context menu */}
                  {contextMenu === tpl.name && (
                    <div className="absolute right-12 z-10 min-w-[140px] rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg">
                      <button
                        onClick={() => handleDuplicate(tpl.name)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
                      >
                        <Copy className="h-3 w-3" /> Duplicate
                      </button>
                      <div className="my-1 border-t border-[var(--color-border)]" />
                      <button
                        onClick={() => { setConfirmDelete(tpl.name); setContextMenu(null); }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)]"
                      >
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmDelete(null)}>
          <div
            className="w-full max-w-sm rounded-[var(--radius-dialog)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3">
              <h3 className="text-sm font-medium">Delete template?</h3>
              <p className="mt-2 text-xs text-[var(--color-muted)]">
                Delete &ldquo;{confirmDelete}&rdquo;? Existing drafts using this template are not affected.
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
