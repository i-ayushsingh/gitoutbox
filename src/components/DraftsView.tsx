import { useMemo, useState } from "react";
import {
  Pencil,
  Trash2,
  FileText,
  Layers,
  CalendarClock,
  Check,
  RotateCcw,
  Play,
  AlertTriangle,
  Search,
  ChevronDown,
  ChevronUp,
  Copy,
  GitBranch,
  Clock,
} from "lucide-react";
import { type QueueItem, api } from "../lib/ipc";
import { EmptyState, Button, Badge } from "./ui";

type StatusTab = "all" | "pending" | "scheduled" | "executing" | "completed" | "failed" | "skipped" | "archived";

function getItemStatusGroup(status: string): StatusTab {
  switch (status) {
    case "Draft":
      return "pending";
    case "Scheduled":
      return "scheduled";
    case "Validating":
    case "Staging":
    case "Committing":
    case "Pushing":
    case "Executing":
      return "executing";
    case "Completed":
      return "completed";
    case "Failed":
    case "Paused":
      return "failed";
    case "Skipped":
      return "skipped";
    case "Archived":
      return "archived";
    default:
      return "pending";
  }
}

function getDateGroup(epoch: number | null): string {
  if (!epoch) return "Pending Schedule";
  const date = new Date(epoch * 1000);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const endOfWeek = new Date(today);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  if (date >= today && date < tomorrow) return "Today";
  if (date >= tomorrow && date < new Date(tomorrow.getTime() + 86400000)) return "Tomorrow";
  if (date >= today && date <= endOfWeek) return "This Week";
  if (date < today) return "Earlier";
  return "Upcoming";
}

