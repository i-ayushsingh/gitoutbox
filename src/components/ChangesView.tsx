import { useMemo, useState } from "react";
import {
  Search,
  RefreshCw,
  FilePlus2,
  FilePen,
  FileMinus2,
  FileSymlink,
  AlertTriangle,
  Loader2,
  FileQuestion,
  Check,
  Lock,
} from "lucide-react";
import {
  type Change,
  type ChangeType,
  type RepoStatus,
  type AssignedFile,
} from "../lib/ipc";
import { EmptyState, Mono } from "./ui";

const TYPE_META: Record<
  ChangeType,
  { icon: typeof FilePlus2; label: string; color: string }
> = {
  untracked: { icon: FilePlus2, label: "Untracked", color: "var(--color-ok)" },
  modified: { icon: FilePen, label: "Modified", color: "var(--color-accent)" },
  deleted: { icon: FileMinus2, label: "Deleted", color: "var(--color-danger)" },
  renamed: { icon: FileSymlink, label: "Renamed", color: "var(--color-warn)" },
};

type Filter = "all" | ChangeType;

export function ChangesView({
  repoName,
  status,
  loading,
  error,
  onRefresh,
  selected,
  onToggle,
  onToggleAllVisible,
  assignedFiles,
  onSelectAssignedDraft,
}: {
  repoName: string;
  status: RepoStatus | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  selected: Set<string>;
  onToggle: (path: string) => void;
  onToggleAllVisible: (paths: string[]) => void;
  assignedFiles: Map<string, AssignedFile>;
  onSelectAssignedDraft: (itemId: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const visible = useMemo(() => {
    const changes = status?.changes ?? [];
    const q = query.trim().toLowerCase();
    return changes.filter(
      (c) =>
        (filter === "all" || c.change_type === filter) &&
        (q === "" || c.path.toLowerCase().includes(q))
    );
  }, [status, query, filter]);

  // Select visible only includes non-assigned files.
  const selectableVisible = useMemo(
    () => visible.filter((c) => !assignedFiles.has(c.path)),
    [visible, assignedFiles]
  );

  const allVisibleSelected =
    selectableVisible.length > 0 &&
    selectableVisible.every((c) => selected.has(c.path));

  const handleToggleAllVisible = () => {
    onToggleAllVisible(selectableVisible.map((c) => c.path));
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{repoName}</span>
          {status?.current_branch && (
            <span className="rounded-[var(--radius-control)] border border-[var(--color-border)] px-1.5 py-0.5 text-[11px]">
              <Mono>{status.current_branch}</Mono>
            </span>
          )}
        </div>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-[var(--color-faint)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search paths"
            className="w-56 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 pl-7 pr-2 text-xs outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-border-strong)]"
          />
        </div>
        <button
          onClick={onRefresh}
          className="rounded-[var(--radius-control)] p-1.5 text-[var(--color-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          title="Refresh status"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      {status?.operation_in_progress && (
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-warn)_10%,transparent)] px-4 py-2 text-xs text-[var(--color-warn)]">
          <AlertTriangle className="h-4 w-4" />
          A {status.operation_in_progress} is in progress. GitOutbox pauses scheduling
          until it is resolved and will not touch this repository.
        </div>
      )}

      <div className="flex items-center gap-1 border-b border-[var(--color-border)] px-3 py-1.5 text-xs">
        <button
          onClick={handleToggleAllVisible}
          className={`rounded-[var(--radius-control)] px-2 py-1 transition-colors duration-150 ${
            allVisibleSelected
              ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
              : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
          }`}
          title="Select all available"
        >
          {allVisibleSelected ? "Clear visible" : "Select visible"}
        </button>
        {(Object.keys(TYPE_META) as ChangeType[]).map((t) => (
          <FilterTab key={t} active={filter === t} onClick={() => setFilter(t)}>
            {TYPE_META[t].label}
          </FilterTab>
        ))}
        <span className="ml-auto text-[var(--color-faint)]">
          {visible.length} {visible.length === 1 ? "change" : "changes"}
          {selected.size > 0 && (
            <span className="ml-2 text-[var(--color-accent)]">{selected.size} selected</span>
          )}
          {assignedFiles.size > 0 && (
            <span className="ml-2 text-[var(--color-faint)]">
              <Lock className="inline h-3 w-3 mb-0.5" /> {assignedFiles.size} assigned
            </span>
          )}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-20">
        {loading && !status && (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-[var(--color-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Inspecting repository…
          </div>
        )}
        {error && (
          <EmptyState
            icon={AlertTriangle}
            title="Could not inspect repository"
            hint={error}
          />
        )}
        {!loading && !error && visible.length === 0 && (
          <EmptyState
            icon={FileQuestion}
            title={
              (status?.changes.length ?? 0) === 0
                ? "Working tree clean"
                : "No changes match the filter"
            }
            hint={
              (status?.changes.length ?? 0) === 0
                ? "No edits, additions, deletions, or renames. Nothing to prepare."
                : undefined
            }
          />
        )}
        {!error &&
          visible.map((c) => {
            const assigned = assignedFiles.get(c.path);
            return (
              <ChangeRow
                key={c.path}
                change={c}
                selected={selected.has(c.path)}
                assigned={assigned ?? null}
                onToggle={() => {
                  if (!assigned) onToggle(c.path);
                }}
                onClickAssigned={() => {
                  if (assigned) onSelectAssignedDraft(assigned.item_id);
                }}
              />
            );
          })}
      </div>
    </div>
  );
}

function ChangeRow({
  change,
  selected,
  assigned,
  onToggle,
  onClickAssigned,
}: {
  change: Change;
  selected: boolean;
  assigned: AssignedFile | null;
  onToggle: () => void;
  onClickAssigned: () => void;
}) {
  const meta = TYPE_META[change.change_type];
  const Icon = meta.icon;
  const isAssigned = assigned != null;

  return (
    <div
      onClick={isAssigned ? onClickAssigned : onToggle}
      className={`flex cursor-pointer items-center gap-3 border-b border-[var(--color-border)] px-4 py-1.5 hover:bg-[var(--color-surface)] ${
        selected ? "bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]" : ""
      } ${isAssigned ? "opacity-60" : ""}`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          isAssigned
            ? "border-[var(--color-faint)] bg-[var(--color-surface-2)]"
            : selected
            ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
            : "border-[var(--color-border-strong)]"
        }`}
      >
        {isAssigned ? (
          <Lock className="h-2.5 w-2.5 text-[var(--color-faint)]" />
        ) : selected ? (
          <Check className="h-3 w-3" strokeWidth={3} />
        ) : null}
      </span>
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} style={{ color: meta.color }} />
      <span className="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-xs">
        {change.directory && (
          <span className="text-[var(--color-faint)]">{change.directory}/</span>
        )}
        <span className="text-[var(--color-text)]">{change.filename}</span>
        {change.original_path && (
          <span className="text-[var(--color-faint)]"> ← {change.original_path}</span>
        )}
      </span>
      {isAssigned && (
        <span
          className="shrink-0 text-[10px] text-[var(--color-accent)] cursor-pointer hover:underline"
          title={`Assigned to: ${assigned.commit_message}`}
        >
          assigned
        </span>
      )}
      {change.staged && (
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--color-faint)]">
          staged
        </span>
      )}
      <span className="shrink-0 text-[11px]" style={{ color: meta.color }}>
        {meta.label}
      </span>
    </div>
  );
}

function FilterTab({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-[var(--radius-control)] px-2 py-1 transition-colors duration-150 ${
        active
          ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
          : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
      }`}
    >
      {children}
    </button>
  );
}
