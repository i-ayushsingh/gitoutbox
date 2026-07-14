import { useMemo, useState } from "react";
import { Pencil, Trash2, FileText, Layers, CalendarClock, Check, RotateCcw, Play } from "lucide-react";
import { type QueueItem } from "../lib/ipc";
import { EmptyState, Mono, Button } from "./ui";

export function DraftsView({
  items,
  onEdit,
  onRemove,
  onSchedule,
  onReschedule,
  onReturnToDraft,
  onRunNow,
}: {
  items: QueueItem[];
  onEdit: (item: QueueItem) => void;
  onRemove: (id: number) => void;
  onSchedule: (drafts: QueueItem[]) => void;
  onReschedule: (item: QueueItem) => void;
  onReturnToDraft: (id: number) => void;
  onRunNow: (id: number) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [confirmReturn, setConfirmReturn] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const draftItems = useMemo(() => items.filter((i) => i.status === "Draft"), [items]);
  const scheduledItems = useMemo(() => items.filter((i) => i.status === "Scheduled"), [items]);
  const completedItems = useMemo(() => items.filter((i) => i.status === "Completed"), [items]);
  const pausedItems = useMemo(() => items.filter((i) => i.status === "Paused"), [items]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    if (selectedIds.size === draftItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(draftItems.map((d) => d.id)));
    }
  };

  const selectedDrafts = draftItems.filter((d) => selectedIds.has(d.id));

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="No draft commits yet"
        hint="Select changed files in the Changes tab and create a draft. Each draft becomes one scheduled commit."
      />
    );
  }

  const formatTime = (epoch: number | null) => {
    if (!epoch) return "";
    return new Date(epoch * 1000).toLocaleString([], {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "Completed": return <Check className="h-3.5 w-3.5 text-[var(--color-ok)]" />;
      case "Paused": return <RotateCcw className="h-3.5 w-3.5 text-[var(--color-warn)]" />;
      default: return <CalendarClock className="h-3.5 w-3.5 text-[var(--color-accent)]" />;
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Action bar when drafts are selected */}
      {draftItems.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
          <button
            onClick={selectAllVisible}
            className="rounded-[var(--radius-control)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            {selectedIds.size === draftItems.length ? "Clear" : "Select all"}
          </button>
          {selectedIds.size > 0 && (
            <>
              <span className="text-[11px] text-[var(--color-faint)]">
                {selectedIds.size} selected
              </span>
              <Button variant="primary" onClick={() => { onSchedule(selectedDrafts); setSelectedIds(new Set()); }}>
                <CalendarClock className="h-3.5 w-3.5" /> Schedule {selectedIds.size} draft{selectedIds.size === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {/* Draft items */}
        {draftItems.length > 0 && (
          <>
            <div className="border-b border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-muted)]">
              {draftItems.length} {draftItems.length === 1 ? "draft" : "drafts"}
            </div>
            {draftItems.map((item) => (
              <div key={item.id} className="flex items-start gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
                <button
                  onClick={() => toggleSelect(item.id)}
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    selectedIds.has(item.id)
                      ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                      : "border-[var(--color-border-strong)]"
                  }`}
                >
                  {selectedIds.has(item.id) && <Check className="h-3 w-3" strokeWidth={3} />}
                </button>

                <div className="min-w-0 flex-1">
                  <div className="truncate font-[family-name:var(--font-mono)] text-xs text-[var(--color-text)]">
                    {item.commit_message || <span className="text-[var(--color-faint)]">No message</span>}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--color-faint)]">
                    <FileText className="h-3 w-3" />
                    {item.files.length} {item.files.length === 1 ? "file" : "files"}
                    <span className="text-[var(--color-border-strong)]">·</span>
                    <Mono>{item.target_branch}</Mono>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {item.files.map((f) => (
                      <span key={f.path} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-muted)]" title={f.path}>
                        {f.path}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                  <button onClick={() => onEdit(item)} className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]" title="Edit draft">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setConfirmDelete(item.id)} className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-danger)]" title="Delete draft">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {confirmDelete === item.id && (
                  <div className="mt-2 w-full rounded-[var(--radius-control)] border border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] px-3 py-2">
                    <p className="text-xs text-[var(--color-text)]">Remove this draft? No Git files or history will be changed.</p>
                    <div className="mt-2 flex gap-2">
                      <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                      <Button variant="primary" onClick={() => { onRemove(item.id); setConfirmDelete(null); }}>Remove draft</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {/* Scheduled/Completed/Paused items */}
        {[...scheduledItems, ...completedItems, ...pausedItems].length > 0 && (
          <>
            <div className="border-b border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-muted)]">
              {scheduledItems.length + completedItems.length + pausedItems.length} scheduled
            </div>
            {[...scheduledItems, ...completedItems, ...pausedItems].map((item) => (
              <div key={item.id} className="group flex items-start gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
                {statusIcon(item.status)}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-[family-name:var(--font-mono)] text-xs text-[var(--color-text)]">
                    {item.commit_message || <span className="text-[var(--color-faint)]">No message</span>}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--color-faint)]">
                    <FileText className="h-3 w-3" />
                    {item.files.length} {item.files.length === 1 ? "file" : "files"}
                    {item.status === "Completed" ? (
                      <>
                        {item.scheduled_time && (
                          <>
                            <span className="text-[var(--color-border-strong)]">·</span>
                            <span>Sched: {formatTime(item.scheduled_time)}</span>
                          </>
                        )}
                        <span className="text-[var(--color-border-strong)]">·</span>
                        <span className="text-[var(--color-ok)]">Executed: {formatTime(item.updated_at)}</span>
                      </>
                    ) : (
                      <>
                        {item.scheduled_time && (
                          <>
                            <span className="text-[var(--color-border-strong)]">·</span>
                            <span>Scheduled: {formatTime(item.scheduled_time)}</span>
                          </>
                        )}
                        {item.status === "Paused" && (
                          <>
                            <span className="text-[var(--color-border-strong)]">·</span>
                            <span className="text-[var(--color-warn)]">Paused</span>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Scheduled item actions */}
                {item.status === "Scheduled" && (
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => onReschedule(item)} className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]" title="Reschedule">
                      <CalendarClock className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => onRunNow(item.id)} className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-accent)]" title="Run now">
                      <Play className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setConfirmReturn(item.id)} className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]" title="Return to Draft">
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {confirmReturn === item.id && (
                  <div className="mt-2 w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
                    <p className="text-xs text-[var(--color-text)]">Return this item to Draft? The scheduled time will be cleared.</p>
                    <div className="mt-2 flex gap-2">
                      <Button variant="ghost" onClick={() => setConfirmReturn(null)}>Cancel</Button>
                      <Button variant="primary" onClick={() => { onReturnToDraft(item.id); setConfirmReturn(null); }}>Return to Draft</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