export function DraftsView({
  items,
  repoPath,
  onQueueChanged,
  onEdit,
  onRemove,
  onSchedule,
  onReschedule,
  onReturnToDraft,
  onRunNow,
}: {
  items: QueueItem[];
  repoPath: string;
  onQueueChanged: () => void;
  onEdit: (item: QueueItem) => void;
  onRemove: (id: number) => void;
  onSchedule: (drafts: QueueItem[]) => void;
  onReschedule: (item: QueueItem) => void;
  onReturnToDraft: (id: number) => void;
  onRunNow: (id: number) => void;
}) {
  const [activeTab, setActiveTab] = useState<StatusTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [copiedExport, setCopiedExport] = useState(false);

  // Status Counts
  const counts = useMemo(() => {
    const map = {
      all: items.length,
      pending: 0,
      scheduled: 0,
      executing: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      archived: 0,
    };
    for (const item of items) {
      const g = getItemStatusGroup(item.status);
      map[g] = (map[g] || 0) + 1;
    }
    return map;
  }, [items]);

  // Filtered items
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      const group = getItemStatusGroup(item.status);
      if (activeTab !== "all" && group !== activeTab) {
        return false;
      }
      if (q) {
        const matchMsg = item.commit_message.toLowerCase().includes(q) || item.title.toLowerCase().includes(q);
        const matchBranch = item.target_branch.toLowerCase().includes(q);
        const matchHash = item.commit_hash?.toLowerCase().includes(q) || false;
        const matchFile = item.files.some((f) => f.path.toLowerCase().includes(q));
        return matchMsg || matchBranch || matchHash || matchFile;
      }
      return true;
    });
  }, [items, activeTab, searchQuery]);

  // Date Grouping
  const groupedItems = useMemo(() => {
    const map = new Map<string, QueueItem[]>();
    for (const item of filteredItems) {
      const group = getDateGroup(item.scheduled_time || item.updated_at);
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(item);
    }
    return map;
  }, [filteredItems]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    if (selectedIds.size === filteredItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.map((i) => i.id)));
    }
  };

  const selectedItems = useMemo(
    () => items.filter((i) => selectedIds.has(i.id)),
    [items, selectedIds]
  );

  const handleBulkDelete = async () => {
    try {
      await Promise.all(selectedItems.map((i) => api.removeQueueItem(i.id)));
      setSelectedIds(new Set());
      onQueueChanged();
    } catch (e) {
      console.error(e);
    }
  };

  const handleBulkRunNow = async () => {
    try {
      for (const item of selectedItems) {
        await api.executeItem(item.id, repoPath);
      }
      setSelectedIds(new Set());
      onQueueChanged();
    } catch (e) {
      console.error(e);
    }
  };

  const handleBulkExport = () => {
    const data = JSON.stringify(selectedItems, null, 2);
    navigator.clipboard.writeText(data);
    setCopiedExport(true);
    setTimeout(() => setCopiedExport(false), 1200);
  };

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="No commit items in queue"
        hint="Select changed files in the Changes tab to create your first commit draft."
      />
    );
  }

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg)] select-none">
      {/* Top Status Tabs Navigation */}
      <header className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-2 bg-[var(--color-surface)] overflow-x-auto gap-2">
        <div className="flex items-center gap-1">
          {(
            [
              { id: "all", label: "All", count: counts.all },
              { id: "pending", label: "Pending", count: counts.pending },
              { id: "scheduled", label: "Scheduled", count: counts.scheduled },
              { id: "executing", label: "Executing", count: counts.executing },
              { id: "completed", label: "Completed", count: counts.completed },
              { id: "failed", label: "Failed", count: counts.failed },
              { id: "skipped", label: "Skipped", count: counts.skipped },
            ] as const
          ).map(({ id, label, count }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                activeTab === id
                  ? "bg-[var(--color-surface-2)] text-[var(--color-text)] border border-[var(--color-border-strong)] shadow-sm"
                  : "text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
              }`}
            >
              <span>{label}</span>
              {count > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                    activeTab === id
                      ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                      : "bg-[var(--color-surface-2)] text-[var(--color-faint)] border border-[var(--color-border)]"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search Bar & Select All */}
        <div className="flex items-center gap-2">
          {filteredItems.length > 0 && (
            <button
              onClick={selectAllVisible}
              className="rounded-[var(--radius-control)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] cursor-pointer"
            >
              {selectedIds.size === filteredItems.length ? "Deselect all" : "Select all"}
            </button>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-[var(--color-faint)]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search queue (message, file, hash)..."
              className="w-56 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] py-1 pl-8 pr-3 text-xs outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-border-strong)]"
            />
          </div>
        </div>
      </header>

      {/* Bulk Action Toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] px-4 py-2 text-xs text-[var(--color-accent)] animate-fadeIn">
          <div className="flex items-center gap-2 font-semibold">
            <Check className="h-4 w-4" />
            <span>{selectedIds.size} draft{selectedIds.size === 1 ? "" : "s"} selected</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={() => { onSchedule(selectedItems); setSelectedIds(new Set()); }}>
              <CalendarClock className="h-3.5 w-3.5" /> Schedule Selected
            </Button>
            <Button variant="default" onClick={handleBulkRunNow}>
              <Play className="h-3.5 w-3.5 text-[var(--color-accent)]" /> Run Now
            </Button>
            <Button variant="default" onClick={handleBulkExport}>
              <Copy className="h-3.5 w-3.5" /> {copiedExport ? "Copied!" : "Export"}
            </Button>
            <Button variant="danger" onClick={handleBulkDelete}>
              <Trash2 className="h-3.5 w-3.5" /> Delete Selected
            </Button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-[11px] text-[var(--color-muted)] hover:text-[var(--color-text)] underline cursor-pointer ml-2"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Main Queue Timeline Content */}
      <div className="flex-1 overflow-y-auto p-4 pb-20">
        {filteredItems.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No items in this queue view"
            hint="Try selecting another status tab above or clearing your search filter."
          />
        ) : (
          <div className="max-w-4xl mx-auto flex flex-col gap-6">
            {["Today", "Tomorrow", "This Week", "Earlier", "Pending Schedule", "Upcoming"].map((groupName) => {
              const groupItems = groupedItems.get(groupName);
              if (!groupItems || groupItems.length === 0) return null;

              return (
                <div key={groupName} className="animate-fadeIn">
                  <div className="sticky top-0 z-10 mb-3 border-b border-[var(--color-border)] bg-[var(--color-bg)] pb-1 text-[11px] font-bold uppercase tracking-wider text-[var(--color-faint)]">
                    {groupName} ({groupItems.length})
                  </div>
                  <div className="flex flex-col gap-2">
                    {groupItems.map((item) => (
                      <QueueItemCard
                        key={item.id}
                        item={item}
                        isSelected={selectedIds.has(item.id)}
                        isExpanded={expandedId === item.id}
                        onToggleSelect={() => toggleSelect(item.id)}
                        onToggleExpand={() => setExpandedId(expandedId === item.id ? null : item.id)}
                        onEdit={() => onEdit(item)}
                        onSchedule={() => onSchedule([item])}
                        onReschedule={() => onReschedule(item)}
                        onRunNow={() => onRunNow(item.id)}
                        onReturnToDraft={() => onReturnToDraft(item.id)}
                        onDelete={() => onRemove(item.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function QueueItemCard({
  item,
  isSelected,
  isExpanded,
  onToggleSelect,
  onToggleExpand,
  onEdit,
  onSchedule,
  onReschedule,
  onRunNow,
  onReturnToDraft,
  onDelete,
}: {
  item: QueueItem;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onEdit: () => void;
  onSchedule: () => void;
  onReschedule: () => void;
  onRunNow: () => void;
  onReturnToDraft: () => void;
  onDelete: () => void;
}) {
  const statusVariant = {
    Draft: "default",
    Scheduled: "accent",
    Validating: "accent",
    Staging: "accent",
    Committing: "accent",
    Pushing: "accent",
    Completed: "ok",
    Paused: "warn",
    Failed: "danger",
    Skipped: "warn",
  }[item.status] as "default" | "ok" | "warn" | "danger" | "accent";

  const scheduledTimeStr = item.scheduled_time
    ? new Date(item.scheduled_time * 1000).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div
      className={`group flex flex-col rounded-[var(--radius-panel)] border transition-all shadow-sm ${
        isSelected
          ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_5%,var(--color-surface))]"
          : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)]"
      }`}
    >
      {/* Primary Row */}
      <div className="flex items-start gap-3 p-3.5">
        <button
          onClick={onToggleSelect}
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all cursor-pointer ${
            isSelected
              ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
              : "border-[var(--color-border-strong)] hover:border-[var(--color-accent)]"
          }`}
        >
          {isSelected && <Check className="h-3 w-3" strokeWidth={3} />}
        </button>

        <div className="min-w-0 flex-1 cursor-pointer" onClick={onToggleExpand}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-[family-name:var(--font-mono)] text-xs font-bold text-[var(--color-text)] truncate max-w-md">
              {item.title || item.commit_message || "Untitled Commit Draft"}
            </span>
            <Badge variant={statusVariant}>{item.status}</Badge>
            <span className="flex items-center gap-1 text-[10px] text-[var(--color-muted)] font-semibold bg-[var(--color-surface-2)] border border-[var(--color-border)] px-1.5 py-0.5 rounded">
              <GitBranch className="h-3 w-3 text-[var(--color-accent)]" /> {item.target_branch}
            </span>
            {item.commit_hash && (
              <span className="text-[10px] font-mono text-[var(--color-accent)] font-semibold bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] border border-[color-mix(in_srgb,var(--color-accent)_30%,transparent)] px-1.5 py-0.5 rounded">
                #{item.commit_hash.slice(0, 7)}
              </span>
            )}
          </div>

          <div className="mt-1.5 flex items-center gap-3 text-[11px] text-[var(--color-muted)] flex-wrap">
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3 text-[var(--color-faint)]" />
              {item.files.length} {item.files.length === 1 ? "file" : "files"}
            </span>
            {scheduledTimeStr && (
              <span className="flex items-center gap-1 text-[var(--color-accent)] font-medium">
                <Clock className="h-3 w-3" /> Scheduled: {scheduledTimeStr}
              </span>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1 shrink-0">
          {item.status === "Draft" && (
            <Button variant="primary" onClick={onSchedule} className="py-1 px-2.5 text-[11px]">
              <CalendarClock className="h-3.5 w-3.5" /> Schedule
            </Button>
          )}
          {item.status === "Scheduled" && (
            <>
              <Button variant="default" onClick={onReschedule} className="py-1 px-2 text-[11px]">
                <CalendarClock className="h-3.5 w-3.5 text-[var(--color-accent)]" /> Reschedule
              </Button>
              <Button variant="default" onClick={onRunNow} className="py-1 px-2 text-[11px]">
                <Play className="h-3.5 w-3.5 text-[var(--color-accent)]" /> Run Now
              </Button>
            </>
          )}
          <button
            onClick={onToggleExpand}
            className="rounded p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] cursor-pointer"
            title="Toggle Details"
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Expandable Details Drawer */}
      {isExpanded && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 flex flex-col gap-3 text-xs animate-fadeIn">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-faint)] mb-1">
              Full Commit Message
            </div>
            <textarea
              readOnly
              value={item.commit_message}
              rows={3}
              className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 font-[family-name:var(--font-mono)] text-xs text-[var(--color-text)] focus:outline-none"
            />
          </div>

          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-faint)] mb-1">
              Assigned Staged Files ({item.files.length})
            </div>
            <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
              {item.files.map((f) => (
                <div key={f.path} className="flex items-center justify-between rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-text)]">
                  <span>{f.path}</span>
                  <span className="text-[10px] uppercase tracking-wider text-[var(--color-faint)]">{f.change_type}</span>
                </div>
              ))}
            </div>
          </div>

          {item.last_error && (
            <div className="rounded-[var(--radius-control)] border border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] p-3 text-xs text-[var(--color-danger)]">
              <div className="font-bold mb-1 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" /> Last Execution Error
              </div>
              <p className="font-[family-name:var(--font-mono)] text-[11px]">{item.last_error}</p>
            </div>
          )}

          {/* Extended Card Actions */}
          <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-3 mt-1">
            <div className="flex items-center gap-2">
              <Button variant="default" onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5" /> Edit Message & Files
              </Button>
              {item.status === "Scheduled" && (
                <Button variant="default" onClick={onReturnToDraft}>
                  <RotateCcw className="h-3.5 w-3.5" /> Return to Draft
                </Button>
              )}
            </div>
            <Button variant="danger" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" /> Delete Item
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
