import { useCallback, useEffect, useState, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  CalendarClock,
  ListChecks,
  ScrollText,
  Settings as SettingsIcon,
  FolderGit2,
  AlertTriangle,
  Info,
  FileText,
} from "lucide-react";
import { api, type Repository, type QueueItem, type Template } from "../lib/ipc";
import { switchRepo } from "../lib/selection";
import { LeftRail, type GlobalView } from "../components/LeftRail";
import { GitCheckScreen } from "../components/GitCheckScreen";
import { RepoView } from "../components/RepoView";
import { SettingsView } from "../components/SettingsView";
import { ActivityView } from "../components/ActivityView";
import { EmptyState, Button } from "../components/ui";

const ONBOARDED_KEY = "gitoutbox.onboarded";

type View = GlobalView | "repo";

function getTodayRange(): { from: number; to: number } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: Math.floor(start.getTime() / 1000), to: Math.floor(end.getTime() / 1000) };
}

export default function App() {
  const [onboarded, setOnboarded] = useState(
    () => localStorage.getItem(ONBOARDED_KEY) === "1"
  );
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [view, setView] = useState<View>("today");
  const [repoId, setRepoId] = useState<number | null>(null);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addError, setAddError] = useState<string | null>(null);
  const [addNotice, setAddNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [repoToRemove, setRepoToRemove] = useState<{ id: number; name: string; draftCount: number; scheduledCount: number } | null>(null);

  // Today / All Queues state
  const [todayItems, setTodayItems] = useState<QueueItem[]>([]);
  const [allScheduledItems, setAllScheduledItems] = useState<QueueItem[]>([]);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const pausedCount = allScheduledItems.filter((i) => i.status === "Paused").length;

  // Auto-dismiss transient notices after 6 seconds.
  useEffect(() => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    if (addNotice) {
      noticeTimerRef.current = setTimeout(() => setAddNotice(null), 6000);
    }
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, [addNotice]);

  const loadQueueItems = useCallback(() => {
    if (repoId == null) {
      setQueueItems([]);
      return;
    }
    api
      .listQueueItems(repoId)
      .then(setQueueItems)
      .catch(() => setQueueItems([]));
  }, [repoId]);

  useEffect(loadQueueItems, [loadQueueItems]);

  const refreshRepos = useCallback(() => {
    api
      .listRepositories()
      .then(setRepositories)
      .catch(() => setRepositories([]));
  }, []);

  const refreshTemplates = useCallback(() => {
    api.listTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  const loadTodayItems = useCallback(() => {
    const { from, to } = getTodayRange();
    api.listAllScheduledItems(from, to).then(setTodayItems).catch(() => setTodayItems([]));
  }, []);

  const loadAllScheduledItems = useCallback(() => {
    api.listAllScheduledItems().then(setAllScheduledItems).catch(() => setAllScheduledItems([]));
  }, []);

  useEffect(() => {
    if (onboarded) {
      const id = setTimeout(() => {
        refreshRepos();
        refreshTemplates();
        loadTodayItems();
        loadAllScheduledItems();
      }, 0);
      return () => clearTimeout(id);
    }
  }, [onboarded, refreshRepos, refreshTemplates, loadTodayItems, loadAllScheduledItems]);

  const completeOnboarding = () => {
    localStorage.setItem(ONBOARDED_KEY, "1");
    setOnboarded(true);
  };

  const switchToRepo = useCallback((id: number) => {
    setSelected((prev) => switchRepo({ repoId, selected: prev }, id).selected);
    setRepoId(id);
    setView("repo");
  }, [repoId]);

  const handleReviewPaused = useCallback(() => {
    const firstPaused = allScheduledItems.find((i) => i.status === "Paused");
    if (firstPaused) {
      switchToRepo(firstPaused.queue_id);
    }
  }, [allScheduledItems, switchToRepo]);

  const addRepository = useCallback(async () => {
    setAddError(null);
    setAddNotice(null);
    try {
      const picked = await open({ directory: true, multiple: false, title: "Add local repository" });
      if (typeof picked !== "string") return;
      const result = await api.addRepository(picked);
      refreshRepos();
      switchToRepo(result.repository.id);
      if (result.already_exists) {
        setAddNotice(`"${result.repository.name}" is already added.`);
      }
    } catch (e) {
      setAddError(String(e));
    }
  }, [refreshRepos, switchToRepo]);

  const handleRefreshRepo = useCallback((id: number) => {
    if (repoId === id) {
      loadQueueItems();
    }
  }, [repoId, loadQueueItems]);

  const handleOpenInExplorer = useCallback(async (path: string) => {
    try {
      await api.openInExplorer(path);
    } catch (e) {
      setAddError(String(e));
    }
  }, []);

  const handleRemoveRepoInit = useCallback(async (id: number, name: string) => {
    try {
      const draftCount = await api.countDraftItems(id);
      const scheduledCount = await api.countScheduledItems(id);
      setRepoToRemove({ id, name, draftCount, scheduledCount });
    } catch {
      setRepoToRemove({ id, name, draftCount: 0, scheduledCount: 0 });
    }
  }, []);

  const handleRemoveRepoConfirm = useCallback(async () => {
    if (!repoToRemove) return;
    try {
      await api.removeRepository(repoToRemove.id);
      if (repoId === repoToRemove.id) {
        setRepoId(null);
        setView("today");
        setSelected(new Set());
      }
      refreshRepos();
      loadTodayItems();
      loadAllScheduledItems();
    } catch (e) {
      setAddError(String(e));
    }
    setRepoToRemove(null);
  }, [repoToRemove, repoId, refreshRepos, loadTodayItems, loadAllScheduledItems]);

  if (!onboarded) {
    return (
      <div className="h-screen bg-[var(--color-bg)]">
        <GitCheckScreen onContinue={completeOnboarding} />
      </div>
    );
  }

  const activeRepo = repoId != null ? repositories.find((r) => r.id === repoId) ?? null : null;

  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      <LeftRail
        view={view}
        repoId={repoId}
        repositories={repositories}
        onSelectView={(v) => setView(v)}
        onSelectRepo={switchToRepo}
        onAddRepo={addRepository}
        onRefreshRepo={handleRefreshRepo}
        onOpenInExplorer={handleOpenInExplorer}
        onRemoveRepo={handleRemoveRepoInit}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        {pausedCount > 0 && !bannerDismissed && (
          <div className="flex w-full items-center justify-between border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-warn)_10%,transparent)] px-4 py-2.5 text-xs text-[var(--color-warn)]">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--color-warn)]" />
              <div>
                <span className="font-semibold">GitOutbox needs your attention. </span>
                <span>{pausedCount} scheduled commit{pausedCount === 1 ? "" : "s"} require{pausedCount === 1 ? "s" : ""} recovery.</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="primary" onClick={handleReviewPaused}>
                Review
              </Button>
              <button
                onClick={() => setBannerDismissed(true)}
                className="rounded-[var(--radius-control)] px-2 py-1 text-[var(--color-muted)] hover:text-[var(--color-text)] font-medium cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
        {addError && (
          <button
            onClick={() => setAddError(null)}
            className="flex w-full items-center gap-2 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] px-4 py-2 text-xs text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_15%,transparent)] text-left"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" /> <span className="flex-1">{addError}</span>
            <span className="text-[10px] opacity-60 uppercase tracking-wider">Dismiss</span>
          </button>
        )}
        {addNotice && (
          <button
            onClick={() => setAddNotice(null)}
            className="flex w-full items-center gap-2 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] px-4 py-2 text-xs text-[var(--color-accent)] hover:bg-[color-mix(in_srgb,var(--color-accent)_15%,transparent)]"
          >
            <Info className="h-4 w-4" /> {addNotice}
          </button>
        )}
        <div className="min-h-0 flex-1">
          {view === "repo" && activeRepo ? (
            <RepoView
              key={activeRepo.id}
              repo={activeRepo}
              queueItems={queueItems}
              selected={selected}
              onSelectionChange={setSelected}
              onQueueChanged={() => { loadQueueItems(); loadTodayItems(); loadAllScheduledItems(); }}
              templates={templates}
            />
          ) : view === "settings" ? (
            <SettingsView
              templates={templates}
              onRefresh={refreshTemplates}
              onCreate={async (name, template) => { await api.createTemplate(name, template); }}
              onUpdate={async (name, template) => { await api.updateTemplate(name, template); }}
              onDuplicate={async (sourceName) => { await api.duplicateTemplate(sourceName); }}
              onDelete={async (name) => { await api.deleteTemplate(name); }}
            />
          ) : view === "today" ? (
            <TodayView items={todayItems} repositories={repositories} />
          ) : view === "queues" ? (
            <AllQueuesView items={allScheduledItems} repositories={repositories} />
          ) : view === "activity" ? (
            <ActivityView />
          ) : (
            <Placeholder view={view} onAddRepo={addRepository} hasRepos={repositories.length > 0} />
          )}
        </div>
      </main>

      {/* Repository removal confirmation dialog */}
      {repoToRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setRepoToRemove(null)}>
          <div
            className="w-full max-w-sm rounded-[var(--radius-dialog)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3">
              <h3 className="text-sm font-medium">Remove {repoToRemove.name}?</h3>
              {repoToRemove.draftCount > 0 || repoToRemove.scheduledCount > 0 ? (
                <p className="mt-2 text-xs text-[var(--color-muted)] font-sans leading-normal">
                  {repoToRemove.draftCount > 0 && `${repoToRemove.draftCount} draft commit${repoToRemove.draftCount === 1 ? "" : "s"}`}
                  {repoToRemove.draftCount > 0 && repoToRemove.scheduledCount > 0 && " and "}
                  {repoToRemove.scheduledCount > 0 && `${repoToRemove.scheduledCount} scheduled commit${repoToRemove.scheduledCount === 1 ? "" : "s"}`}
                  {" will also be removed from GitOutbox. Your local repository and Git history will not be changed."}
                </p>
              ) : (
                <p className="mt-2 text-xs text-[var(--color-muted)] font-sans leading-normal">
                  The local repository will not be deleted. Only the GitOutbox entry is removed.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-4 py-3">
              <Button variant="ghost" onClick={() => setRepoToRemove(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleRemoveRepoConfirm}>
                Remove
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TodayView({ items, repositories }: { items: QueueItem[]; repositories: Repository[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Nothing scheduled today"
        hint="Select a repository, create draft commits, and schedule them."
      />
    );
  }

  // Group by hour for a timeline view.
  const grouped = new Map<string, QueueItem[]>();
  for (const item of items) {
    if (!item.scheduled_time) continue;
    const d = new Date(item.scheduled_time * 1000);
    const hour = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (!grouped.has(hour)) grouped.set(hour, []);
    grouped.get(hour)!.push(item);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-2.5">
        <CalendarClock className="h-4 w-4 text-[var(--color-muted)]" strokeWidth={1.75} />
        <span className="text-sm font-medium">Today</span>
        <span className="ml-auto text-[11px] text-[var(--color-faint)]">
          {items.length} scheduled
        </span>
      </header>
      <div className="flex-1 overflow-y-auto">
        {[...grouped.entries()].map(([time, timeItems]) => (
          <div key={time}>
            <div className="sticky top-0 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-1.5 font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-muted)]">
              {time}
            </div>
            {timeItems.map((item) => {
              const repo = repositories.find((r) => r.id === item.queue_id);
              return (
                <div key={item.id} className="flex items-start gap-3 border-b border-[var(--color-border)] px-4 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-[family-name:var(--font-mono)] text-xs text-[var(--color-text)]">
                      {item.commit_message || <span className="text-[var(--color-faint)]">No message</span>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--color-faint)]">
                      <FileText className="h-3 w-3" />
                      {item.files.length} {item.files.length === 1 ? "file" : "files"}
                      {repo && (
                        <>
                          <span className="text-[var(--color-border-strong)]">·</span>
                          {repo.name}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function AllQueuesView({ items, repositories }: { items: QueueItem[]; repositories: Repository[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No scheduled items"
        hint="Schedule draft commits from any repository to see them here."
      />
    );
  }

  // Group by date.
  const grouped = new Map<string, QueueItem[]>();
  for (const item of items) {
    if (!item.scheduled_time) continue;
    const d = new Date(item.scheduled_time * 1000);
    const date = d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date)!.push(item);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-2.5">
        <ListChecks className="h-4 w-4 text-[var(--color-muted)]" strokeWidth={1.75} />
        <span className="text-sm font-medium">All Queues</span>
        <span className="ml-auto text-[11px] text-[var(--color-faint)]">
          {items.length} scheduled
        </span>
      </header>
      <div className="flex-1 overflow-y-auto">
        {[...grouped.entries()].map(([date, dateItems]) => (
          <div key={date}>
            <div className="sticky top-0 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-1.5 text-[11px] font-medium text-[var(--color-muted)]">
              {date}
            </div>
            {dateItems.map((item) => {
              const time = item.scheduled_time
                ? new Date(item.scheduled_time * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                : "";
              const repo = repositories.find((r) => r.id === item.queue_id);
              return (
                <div key={item.id} className="flex items-start gap-3 border-b border-[var(--color-border)] px-4 py-2">
                  <span className="shrink-0 w-14 text-right font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-faint)]">
                    {time}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-[family-name:var(--font-mono)] text-xs text-[var(--color-text)]">
                      {item.commit_message || <span className="text-[var(--color-faint)]">No message</span>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--color-faint)]">
                      <FileText className="h-3 w-3" />
                      {item.files.length} {item.files.length === 1 ? "file" : "files"}
                      {repo && (
                        <>
                          <span className="text-[var(--color-border-strong)]">·</span>
                          {repo.name}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function Placeholder({
  view,
  onAddRepo,
  hasRepos,
}: {
  view: View;
  onAddRepo: () => void;
  hasRepos: boolean;
}) {
  if (view === "today") {
    return hasRepos ? (
      <EmptyState
        icon={CalendarClock}
        title="Nothing scheduled today"
        hint="Select a repository, create draft commits, and schedule them."
      />
    ) : (
      <EmptyState
        icon={FolderGit2}
        title="Add a repository to get started"
        hint="GitOutbox inspects a local Git repository and shows every change so you can prepare commits now and ship them on your schedule."
        action={
          <Button variant="primary" onClick={onAddRepo}>
            Add repository
          </Button>
        }
      />
    );
  }
  const map = {
    queues: { icon: ListChecks, title: "No queues yet", hint: "Scheduled commit queues will appear here." },
    activity: { icon: ScrollText, title: "No activity yet", hint: "Every scheduled operation will be logged here." },
    settings: { icon: SettingsIcon, title: "Settings", hint: "Template management and missed-schedule policy." },
  } as const;
  const m = map[view as keyof typeof map] ?? map.settings;
  return <EmptyState icon={m.icon} title={m.title} hint={m.hint} />;
}
