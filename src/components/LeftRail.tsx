import { useState, useRef, useEffect } from "react";
import {
  CalendarClock,
  ListChecks,
  ScrollText,
  Settings,
  Plus,
  FolderGit2,
  MoreVertical,
  RefreshCw,
  FolderOpen,
  Trash2,
} from "lucide-react";
import type { Repository } from "../lib/ipc";
import { brand } from "../lib/brand";

export type GlobalView = "today" | "queues" | "activity" | "settings";

const NAV: { id: GlobalView; label: string; icon: typeof CalendarClock }[] = [
  { id: "today", label: "Today", icon: CalendarClock },
  { id: "queues", label: "All Queues", icon: ListChecks },
  { id: "activity", label: "Activity", icon: ScrollText },
];

export function LeftRail({
  view,
  repoId,
  onSelectView,
  onSelectRepo,
  onAddRepo,
  onRefreshRepo,
  onOpenInExplorer,
  onRemoveRepo,
  repositories,
}: {
  view: GlobalView | "repo";
  repoId: number | null;
  onSelectView: (v: GlobalView) => void;
  onSelectRepo: (id: number) => void;
  onAddRepo: () => void;
  onRefreshRepo: (id: number) => void;
  onOpenInExplorer: (path: string) => void;
  onRemoveRepo: (id: number, name: string) => void;
  repositories: Repository[];
}) {
  const [contextMenu, setContextMenu] = useState<{ repoId: number; repoName: string; repoPath: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [contextMenu]);

  const handleContextMenu = (e: React.MouseEvent, repo: Repository) => {
    e.preventDefault();
    setContextMenu({ repoId: repo.id, repoName: repo.name, repoPath: repo.path, x: e.clientX, y: e.clientY });
  };

  return (
    <nav className="flex w-56 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center px-4 py-3">
        <img src={brand.horizontalLogo} className="h-6 object-contain" alt="GitOutbox" />
      </div>

      <div className="flex flex-col gap-0.5 px-2">
        {NAV.map(({ id, label, icon: Icon }) => (
          <RailItem
            key={id}
            active={view === id}
            icon={<Icon className="h-4 w-4" strokeWidth={1.75} />}
            label={label}
            onClick={() => onSelectView(id)}
          />
        ))}
      </div>

      <div className="mt-5 px-4 pb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-faint)]">
        Repositories
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2">
        {repositories.length === 0 && (
          <div className="px-3 py-1.5 text-xs text-[var(--color-faint)]">
            None added yet
          </div>
        )}
        {repositories.map((r) => (
          <div key={r.id} className="group relative flex items-center">
            <RailItem
              active={view === "repo" && repoId === r.id}
              icon={<FolderGit2 className="h-4 w-4" strokeWidth={1.75} />}
              label={r.name}
              onClick={() => onSelectRepo(r.id)}
              onContextMenu={(e) => handleContextMenu(e, r)}
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setContextMenu({ repoId: r.id, repoName: r.name, repoPath: r.path, x: rect.right, y: rect.top });
              }}
              className="absolute right-1 rounded p-0.5 opacity-0 group-hover:opacity-100 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] transition-opacity"
              title="Repository actions"
            >
              <MoreVertical className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      <div className="border-t border-[var(--color-border)] p-2">
        <RailItem
          icon={<Plus className="h-4 w-4" strokeWidth={1.75} />}
          label="Add repository"
          onClick={onAddRepo}
        />
        <RailItem
          active={view === "settings"}
          icon={<Settings className="h-4 w-4" strokeWidth={1.75} />}
          label="Settings"
          onClick={() => onSelectView("settings")}
        />
      </div>

      {/* Context menu portal */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[160px] rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <ContextMenuItem
            icon={<FolderOpen className="h-3.5 w-3.5" />}
            label="Open in Explorer"
            onClick={() => {
              onOpenInExplorer(contextMenu.repoPath);
              setContextMenu(null);
            }}
          />
          <ContextMenuItem
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            label="Refresh"
            onClick={() => {
              onRefreshRepo(contextMenu.repoId);
              setContextMenu(null);
            }}
          />
          <div className="my-1 border-t border-[var(--color-border)]" />
          <ContextMenuItem
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="Remove from GitOutbox"
            danger
            onClick={() => {
              onRemoveRepo(contextMenu.repoId, contextMenu.repoName);
              setContextMenu(null);
            }}
          />
        </div>
      )}
    </nav>
  );
}

function RailItem({
  icon,
  label,
  active,
  onClick,
  onContextMenu,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`flex w-full items-center gap-2.5 truncate rounded-[var(--radius-control)] px-3 py-1.5 text-left text-xs transition-colors duration-150 ${
        active
          ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
          : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
      }`}
    >
      <span className={active ? "text-[var(--color-accent)]" : ""}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function ContextMenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs ${
        danger
          ? "text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)]"
          : "text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
