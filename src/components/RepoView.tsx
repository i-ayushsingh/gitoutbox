import { useCallback, useEffect, useState } from "react";
import { Layers, GitCommitHorizontal, Plus } from "lucide-react";
import {
  api,
  type Change,
  type QueueItem,
  type QueueItemFile,
  type Repository,
  type RepoStatus,
  type Template,
  type AssignedFile,
} from "../lib/ipc";
import { expandTemplateSingle } from "../lib/templates";
import { ChangesView } from "./ChangesView";
import { DraftsView } from "./DraftsView";
import { ComposerDialog, type ComposerTarget } from "./ComposerDialog";
import { BatchDraftDialog, type BatchDraftTarget } from "./BatchDraftDialog";
import { EditDraftDialog } from "./EditDraftDialog";
import { ScheduleComposer } from "./ScheduleComposer";
import { Button, EmptyState } from "./ui";

type Tab = "changes" | "drafts";

export function RepoView({
  repo,
  queueItems,
  selected,
  onSelectionChange,
  onQueueChanged,
  templates,
}: {
  repo: Repository;
  queueItems: QueueItem[];
  selected: Set<string>;
  onSelectionChange: (fn: (prev: Set<string>) => Set<string>) => void;
  onQueueChanged: () => void;
  templates: Template[];
}) {
  const [tab, setTab] = useState<Tab>("changes");
  const [composer, setComposer] = useState<ComposerTarget | null>(null);
  const [batchDraft, setBatchDraft] = useState<BatchDraftTarget | null>(null);
  const [editDraft, setEditDraft] = useState<QueueItem | null>(null);
  const [scheduleComposer, setScheduleComposer] = useState<QueueItem[] | null>(null);
  const [saving, setSaving] = useState(false);

  const [status, setStatus] = useState<RepoStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignedFiles, setAssignedFiles] = useState<Map<string, AssignedFile>>(new Map());

  const loadStatus = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .inspectRepository(repo.path)
      .then((s) => {
        setStatus(s);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setStatus(null);
        setLoading(false);
      });
  }, [repo.path]);

  const loadAssignedFiles = useCallback(() => {
    api.listAssignedFiles(repo.id).then((files) => {
      const map = new Map<string, AssignedFile>();
      for (const f of files) map.set(f.path, f);
      setAssignedFiles(map);
    }).catch(() => setAssignedFiles(new Map()));
  }, [repo.id]);

  useEffect(loadStatus, [loadStatus]);
  useEffect(loadAssignedFiles, [loadAssignedFiles]);

  useEffect(() => {
    const hasPaused = queueItems.some((i) => i.status === "Paused");
    if (hasPaused) {
      setTab("drafts");
    }
  }, [queueItems]);

  const branch = status?.current_branch ?? null;
  const changes = status?.changes ?? [];

  const toggle = (path: string) =>
    onSelectionChange((prev) => {
      if (assignedFiles.has(path)) return prev;
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const toggleAllVisible = (paths: string[]) =>
    onSelectionChange((prev) => {
      const available = paths.filter((p) => !assignedFiles.has(p));
      const allOn = available.length > 0 && available.every((p) => prev.has(p));
      const next = new Set(prev);
      if (allOn) available.forEach((p) => next.delete(p));
      else available.forEach((p) => next.add(p));
      return next;
    });

  const draftFiles = (paths: string[]): QueueItemFile[] =>
    paths
      .map((p) => changes.find((c) => c.path === p))
      .filter((c): c is Change => !!c)
      .map((c) => ({
        path: c.path,
        original_path: c.original_path,
        change_type: c.change_type,
      }));

  const openCompose = (files: QueueItemFile[], existing: QueueItem | null) => {
    setComposer({ files, existing });
  };

  const handleComposeOneDraft = () => {
    const available = [...selected].filter((p) => !assignedFiles.has(p));
    if (available.length === 0) return;
    openCompose(draftFiles(available), null);
  };

  const handleBatchOnePerFile = () => {
    const available = [...selected].filter((p) => !assignedFiles.has(p));
    if (available.length === 0) return;
    setBatchDraft({ files: draftFiles(available) });
  };

  const saveSingle = async (
    id: number | null,
    commitMessage: string,
    files: QueueItemFile[]
  ) => {
    setSaving(true);
    try {
      if (id == null) {
        await api.createQueueItem({
          repository_id: repo.id,
          target_branch: branch ?? "main",
          files,
          title: commitMessage.split("\n")[0],
          commit_message: commitMessage,
        });
      } else {
        await api.updateQueueItem(id, commitMessage.split("\n")[0], commitMessage);
      }
      onQueueChanged();
      loadStatus();
      loadAssignedFiles();
      onSelectionChange(() => new Set());
    } finally {
      setSaving(false);
    }
  };

  const handleBatchConfirm = async (templateText: string) => {
    if (!batchDraft) return;
    const ctx = { repo: repo.name, branch: branch ?? "main" };
    const items = batchDraft.files.map((f) => {
      const resolved = expandTemplateSingle(templateText, f.path, ctx);
      return {
        title: resolved.split("\n")[0],
        commit_message: resolved,
        files: [f],
      };
    });
    await api.batchCreateQueueItems(repo.id, branch ?? "main", items);
    onQueueChanged();
    loadStatus();
    loadAssignedFiles();
    onSelectionChange(() => new Set());
    setBatchDraft(null);
  };

  const handleEditSave = async (
    commitMessage: string,
    targetBranch: string,
    files: QueueItemFile[]
  ) => {
    if (!editDraft) return;
    setSaving(true);
    try {
      await api.updateQueueItemFull(editDraft.id, commitMessage, targetBranch, files);
      onQueueChanged();
      loadStatus();
      loadAssignedFiles();
      setEditDraft(null);
    } finally {
      setSaving(false);
    }
  };

  const handleSelectAssignedDraft = (itemId: number) => {
    const item = queueItems.find((i) => i.id === itemId);
    if (item) {
      setEditDraft(item);
      setTab("drafts");
    }
  };

  const handleScheduleConfirm = async (assignments: { item_id: number; scheduled_time: number }[]) => {
    // Separate Draft items (schedule) from Scheduled items (reschedule).
    const draftIds = new Set(
      (scheduleComposer ?? []).filter((d) => d.status === "Draft").map((d) => d.id)
    );
    const toSchedule = assignments.filter((a) => draftIds.has(a.item_id));
    const toReschedule = assignments.filter((a) => !draftIds.has(a.item_id));

    if (toSchedule.length > 0) {
      await api.scheduleItems(repo.id, toSchedule, repo.path);
    }
    for (const a of toReschedule) {
      await api.rescheduleItem(a.item_id, a.scheduled_time);
    }
    onQueueChanged();
    loadStatus();
    loadAssignedFiles();
    setScheduleComposer(null);
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <TabBar tab={tab} setTab={setTab} draftCount={queueItems.length} />
        {tab === "changes" ? (
          <ChangesView
            repoName={repo.name}
            status={status}
            loading={loading}
            error={error}
            onRefresh={() => { loadStatus(); loadAssignedFiles(); }}
            selected={selected}
            onToggle={toggle}
            onToggleAllVisible={toggleAllVisible}
            assignedFiles={assignedFiles}
            onSelectAssignedDraft={handleSelectAssignedDraft}
          />
        ) : (
          <DraftsView
            items={queueItems}
            repoPath={repo.path}
            onQueueChanged={onQueueChanged}
            onEdit={(item) => setEditDraft(item)}
            onRemove={async (id) => {
              await api.removeQueueItem(id);
              onQueueChanged();
              loadStatus();
              loadAssignedFiles();
            }}
            onSchedule={(drafts) => setScheduleComposer(drafts)}
            onReschedule={(item) => setScheduleComposer([item])}
            onReturnToDraft={async (id) => {
              await api.unscheduleItems([id]);
              onQueueChanged();
              loadStatus();
              loadAssignedFiles();
            }}
            onRunNow={async (id) => {
              try {
                await api.executeItem(id, repo.path);
              } catch (e) {
                // Error is surfaced via activity log and item state.
              }
              onQueueChanged();
              loadStatus();
              loadAssignedFiles();
            }}
          />
        )}
      </div>

      <aside className="flex w-72 shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)]">
        {selected.size > 0 ? (
          <SelectionPanel
            count={selected.size}
            onBatchOnePerFile={handleBatchOnePerFile}
            onGroupIntoOne={handleComposeOneDraft}
            onClear={() => onSelectionChange(() => new Set())}
          />
        ) : (
          <InspectorHelp draftCount={queueItems.length} />
        )}
      </aside>

      {/* Single draft composer (one file or grouped) */}
      <ComposerDialog
        open={composer != null}
        target={composer}
        repoName={repo.name}
        branch={branch ?? "main"}
        templates={templates}
        onClose={() => setComposer(null)}
        onSave={saveSingle}
      />

      {/* Batch draft dialog (one draft per file) */}
      <BatchDraftDialog
        open={batchDraft != null}
        target={batchDraft}
        repoName={repo.name}
        branch={branch ?? "main"}
        templates={templates}
        onClose={() => setBatchDraft(null)}
        onConfirm={handleBatchConfirm}
      />

      {/* Edit draft dialog */}
      <EditDraftDialog
        open={editDraft != null}
        item={editDraft}
        changes={changes}
        assignedPaths={(() => {
          const own = new Set(editDraft?.files.map((f) => f.path) ?? []);
          const others = new Map([...assignedFiles].filter(([p]) => !own.has(p)));
          return new Set(others.keys());
        })()}
        repoName={repo.name}
        branch={branch ?? "main"}
        templates={templates}
        onClose={() => setEditDraft(null)}
        onSave={handleEditSave}
      />

      {/* Schedule Composer */}
      <ScheduleComposer
        open={scheduleComposer != null && scheduleComposer.length > 0}
        drafts={scheduleComposer ?? []}
        onClose={() => setScheduleComposer(null)}
        onConfirm={handleScheduleConfirm}
      />

      {saving && null}
    </div>
  );
}

function TabBar({
  tab,
  setTab,
  draftCount,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  draftCount: number;
}) {
  const tabs: { id: Tab; label: string; icon: typeof Layers }[] = [
    { id: "changes", label: "Changes", icon: GitCommitHorizontal },
    { id: "drafts", label: `Drafts${draftCount ? ` (${draftCount})` : ""}`, icon: Layers },
  ];
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-[var(--color-border)] px-3 py-1.5 bg-[var(--color-surface)] select-none">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => setTab(id)}
          className={`flex items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-1.5 text-xs font-semibold transition-all duration-150 cursor-pointer ${
            tab === id
              ? "bg-[var(--color-surface-2)] text-[var(--color-text)] border border-[var(--color-border-strong)] shadow-sm"
              : "text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
          }`}
        >
          <Icon className={`h-3.5 w-3.5 ${tab === id ? "text-[var(--color-accent)]" : ""}`} />
          {label}
        </button>
      ))}
    </div>
  );
}

