import { useEffect, useMemo, useState } from "react";
import {
  ScrollText,
  Search,
  CheckCircle2,
  XCircle,
  CalendarClock,
  RotateCcw,
  FolderGit2,
  Sliders,
  Terminal,
  Copy,
  Check,
  Zap,
  FilePlus,
  FilePen,
  ArrowUpRight,
  Info,
} from "lucide-react";
import { api, type ActivityEvent, type Repository } from "../lib/ipc";
import { EmptyState, Badge, Button, Mono } from "./ui";

type MainTab = "timeline" | "logs";
type CategoryFilter = "all" | "scheduled" | "executed" | "failed" | "skipped" | "system";

const INTERNAL_EVENT_TYPES = new Set([
  "execution_started",
  "staging_started",
  "staged_verified",
  "preflight_passed",
  "commit_created",
  "db_save",
  "lock_acquired",
]);

interface EventCategory {
  title: string;
  icon: typeof Info;
  badgeVariant: "default" | "ok" | "warn" | "danger" | "accent" | "faint";
  categoryGroup: "scheduled" | "executed" | "failed" | "skipped" | "system";
}

function getEventCategory(event: ActivityEvent): EventCategory {
  const type = event.event_type?.toLowerCase() || "";
  const msg = event.message?.toLowerCase() || "";
  const level = event.level?.toLowerCase() || "";

  if (level === "error" || type.includes("failed") || msg.includes("failed") || msg.includes("error")) {
    return { title: "Execution Failed", icon: XCircle, badgeVariant: "danger", categoryGroup: "failed" };
  }
  if (type.includes("push") || msg.includes("pushed")) {
    return { title: "Push Completed", icon: ArrowUpRight, badgeVariant: "ok", categoryGroup: "executed" };
  }
  if (type.includes("executed") || type.includes("commit_executed") || msg.includes("executed")) {
    return { title: "Commit Executed", icon: CheckCircle2, badgeVariant: "ok", categoryGroup: "executed" };
  }
  if (type.includes("scheduled") || msg.includes("scheduled")) {
    return { title: "Commit Scheduled", icon: CalendarClock, badgeVariant: "accent", categoryGroup: "scheduled" };
  }
  if (type.includes("rescheduled") || msg.includes("rescheduled")) {
    return { title: "Commit Rescheduled", icon: RotateCcw, badgeVariant: "warn", categoryGroup: "scheduled" };
  }
  if (type.includes("skipped") || msg.includes("skipped")) {
    return { title: "Commit Skipped", icon: RotateCcw, badgeVariant: "warn", categoryGroup: "skipped" };
  }
  if (type.includes("repo_add") || msg.includes("added repository") || msg.includes("add_repository")) {
    return { title: "Repository Added", icon: FolderGit2, badgeVariant: "default", categoryGroup: "system" };
  }
  if (type.includes("repo_remove") || msg.includes("removed repository")) {
    return { title: "Repository Removed", icon: FolderGit2, badgeVariant: "danger", categoryGroup: "system" };
  }
  if (type.includes("draft_create") || msg.includes("created draft")) {
    return { title: "Draft Created", icon: FilePlus, badgeVariant: "default", categoryGroup: "system" };
  }
  if (type.includes("draft_edit") || msg.includes("updated draft")) {
    return { title: "Draft Edited", icon: FilePen, badgeVariant: "default", categoryGroup: "system" };
  }
  if (type.includes("settings") || msg.includes("settings")) {
    return { title: "Settings Changed", icon: Sliders, badgeVariant: "faint", categoryGroup: "system" };
  }

  return { title: event.event_type || "System Activity", icon: Zap, badgeVariant: "default", categoryGroup: "system" };
}

function getDateGroup(epoch: number): string {
  const date = new Date(epoch * 1000);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastWeek = new Date(today);
  lastWeek.setDate(lastWeek.getDate() - 7);

  if (date >= today) return "Today";
  if (date >= yesterday) return "Yesterday";
  if (date >= lastWeek) return "Last 7 Days";
  return "Older";
}

