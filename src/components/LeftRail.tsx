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
  FileText,
  Copy,
  Check,
} from "lucide-react";
import type { Repository } from "../lib/ipc";
import { brand } from "../lib/brand";

export type GlobalView = "today" | "queues" | "templates" | "activity" | "settings";

const NAV: { id: GlobalView; label: string; icon: typeof CalendarClock }[] = [
  { id: "today", label: "Today", icon: CalendarClock },
  { id: "queues", label: "All Queues", icon: ListChecks },
  { id: "templates", label: "Templates", icon: FileText },
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
  const [copied, setCopied] = useState(false);
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

  const copyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
      setContextMenu(null);
    }, 800);
  };

  return (
    <nav className="flex w-56 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] select-none">
      {/* App Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--color-border)] mb-2">
        <img src={brand.appIcon} className="h-5 w-5 object-contain" alt="GitOutbox Icon" />
        <span className="text-xs font-bold tracking-wide text-[var(--color-text)] font-[family-name:var(--font-mono)]">
          GitOutbox
        </span>
        <span className="ml-auto rounded-full bg-[var(--color-surface-2)] border border-[var(--color-border)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--color-faint)]">
          v0.2.0
        </span>
      </div>

      {/* Primary Global Navigation */}
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

      {/* Repositories Section */}
      <div className="mt-5 flex items-center justify-between px-4 pb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-faint)]">
          Repositories
        </span>
        <button
          onClick={onAddRepo}
          className="rounded p-0.5 text-[var(--color-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
          title="Add repository"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2">
        {repositories.length === 0 && (
          <div className="px-3 py-3 text-center text-xs text-[var(--color-faint)] italic">
            No repositories added
          </div>
        )}
        {repositories.map((r) => (
          <div key={r.id} className="group relative flex items-center">
            <RailItem
              active={view === "repo" && repoId === r.id}
              icon={<FolderGit2 className="h-4 w-4" strokeWidth={1.75} />}
              label={r.name}
              title={r.path}
              onClick={() => onSelectRepo(r.id)}
              onContextMenu={(e) => handleContextMenu(e, r)}
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setContextMenu({ repoId: r.id, repoName: r.name, repoPath: r.path, x: rect.right, y: rect.top });
              }}
              className="absolute right-1.5 rounded p-1 opacity-0 group-hover:opacity-100 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] transition-all cursor-pointer"
              title="Repository options"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Bottom Rail Actions */}
      <div className="border-t border-[var(--color-border)] p-2 flex flex-col gap-0.5">
        <RailItem
          icon={<Plus className="h-4 w-4" strokeWidth={1.75} />}
          label="Add Repository"
          onClick={onAddRepo}
        />
        <RailItem
          active={view === "settings"}
          icon={<Settings className="h-4 w-4" strokeWidth={1.75} />}
          label="Settings"
          onClick={() => onSelectView("settings")}
        />
      </div>

      {/* Repository Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[170px] rounded-[var(--radius-dialog)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-2xl animate-fadeIn"
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
            icon={copied ? <Check className="h-3.5 w-3.5 text-[var(--color-ok)]" /> : <Copy className="h-3.5 w-3.5" />}
            label={copied ? "Path Copied!" : "Copy Path"}
            onClick={() => copyPath(contextMenu.repoPath)}
          />
          <ContextMenuItem
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            label="Refresh Status"
            onClick={() => {
              onRefreshRepo(contextMenu.repoId);
              setContextMenu(null);
            }}
          />
          <div className="my-1 border-t border-[var(--color-border)]" />
          <ContextMenuItem
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="Remove Repository"
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
  title,
  active,
  onClick,
  onContextMenu,
}: {
  icon: React.ReactNode;
  label: string;
  title?: string;
  active?: boolean;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title}
      className={`relative flex w-full items-center gap-2.5 truncate rounded-[var(--radius-control)] px-3 py-1.5 text-left text-xs transition-all duration-150 cursor-pointer ${
        active
          ? "bg-[var(--color-surface-2)] text-[var(--color-text)] font-semibold"
          : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-3.5 w-1 rounded-r bg-[var(--color-accent)]" />
      )}
      <span className={active ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]"}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function ContextMenuItem({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors cursor-pointer ${
        danger
          ? "text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_15%,transparent)]"
          : "text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