function SelectionPanel({
  count,
  onBatchOnePerFile,
  onGroupIntoOne,
  onClear,
}: {
  count: number;
  onBatchOnePerFile: () => void;
  onGroupIntoOne: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 p-5 animate-fadeIn select-none">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
        <div>
          <div className="text-sm font-bold text-[var(--color-text)]">{count} {count === 1 ? "file" : "files"} selected</div>
          <div className="text-[11px] text-[var(--color-muted)]">Ready for draft commit creation</div>
        </div>
        <button
          onClick={onClear}
          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] underline cursor-pointer"
        >
          Clear
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <Button variant="primary" onClick={onGroupIntoOne} className="w-full justify-center py-2 font-semibold">
          <Plus className="h-4 w-4" /> Group into single draft
        </Button>
        <Button variant="default" onClick={onBatchOnePerFile} className="w-full justify-center py-2">
          <Plus className="h-4 w-4 text-[var(--color-accent)]" /> One draft per file ({count})
        </Button>
      </div>

      <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-[11px] leading-relaxed text-[var(--color-muted)]">
        <p className="font-semibold text-[var(--color-text)] mb-1">How draft commits work:</p>
        <p>Created drafts stage assigned files only. No files are committed to Git history until scheduled or executed.</p>
      </div>
    </div>
  );
}

function InspectorHelp({ draftCount }: { draftCount: number }) {
  if (draftCount > 0) {
    return (
      <EmptyState
        icon={Layers}
        title={`${draftCount} draft commit${draftCount === 1 ? "" : "s"} ready`}
        hint="Switch to the Drafts tab above to review, schedule, or edit your commit queue."
      />
    );
  }
  return (
    <EmptyState
      icon={GitCommitHorizontal}
      title="Select files to draft"
      hint="Check changes on the left to group files into a single commit draft or create separate commits."
    />
  );
}

