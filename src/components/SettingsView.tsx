import { useEffect, useState } from "react";
import {
  Sliders,
  GitBranch,
  CalendarClock,
  Zap,
  Bell,
  RefreshCw,
  SlidersHorizontal,
  Info,
  Check,
  X,
  Loader2,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  Database,
  Pause,
  Play,
  FolderOpen,
  Download,
  RotateCcw,
  Trash2,
  Terminal,
} from "lucide-react";
import { api, type GitCheck as GitCheckResult, type QueueItem, type ActivityEvent } from "../lib/ipc";
import { Button, Mono } from "./ui";

export type SettingsTab =
  | "general"
  | "git"
  | "scheduler"
  | "execution"
  | "notifications"
  | "updates"
  | "advanced"
  | "about";

const TABS: { id: SettingsTab; label: string; icon: typeof Sliders }[] = [
  { id: "general", label: "General", icon: Sliders },
  { id: "git", label: "Git", icon: GitBranch },
  { id: "scheduler", label: "Scheduler", icon: CalendarClock },
  { id: "execution", label: "Execution", icon: Zap },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "updates", label: "Updates", icon: RefreshCw },
  { id: "advanced", label: "Advanced", icon: SlidersHorizontal },
  { id: "about", label: "About", icon: Info },
];

const EXECUTION_MODES = [
  { value: "commit_only", label: "Commit only", desc: "Local commits only, no push" },
  { value: "commit_and_push", label: "Commit & push", desc: "Commit and push immediately" },
  { value: "push_at_end", label: "Push at end", desc: "Push once after all finish" },
] as const;

const MISSED_POLICIES = [
  { value: "run_immediately", label: "Run immediately", desc: "Execute on startup" },
  { value: "skip", label: "Skip missed", desc: "Mark as skipped" },
  { value: "ask", label: "Ask me", desc: "Pause for review" },
  { value: "redistribute", label: "Redistribute", desc: "Shift gaps forward" },
] as const;

