import { useEffect, useState } from "react";
import { ScrollText, Info, AlertTriangle, Check, Loader2 } from "lucide-react";
import { api, type ActivityEvent } from "../lib/ipc";
import { EmptyState } from "./ui";

const LEVEL_ICON: Record<string, typeof Info> = {
  info: Info,
  success: Check,
  warning: AlertTriangle,
  error: AlertTriangle,
};

const LEVEL_COLOR: Record<string, string> = {
  info: "var(--color-muted)",
  success: "var(--color-ok)",
  warning: "var(--color-warn)",
  error: "var(--color-danger)",
};

export function ActivityView() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .listActivityEvents(200)
      .then(setEvents)
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-[var(--color-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading activity…
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <EmptyState
        icon={ScrollText}
        title="No activity yet"
        hint="Scheduled commit operations will be logged here."
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-4 py-2.5">
        <ScrollText className="h-4 w-4 text-[var(--color-muted)]" strokeWidth={1.75} />
        <span className="text-sm font-medium">Activity</span>
        <span className="ml-auto text-[11px] text-[var(--color-faint)]">
          {events.length} events
        </span>
      </header>
      <div className="flex-1 overflow-y-auto">
        {events.map((event) => {
          const Icon = LEVEL_ICON[event.level] ?? Info;
          const color = LEVEL_COLOR[event.level] ?? "var(--color-muted)";
          const time = new Date(event.ts * 1000).toLocaleString([], {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
          });
          const hasCommitInfo = !!event.commit_message;
          const primaryText = hasCommitInfo ? event.commit_message : event.message;
          const secondaryText = hasCommitInfo ? event.message : null;

          return (
            <div key={event.id} className="flex items-start gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color }} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-[var(--color-text)] truncate">
                  {primaryText}
                </div>
                {secondaryText && (
                  <div className="text-[11px] text-[var(--color-muted)] font-[family-name:var(--font-mono)] truncate mt-0.5">
                    {secondaryText}
                  </div>
                )}
                <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--color-faint)]">
                  <span>{time}</span>
                  {event.event_type && (
                    <>
                      <span className="text-[var(--color-border-strong)]">·</span>
                      <span className="font-[family-name:var(--font-mono)]">{event.event_type}</span>
                    </>
                  )}
                  {event.commit_hash && (
                    <>
                      <span className="text-[var(--color-border-strong)]">·</span>
                      <span className="font-[family-name:var(--font-mono)] text-[var(--color-accent)]">{event.commit_hash.slice(0, 7)}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