export function ActivityView() {
  const [activeTab, setActiveTab] = useState<MainTab>("timeline");
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [logsLevelFilter, setLogsLevelFilter] = useState<string>("all");
  const [copiedLogs, setCopiedLogs] = useState(false);

  useEffect(() => {
    Promise.all([api.listActivityEvents(300), api.listRepositories()])
      .then(([evs, repos]) => {
        setEvents(evs);
        setRepositories(repos);
      })
      .catch(() => {
        setEvents([]);
        setRepositories([]);
      });
  }, []);

  const repoMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of repositories) map.set(r.id, r.name);
    return map;
  }, [repositories]);

  // Filter high-level timeline events (hiding low-level internal steps)
  const timelineEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return events.filter((e) => {
      const type = e.event_type?.toLowerCase() || "";
      if (INTERNAL_EVENT_TYPES.has(type)) return false;

      const cat = getEventCategory(e);
      if (categoryFilter !== "all" && cat.categoryGroup !== categoryFilter) {
        return false;
      }

      if (q) {
        const repoName = e.repository_id ? repoMap.get(e.repository_id) || "" : "";
        const matchRepo = repoName.toLowerCase().includes(q);
        const matchMsg = (e.commit_message || "").toLowerCase().includes(q) || e.message.toLowerCase().includes(q);
        const matchHash = (e.commit_hash || "").toLowerCase().includes(q);
        const matchDate = new Date(e.ts * 1000).toLocaleDateString().includes(q);
        return matchRepo || matchMsg || matchHash || matchDate;
      }

      return true;
    });
  }, [events, searchQuery, categoryFilter, repoMap]);

  // Group timeline events by date
  const groupedTimeline = useMemo(() => {
    const map = new Map<string, ActivityEvent[]>();
    for (const e of timelineEvents) {
      const group = getDateGroup(e.ts);
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(e);
    }
    return map;
  }, [timelineEvents]);

  // Filtered raw logs for System Logs tab
  const rawLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return events.filter((e) => {
      if (logsLevelFilter !== "all" && e.level.toLowerCase() !== logsLevelFilter) {
        return false;
      }
      if (q) {
        return (
          e.message.toLowerCase().includes(q) ||
          (e.event_type || "").toLowerCase().includes(q) ||
          (e.commit_message || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [events, searchQuery, logsLevelFilter]);

  const handleCopyLogs = () => {
    const text = rawLogs
      .map((e) => `[${new Date(e.ts * 1000).toISOString()}] [${e.level.toUpperCase()}] ${e.event_type}: ${e.message}`)
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopiedLogs(true);
    setTimeout(() => setCopiedLogs(false), 1200);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-bg)] select-none">
      {/* Header & Sub-navigation Tabs */}
      <header className="flex shrink-0 flex-wrap items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5 bg-[var(--color-surface)] gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab("timeline")}
            className={`flex items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-1.5 text-xs font-semibold transition-all duration-150 cursor-pointer ${
              activeTab === "timeline"
                ? "bg-[var(--color-surface-2)] text-[var(--color-text)] border border-[var(--color-border-strong)] shadow-sm"
                : "text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
            }`}
          >
            <ScrollText className={`h-3.5 w-3.5 ${activeTab === "timeline" ? "text-[var(--color-accent)]" : ""}`} />
            Activity Timeline
          </button>
          <button
            onClick={() => setActiveTab("logs")}
            className={`flex items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-1.5 text-xs font-semibold transition-all duration-150 cursor-pointer ${
              activeTab === "logs"
                ? "bg-[var(--color-surface-2)] text-[var(--color-text)] border border-[var(--color-border-strong)] shadow-sm"
                : "text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
            }`}
          >
            <Terminal className={`h-3.5 w-3.5 ${activeTab === "logs" ? "text-[var(--color-accent)]" : ""}`} />
            System Logs
          </button>
        </div>

        {/* Global Search */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-[var(--color-faint)]" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={activeTab === "timeline" ? "Search activity (repo, message, hash)..." : "Search log entries..."}
            className="w-64 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] py-1 pl-8 pr-3 text-xs outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-border-strong)]"
          />
        </div>
      </header>

      {/* Main Content Area */}
      {activeTab === "timeline" ? (
        <div className="flex flex-1 flex-col min-h-0">
          {/* Category Filter Pills */}
          <div className="flex shrink-0 items-center gap-1 border-b border-[var(--color-border)] px-4 py-2 text-xs bg-[var(--color-surface)]">
            {(
              [
                { id: "all", label: "All Events" },
                { id: "scheduled", label: "Scheduled" },
                { id: "executed", label: "Executed" },
                { id: "failed", label: "Failed" },
                { id: "skipped", label: "Skipped" },
                { id: "system", label: "System" },
              ] as const
            ).map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setCategoryFilter(id)}
                className={`rounded-[var(--radius-control)] px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                  categoryFilter === id
                    ? "bg-[var(--color-surface-2)] text-[var(--color-text)] font-semibold border border-[var(--color-border-strong)]"
                    : "text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
                }`}
              >
                {label}
              </button>
            ))}
            <span className="ml-auto text-[11px] text-[var(--color-faint)]">
              {timelineEvents.length} {timelineEvents.length === 1 ? "event" : "events"}
            </span>
          </div>

          {/* Timeline Stream */}
          <div className="flex-1 overflow-y-auto p-4 pb-20">
            {timelineEvents.length === 0 ? (
              <EmptyState
                icon={ScrollText}
                title="No matching activity events"
                hint="Key actions like creating draft commits, scheduling, and pushes will appear on this timeline."
              />
            ) : (
              <div className="max-w-3xl mx-auto flex flex-col gap-6">
                {["Today", "Yesterday", "Last 7 Days", "Older"].map((groupName) => {
                  const groupItems = groupedTimeline.get(groupName);
                  if (!groupItems || groupItems.length === 0) return null;

                  return (
                    <div key={groupName} className="animate-fadeIn">
                      <div className="sticky top-0 z-10 mb-3 border-b border-[var(--color-border)] bg-[var(--color-bg)] pb-1 text-[11px] font-bold uppercase tracking-wider text-[var(--color-faint)]">
                        {groupName}
                      </div>
                      <div className="flex flex-col gap-2.5">
                        {groupItems.map((event) => {
                          const cat = getEventCategory(event);
                          const Icon = cat.icon;
                          const repoName = event.repository_id ? repoMap.get(event.repository_id) : null;
                          const timeStr = new Date(event.ts * 1000).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          });

                          return (
                            <div
                              key={event.id}
                              className="group flex items-start gap-3 rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm hover:border-[var(--color-border-strong)] transition-all"
                            >
                              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)]">
                                <Icon className="h-4 w-4 text-[var(--color-accent)]" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold text-[var(--color-text)]">{cat.title}</span>
                                  <Badge variant={cat.badgeVariant}>{event.event_type || cat.title}</Badge>
                                  {repoName && (
                                    <span className="text-[10px] text-[var(--color-muted)] font-semibold bg-[var(--color-surface-2)] border border-[var(--color-border)] px-1.5 py-0.5 rounded">
                                      {repoName}
                                    </span>
                                  )}
                                  <span className="ml-auto text-[10px] text-[var(--color-faint)]">{timeStr}</span>
                                </div>
                                <p className="mt-1 text-xs text-[var(--color-text)] font-sans leading-snug">
                                  {event.commit_message || event.message}
                                </p>
                                {event.commit_message && event.message !== event.commit_message && (
                                  <p className="mt-0.5 text-[11px] text-[var(--color-muted)] font-[family-name:var(--font-mono)] truncate">
                                    {event.message}
                                  </p>
                                )}
                                {event.commit_hash && (
                                  <div className="mt-2 flex items-center gap-1.5 text-[10px]">
                                    <span className="text-[var(--color-faint)]">Commit:</span>
                                    <Mono className="text-[var(--color-accent)] font-semibold">{event.commit_hash.slice(0, 7)}</Mono>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Low-Level System Logs Tab */
        <div className="flex flex-1 flex-col min-h-0 animate-fadeIn">
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-2 bg-[var(--color-surface)]">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[var(--color-faint)] font-semibold">Level:</span>
              {["all", "info", "warning", "error"].map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setLogsLevelFilter(lvl)}
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase cursor-pointer ${
                    logsLevelFilter === lvl
                      ? "bg-[var(--color-surface-2)] text-[var(--color-text)] border border-[var(--color-border-strong)]"
                      : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
            <Button variant="default" onClick={handleCopyLogs}>
              {copiedLogs ? <Check className="h-3.5 w-3.5 text-[var(--color-ok)]" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedLogs ? "Copied!" : "Copy Logs"}
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 pb-20 font-[family-name:var(--font-mono)] text-[11px] bg-[var(--color-bg)]">
            {rawLogs.length === 0 ? (
              <div className="p-8 text-center text-xs text-[var(--color-faint)]">No low-level logs recorded.</div>
            ) : (
              <div className="flex flex-col gap-1">
                {rawLogs.map((log) => {
                  const time = new Date(log.ts * 1000).toISOString();
                  const lvlColor =
                    log.level === "error"
                      ? "text-[var(--color-danger)]"
                      : log.level === "warning"
                      ? "text-[var(--color-warn)]"
                      : "text-[var(--color-accent)]";

                  return (
                    <div key={log.id} className="flex items-start gap-2 hover:bg-[var(--color-surface)] p-1 rounded">
                      <span className="text-[var(--color-faint)] shrink-0">[{time}]</span>
                      <span className={`font-bold shrink-0 uppercase w-12 ${lvlColor}`}>[{log.level}]</span>
                      <span className="text-[var(--color-text)] break-all">{log.event_type}: {log.message}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