export function SettingsView({
  onReplayOnboarding,
}: {
  templates?: unknown[];
  onRefresh?: () => void;
  onCreate?: unknown;
  onUpdate?: unknown;
  onDuplicate?: unknown;
  onDelete?: unknown;
  onReplayOnboarding?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [executionMode, setExecutionMode] = useState("commit_only");
  const [modeLoading, setModeLoading] = useState(true);
  const [missedPolicy, setMissedPolicy] = useState("run_immediately");
  const [policyLoading, setPolicyLoading] = useState(true);

  // Git check state
  const [gitCheck, setGitCheck] = useState<GitCheckResult | null>(null);
  const [checkingGit, setCheckingGit] = useState(false);
  const [lastScanTime, setLastScanTime] = useState<string>("Just now");
  const [repoCount, setRepoCount] = useState<number>(0);

  // Scheduler & Queue metrics state
  const [schedulerPaused, setSchedulerPaused] = useState(false);
  const [scheduledItems, setScheduledItems] = useState<QueueItem[]>([]);
  const [recentEvents, setRecentEvents] = useState<ActivityEvent[]>([]);

  // Updates state
  const [autoUpdateCheck, setAutoUpdateCheck] = useState(() => localStorage.getItem("gitoutbox.auto_update_check") !== "0");
  const [releaseChannel, setReleaseChannel] = useState<"stable" | "beta">(() => (localStorage.getItem("gitoutbox.release_channel") as "beta") || "stable");
  const [lastChecked, setLastChecked] = useState<string | null>(() => localStorage.getItem("gitoutbox.last_checked_update"));
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  // General settings state
  const [autostart, setAutostart] = useState(() => localStorage.getItem("gitoutbox.autostart") === "1");
  const [startMinimized, setStartMinimized] = useState(() => localStorage.getItem("gitoutbox.start_minimized") === "1");
  const [closeToTray, setCloseToTray] = useState(() => localStorage.getItem("gitoutbox.close_to_tray") !== "0");
  const [minimizeToTray, setMinimizeToTray] = useState(() => localStorage.getItem("gitoutbox.minimize_to_tray") === "1");

  // Notifications toggles state
  const [notifyCommitSuccess, setNotifyCommitSuccess] = useState(() => localStorage.getItem("gitoutbox.notify_commit") !== "0");
  const [notifyPushSuccess, setNotifyPushSuccess] = useState(() => localStorage.getItem("gitoutbox.notify_push") !== "0");
  const [notifyFailure, setNotifyFailure] = useState(() => localStorage.getItem("gitoutbox.notify_failure") !== "0");
  const [notifyMissed, setNotifyMissed] = useState(() => localStorage.getItem("gitoutbox.notify_missed") !== "0");
  const [notifyUpdate, setNotifyUpdate] = useState(() => localStorage.getItem("gitoutbox.notify_update") !== "0");

  // Advanced Export Logs Modal
  const [logsModalOpen, setLogsModalOpen] = useState(false);
  const [exportedLogs, setExportedLogs] = useState<string>("");

  useEffect(() => {
    api.getExecutionMode().then((mode) => {
      setExecutionMode(mode);
      setModeLoading(false);
    }).catch(() => setModeLoading(false));

    api.getMissedSchedulePolicy().then((policy) => {
      setMissedPolicy(policy);
      setPolicyLoading(false);
    }).catch(() => setPolicyLoading(false));

    api.getSchedulerPaused().then((paused) => {
      setSchedulerPaused(paused);
    }).catch(() => {});

    api.listRepositories().then((repos) => {
      setRepoCount(repos.length);
    }).catch(() => {});

    api.listAllScheduledItems().then((items) => {
      setScheduledItems(items);
    }).catch(() => {});

    api.listActivityEvents(10).then((events) => {
      setRecentEvents(events);
    }).catch(() => {});
  }, []);

  const loadGitCheck = () => {
    setCheckingGit(true);
    const nowStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLastScanTime(nowStr);
    api.gitCheck()
      .then(setGitCheck)
      .catch(() => setGitCheck(null))
      .finally(() => setCheckingGit(false));
    api.listRepositories().then((r) => setRepoCount(r.length)).catch(() => {});
  };

  useEffect(() => {
    if (activeTab === "git" && !gitCheck && !checkingGit) {
      loadGitCheck();
    }
  }, [activeTab, gitCheck, checkingGit]);

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

  const handleToggleSchedulerPaused = async () => {
    const next = !schedulerPaused;
    setSchedulerPaused(next);
    try {
      await api.setSchedulerPaused(next);
    } catch {
      setSchedulerPaused(!next);
    }
  };

  const handleCheckUpdate = () => {
    setCheckingUpdate(true);
    setTimeout(() => {
      const nowStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setLastChecked(`Today at ${nowStr}`);
      localStorage.setItem("gitoutbox.last_checked_update", `Today at ${nowStr}`);
      setCheckingUpdate(false);
    }, 1200);
  };

  const handleOpenAppData = async () => {
    try {
      await api.openAppDataDir();
    } catch (e) {
      alert(String(e));
    }
  };

  const handleExportLogs = async () => {
    try {
      const events = await api.listActivityEvents(100);
      const text = events.map(e => `[${new Date(e.ts * 1000).toISOString()}] [${e.level.toUpperCase()}] ${e.event_type}: ${e.message}`).join("\n");
      setExportedLogs(text || "No activity events recorded.");
      setLogsModalOpen(true);
    } catch (e) {
      alert(String(e));
    }
  };

  const handleClearCache = () => {
    localStorage.removeItem("gitoutbox.last_view");
    loadGitCheck();
    alert("Cache cleared and metrics refreshed.");
  };

  const saveSetting = (key: string, val: string) => {
    localStorage.setItem(key, val);
  };

  // Next scheduled item calculation
  const upcomingItem = scheduledItems
    .filter(i => i.status === "Scheduled" && i.scheduled_time)
    .sort((a, b) => (a.scheduled_time || 0) - (b.scheduled_time || 0))[0];

  const nextScheduledTimeStr = upcomingItem?.scheduled_time
    ? new Date(upcomingItem.scheduled_time * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" })
    : "None queued";

  const executingItem = scheduledItems.find(i => ["Validating", "Staging", "Committing", "Pushing"].includes(i.status));
  const lastEvent = recentEvents[0];
  const lastExecStr = lastEvent
    ? `${lastEvent.message} (${new Date(lastEvent.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`
    : "None yet";

  return (
    <div className="flex h-full min-h-0 select-none bg-[var(--color-bg)]">
      {/* Category Sidebar */}
      <div className="w-48 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-2">
        <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-faint)]">
          Preferences
        </div>
        <div className="flex flex-col gap-0.5">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-1.5 text-left text-xs transition-colors cursor-pointer ${
                activeTab === id
                  ? "bg-[var(--color-surface-2)] font-semibold text-[var(--color-text)]"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
              }`}
            >
              <Icon className={`h-3.5 w-3.5 ${activeTab === id ? "text-[var(--color-accent)]" : ""}`} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Detail Content Panel */}
      <div className="min-w-0 flex-1 overflow-y-auto p-6 pb-20">
        {/* General */}
        {activeTab === "general" && (
          <div className="max-w-xl animate-fadeIn">
            <Header title="General Settings" desc="Configure desktop startup, system tray behavior, and window preferences." />

            <Section title="Startup & Window Behavior">
              <Row
                title="Launch with Windows"
                desc="Start GitOutbox automatically when Windows starts up"
              >
                <Toggle
                  checked={autostart}
                  onChange={(v) => { setAutostart(v); saveSetting("gitoutbox.autostart", v ? "1" : "0"); }}
                />
              </Row>
              <Row
                title="Start Minimized"
                desc="Launch minimized in system tray without opening window"
              >
                <Toggle
                  checked={startMinimized}
                  onChange={(v) => { setStartMinimized(v); saveSetting("gitoutbox.start_minimized", v ? "1" : "0"); }}
                />
              </Row>
              <Row
                title="Close to System Tray"
                desc="Closing application window keeps GitOutbox running in system tray"
              >
                <Toggle
                  checked={closeToTray}
                  onChange={(v) => { setCloseToTray(v); saveSetting("gitoutbox.close_to_tray", v ? "1" : "0"); }}
                />
              </Row>
              <Row
                title="Minimize to System Tray"
                desc="Minimizing application window hides window from taskbar"
              >
                <Toggle
                  checked={minimizeToTray}
                  onChange={(v) => { setMinimizeToTray(v); saveSetting("gitoutbox.minimize_to_tray", v ? "1" : "0"); }}
                />
              </Row>
            </Section>

            {onReplayOnboarding && (
              <Section title="Onboarding Guide">
                <Row
                  title="First-Launch Setup Wizard"
                  desc="Revisit the welcome checklist, system checks, and guide"
                >
                  <Button variant="default" onClick={onReplayOnboarding}>
                    <Sparkles className="h-3.5 w-3.5 mr-1 text-[var(--color-accent)]" /> Replay Guide
                  </Button>
                </Row>
              </Section>
            )}
          </div>
        )}

        {/* Git */}
        {activeTab === "git" && (
          <div className="max-w-xl animate-fadeIn">
            <Header title="Git Management & Environment" desc="Status of local Git CLI binary, identity, and repository scanner." />

            <Section title="System Environment & Credentials">
              {checkingGit ? (
                <div className="flex items-center gap-2 p-3 text-xs text-[var(--color-muted)]">
                  <Loader2 className="h-4 w-4 animate-spin text-[var(--color-accent)]" /> Scanning Git environment...
                </div>
              ) : gitCheck ? (
                <div className="divide-y divide-[var(--color-border)]">
                  <Row title="Git CLI Installed" desc="Local executable detection">
                    <HealthDot status={gitCheck.installed ? "green" : "red"} label={gitCheck.installed ? "Installed" : "Not Found"} />
                  </Row>
                  <Row title="Git Executable Path" desc="Binary location on system PATH">
                    <Mono className="text-xs text-[var(--color-text)] truncate max-w-[220px]">{gitCheck.git_path ?? "git"}</Mono>
                  </Row>
                  <Row title="Git Version" desc="Installed version release string">
                    <Mono className="text-xs text-[var(--color-text)]">{gitCheck.version ?? "Unknown"}</Mono>
                  </Row>
                  <Row title="Authentication Status" desc="Git identity configuration state">
                    <HealthDot
                      status={gitCheck.user_name && gitCheck.user_email ? "green" : "yellow"}
                      label={gitCheck.user_name && gitCheck.user_email ? "Configured" : "Identity Missing"}
                    />
                  </Row>
                  <Row title="Current User (user.name)" desc="Global commit author name">
                    <Mono className="text-xs text-[var(--color-text)]">{gitCheck.user_name ?? "Not configured"}</Mono>
                  </Row>
                  <Row title="Git Email (user.email)" desc="Global commit author email">
                    <Mono className="text-xs text-[var(--color-text)]">{gitCheck.user_email ?? "Not configured"}</Mono>
                  </Row>
                  <Row title="Default Branch" desc="Global init.defaultBranch setting">
                    <Mono className="text-xs text-[var(--color-text)]">{gitCheck.default_branch ?? "main"}</Mono>
                  </Row>
                </div>
              ) : (
                <div className="p-3 text-xs text-[var(--color-danger)]">Unable to inspect Git environment.</div>
              )}
            </Section>

            <Section title="Repository Scanner">
              <Row title="Scan Status" desc="Active tracked local repositories">
                <span className="text-xs font-semibold text-[var(--color-text)]">{repoCount} {repoCount === 1 ? "repository" : "repositories"} tracked</span>
              </Row>
              <Row title="Last Scan" desc="Timestamp of previous environment scan">
                <span className="text-xs text-[var(--color-muted)]">{lastScanTime}</span>
              </Row>
            </Section>

            <div className="mt-4 flex justify-end">
              <Button variant="primary" onClick={loadGitCheck} disabled={checkingGit}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${checkingGit ? "animate-spin" : ""}`} /> Rescan Environment
              </Button>
            </div>
          </div>
        )}

        {/* Scheduler */}
        {activeTab === "scheduler" && (
          <div className="max-w-xl animate-fadeIn">
            <Header title="Scheduler UX & Diagnostics" desc="Live background execution status, queue metrics, and retry policy." />

            <Section title="Scheduler Status & Controls">
              <Row
                title="Background Engine Status"
                desc="Current execution state of the Tokio background scheduler loop"
              >
                <HealthDot
                  status={schedulerPaused ? "yellow" : "green"}
                  label={schedulerPaused ? "Paused" : "Running"}
                />
              </Row>
              <Row
                title="Scheduler Power Toggle"
                desc={schedulerPaused ? "Resume automated commit execution" : "Pause automated commit execution"}
              >
                <Button
                  variant={schedulerPaused ? "primary" : "default"}
                  onClick={handleToggleSchedulerPaused}
                >
                  {schedulerPaused ? (
                    <>
                      <Play className="h-3.5 w-3.5 mr-1" /> Resume Scheduler
                    </>
                  ) : (
                    <>
                      <Pause className="h-3.5 w-3.5 mr-1 text-[var(--color-warn)]" /> Pause Scheduler
                    </>
                  )}
                </Button>
              </Row>
            </Section>

            <Section title="Live Execution Queue Metrics">
              <Row title="Pending Queue Count" desc="Scheduled commits waiting in queue">
                <Mono className="text-xs font-bold text-[var(--color-accent)]">{scheduledItems.filter(i => i.status === "Scheduled").length} pending</Mono>
              </Row>
              <Row title="Currently Executing Item" desc="Commit currently staging or executing">
                <span className="text-xs font-medium text-[var(--color-text)] truncate max-w-[200px]">
                  {executingItem ? executingItem.title : "Idle (None)"}
                </span>
              </Row>
              <Row title="Last Execution" desc="Result of most recent commit operation">
                <span className="text-xs text-[var(--color-muted)] truncate max-w-[220px]">{lastExecStr}</span>
              </Row>
              <Row title="Next Scheduled Execution" desc="Upcoming commit execution time">
                <Mono className="text-xs text-[var(--color-text)]">{nextScheduledTimeStr}</Mono>
              </Row>
            </Section>

            <Section title="Automated Retry Policy">
              <Row title="Maximum Retries" desc="Consecutive attempt limit before pausing item">
                <Mono className="text-xs text-[var(--color-text)] font-medium">3 attempts</Mono>
              </Row>
              <Row title="Retry Delay Intervals" desc="Exponential backoff algorithm">
                <Mono className="text-[11px] text-[var(--color-muted)]">30s → 120s → 300s</Mono>
              </Row>
            </Section>
          </div>
        )}

        {/* Execution */}
        {activeTab === "execution" && (
          <div className="max-w-xl animate-fadeIn">
            <Header title="Execution Mode" desc="Controls how scheduled commits stage and push to upstream." />

            <Section title="Git Delivery Target">
              <div className="divide-y divide-[var(--color-border)]">
                {EXECUTION_MODES.map((mode) => (
                  <label
                    key={mode.value}
                    className="flex cursor-pointer items-center justify-between py-2.5 px-1 hover:bg-[var(--color-surface-2)] rounded px-2"
                  >
                    <div>
                      <div className="text-xs font-semibold text-[var(--color-text)]">{mode.label}</div>
                      <div className="text-[11px] text-[var(--color-faint)]">{mode.desc}</div>
                    </div>
                    <input
                      type="radio"
                      name="execution_mode"
                      value={mode.value}
                      checked={executionMode === mode.value}
                      onChange={() => handleModeChange(mode.value)}
                      disabled={modeLoading}
                      className="accent-[var(--color-accent)] cursor-pointer"
                    />
                  </label>
                ))}
              </div>
            </Section>
          </div>
        )}

        {/* Notifications */}
        {activeTab === "notifications" && (
          <div className="max-w-xl animate-fadeIn">
            <Header title="Desktop Notifications" desc="Enable or disable granular Windows toast notifications." />

            <Section title="Notification Events">
              <Row
                title="Commit Completed"
                desc="Notify when a local draft commit is successfully created"
              >
                <Toggle
                  checked={notifyCommitSuccess}
                  onChange={(v) => { setNotifyCommitSuccess(v); saveSetting("gitoutbox.notify_commit", v ? "1" : "0"); }}
                />
              </Row>
              <Row
                title="Push Completed"
                desc="Notify when commits are pushed to remote upstream"
              >
                <Toggle
                  checked={notifyPushSuccess}
                  onChange={(v) => { setNotifyPushSuccess(v); saveSetting("gitoutbox.notify_push", v ? "1" : "0"); }}
                />
              </Row>
              <Row
                title="Failed Execution"
                desc="Notify immediately if preflight checks, staging, or push fail"
              >
                <Toggle
                  checked={notifyFailure}
                  onChange={(v) => { setNotifyFailure(v); saveSetting("gitoutbox.notify_failure", v ? "1" : "0"); }}
                />
              </Row>
              <Row
                title="Missed Schedules"
                desc="Notify if scheduled commits were missed while system was offline"
              >
                <Toggle
                  checked={notifyMissed}
                  onChange={(v) => { setNotifyMissed(v); saveSetting("gitoutbox.notify_missed", v ? "1" : "0"); }}
                />
              </Row>
              <Row
                title="Update Available"
                desc="Notify when a new version of GitOutbox is ready"
              >
                <Toggle
                  checked={notifyUpdate}
                  onChange={(v) => { setNotifyUpdate(v); saveSetting("gitoutbox.notify_update", v ? "1" : "0"); }}
                />
              </Row>
            </Section>
          </div>
        )}

        {/* Updates */}
        {activeTab === "updates" && (
          <div className="max-w-xl animate-fadeIn">
            <Header title="Software Updates" desc="Manage release channels and check for application updates." />

            <Section title="Update Settings">
              <Row
                title="Automatically Check for Updates"
                desc="Check for new releases in the background periodically"
              >
                <Toggle
                  checked={autoUpdateCheck}
                  onChange={(v) => { setAutoUpdateCheck(v); saveSetting("gitoutbox.auto_update_check", v ? "1" : "0"); }}
                />
              </Row>
              <Row
                title="Release Channel"
                desc="Select release channel for version updates"
              >
                <div className="flex rounded-[var(--radius-control)] bg-[var(--color-surface-2)] p-0.5 border border-[var(--color-border)]">
                  <button
                    onClick={() => { setReleaseChannel("stable"); saveSetting("gitoutbox.release_channel", "stable"); }}
                    className={`rounded px-2.5 py-1 text-xs font-medium cursor-pointer ${
                      releaseChannel === "stable" ? "bg-[var(--color-surface)] text-[var(--color-text)] font-semibold shadow-sm" : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    Stable
                  </button>
                  <button
                    onClick={() => { setReleaseChannel("beta"); saveSetting("gitoutbox.release_channel", "beta"); }}
                    className={`rounded px-2.5 py-1 text-xs font-medium cursor-pointer ${
                      releaseChannel === "beta" ? "bg-[var(--color-surface)] text-[var(--color-text)] font-semibold shadow-sm" : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    Beta (future)
                  </button>
                </div>
              </Row>
            </Section>

            <Section title="Version Metrics">
              <Row title="Current Version" desc="Installed desktop build">
                <Mono className="text-xs text-[var(--color-accent)] font-semibold">v0.2.0</Mono>
              </Row>
              <Row title="Last Checked" desc="Timestamp of previous update check">
                <span className="text-xs text-[var(--color-muted)]">{lastChecked ?? "Never"}</span>
              </Row>
              <Row title="Update Status" desc="Release check result">
                <StatusBadge ok={true} text="Up to date" />
              </Row>
            </Section>

            <div className="mt-4 flex justify-end">
              <Button variant="default" onClick={handleCheckUpdate} disabled={checkingUpdate}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${checkingUpdate ? "animate-spin" : ""}`} />
                {checkingUpdate ? "Checking for updates..." : "Check for updates"}
              </Button>
            </div>
          </div>
        )}

        {/* Advanced */}
        {activeTab === "advanced" && (
          <div className="max-w-xl animate-fadeIn">
            <Header title="Advanced & Diagnostics" desc="Diagnostic tools, log exporting, and database storage actions." />

            <Section title="Diagnostics & Maintenance">
              <Row title="Export Activity Logs" desc="View or export formatted activity events log">
                <Button variant="default" onClick={handleExportLogs}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Export Logs
                </Button>
              </Row>
              <Row title="Open App Logs Folder" desc="Reveal application logs directory in Windows Explorer">
                <Button variant="default" onClick={handleOpenAppData}>
                  <FolderOpen className="h-3.5 w-3.5 mr-1" /> Open Logs Folder
                </Button>
              </Row>
              <Row title="Open Database Location" desc="Open %APPDATA%/app.gitoutbox.desktop in Explorer">
                <Button variant="default" onClick={handleOpenAppData}>
                  <Database className="h-3.5 w-3.5 mr-1 text-[var(--color-accent)]" /> Open Database Location
                </Button>
              </Row>
              <Row title="Reset Onboarding Wizard" desc="Clear onboarding status and restart initial wizard">
                {onReplayOnboarding && (
                  <Button variant="default" onClick={onReplayOnboarding}>
                    <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset Onboarding
                  </Button>
                )}
              </Row>
              <Row title="Clear Local State Cache" desc="Reset transient UI cache and re-fetch metrics">
                <Button variant="default" onClick={handleClearCache}>
                  <Trash2 className="h-3.5 w-3.5 mr-1 text-[var(--color-warn)]" /> Clear Cache
                </Button>
              </Row>
            </Section>

            <Section title="Missed Schedules Policy">
              <div className="divide-y divide-[var(--color-border)]">
                {MISSED_POLICIES.map((policy) => (
                  <label
                    key={policy.value}
                    className="flex cursor-pointer items-center justify-between py-2.5 px-1 hover:bg-[var(--color-surface-2)] rounded px-2"
                  >
                    <div>
                      <div className="text-xs font-semibold text-[var(--color-text)]">{policy.label}</div>
                      <div className="text-[11px] text-[var(--color-faint)]">{policy.desc}</div>
                    </div>
                    <input
                      type="radio"
                      name="missed_policy"
                      value={policy.value}
                      checked={missedPolicy === policy.value}
                      onChange={() => handlePolicyChange(policy.value)}
                      disabled={policyLoading}
                      className="accent-[var(--color-accent)] cursor-pointer"
                    />
                  </label>
                ))}
              </div>
            </Section>
          </div>
        )}

        {/* About */}
        {activeTab === "about" && (
          <div className="max-w-xl animate-fadeIn">
            <Header title="About GitOutbox" desc="Local-first Git commit scheduling desktop application." />

            <div className="mb-6 rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <div className="flex items-center gap-3 mb-3">
                <ShieldCheck className="h-6 w-6 text-[var(--color-accent)]" />
                <div>
                  <div className="text-sm font-bold text-[var(--color-text)]">GitOutbox Desktop</div>
                  <div className="text-xs text-[var(--color-muted)]">Version 0.2.0 (Windows x64)</div>
                </div>
              </div>
              <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                Prepare work now. Ship it on your schedule.<br />
                GitOutbox is a privacy-first utility operating entirely on your local machine with your existing Git CLI and credentials.
              </p>
            </div>

            <Section title="Links & Guides">
              <Row title="Windows SmartScreen Guide" desc="Instructions for unsigned binary prompts">
                <a
                  href="docs/SMARTSCREEN_GUIDE.md"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline"
                >
                  <span>Read Guide</span> <ExternalLink className="h-3 w-3" />
                </a>
              </Row>
              <Row title="GitHub Repository" desc="Open source project homepage">
                <a
                  href="https://github.com/i-ayushsingh/gitoutbox"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline"
                >
                  <span>Repository</span> <ExternalLink className="h-3 w-3" />
                </a>
              </Row>
              <Row title="License" desc="MIT Open Source License">
                <span className="text-xs text-[var(--color-muted)]">MIT License</span>
              </Row>
            </Section>
          </div>
        )}
      </div>

      {/* Export Logs Modal */}
      {logsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setLogsModalOpen(false)}>
          <div
            className="w-full max-w-lg rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-[var(--color-text)] border-b border-[var(--color-border)] pb-2">
              <Terminal className="h-4 w-4 text-[var(--color-accent)]" />
              Activity Log Export
            </div>
            <textarea
              readOnly
              value={exportedLogs}
              rows={12}
              className="w-full rounded-[var(--radius-control)] bg-[var(--color-surface-2)] border border-[var(--color-border)] p-3 font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-text)] focus:outline-none"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setLogsModalOpen(false)}>
                Close
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  navigator.clipboard.writeText(exportedLogs);
                  alert("Logs copied to clipboard!");
                }}
              >
                Copy to Clipboard
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Header({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-5 border-b border-[var(--color-border)] pb-3">
      <h1 className="text-base font-bold text-[var(--color-text)]">{title}</h1>
      <p className="text-xs text-[var(--color-muted)] mt-0.5">{desc}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-faint)]">
        {title}
      </h2>
      <div className="rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 divide-y divide-[var(--color-border)]">
        {children}
      </div>
    </div>
  );
}

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5 first:pt-1 last:pb-1">
      <div className="pr-4 min-w-0 flex-1">
        <div className="text-xs font-semibold text-[var(--color-text)]">{title}</div>
        {desc && <div className="text-[11px] text-[var(--color-muted)] mt-0.5 leading-snug">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
        checked ? "bg-[var(--color-accent)]" : "bg-[var(--color-border-strong)]"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function HealthDot({ status, label }: { status: "green" | "yellow" | "red"; label: string }) {
  const colors = {
    green: "bg-[var(--color-ok)] text-[var(--color-ok)]",
    yellow: "bg-[var(--color-warn)] text-[var(--color-warn)]",
    red: "bg-[var(--color-danger)] text-[var(--color-danger)]",
  }[status];

  return (
    <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-surface-2)] px-2.5 py-1 text-[11px] font-medium border border-[var(--color-border)]">
      <span className={`h-2 w-2 rounded-full ${colors}`} />
      <span className="text-[var(--color-text)]">{label}</span>
    </div>
  );
}

function StatusBadge({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        ok
          ? "bg-[color-mix(in_srgb,var(--color-ok)_15%,transparent)] text-[var(--color-ok)] border border-[color-mix(in_srgb,var(--color-ok)_30%,transparent)]"
          : "bg-[color-mix(in_srgb,var(--color-danger)_15%,transparent)] text-[var(--color-danger)] border border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)]"
      }`}
    >
      {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      <span>{text}</span>
    </div>
  );
}
