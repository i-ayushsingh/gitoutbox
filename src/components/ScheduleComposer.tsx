import { useEffect, useMemo, useState } from "react";
import { X, AlertTriangle, Shuffle, Loader2 } from "lucide-react";
import { type QueueItem, type ScheduleAssignment, api } from "../lib/ipc";
import { Button } from "./ui";

type ScheduleMode = "exact" | "window" | "interval" | "multiday";
type Distribution = "even" | "variable";

interface DayConfig {
  date: string; // YYYY-MM-DD
  windowStart: string; // HH:MM
  windowEnd: string; // HH:MM
  count: number;
}

export function ScheduleComposer({
  open,
  drafts,
  onClose,
  onConfirm,
}: {
  open: boolean;
  drafts: QueueItem[];
  onClose: () => void;
  onConfirm: (assignments: ScheduleAssignment[]) => Promise<void>;
}) {
  const getTodayStr = () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  const getRescheduleInfo = () => {
    const existingTime = drafts[0]?.scheduled_time;
    if (drafts.length === 1 && typeof existingTime === "number" && existingTime > 0) {
      const d = new Date(existingTime * 1000);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const dateStr = `${yyyy}-${mm}-${dd}`;
      const hh = String(d.getHours()).padStart(2, "0");
      const min = String(d.getMinutes()).padStart(2, "0");
      const timeStr = `${hh}:${min}`;
      return { mode: "exact" as const, dateStr, timeStr };
    }
    return null;
  };

  const initialResched = getRescheduleInfo();
  const initialTodayStr = getTodayStr();

  const [mode, setMode] = useState<ScheduleMode>(initialResched ? "exact" : "window");
  const [distribution, setDistribution] = useState<Distribution>("even");

  // Window mode
  const [windowDate, setWindowDate] = useState(initialResched ? initialResched.dateStr : initialTodayStr);
  const [windowStart, setWindowStart] = useState("17:00");
  const [windowEnd, setWindowEnd] = useState("19:00");

  // Exact mode
  const [exactDate, setExactDate] = useState(initialResched ? initialResched.dateStr : initialTodayStr);
  const [exactTime, setExactTime] = useState(initialResched ? initialResched.timeStr : "17:00");

  // Interval mode
  const [intervalDate, setIntervalDate] = useState(initialResched ? initialResched.dateStr : initialTodayStr);
  const [intervalStart, setIntervalStart] = useState("17:00");
  const [intervalMinutes, setIntervalMinutes] = useState(5);

  // Multi-day mode
  const [days, setDays] = useState<DayConfig[]>([]);
  const [dayStartDate, setDayStartDate] = useState(initialResched ? initialResched.dateStr : initialTodayStr);
  const [dayCount, setDayCount] = useState(3);

  // Common
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 100000));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const n = drafts.length;

  // Initialize defaults when dialog opens.
  useEffect(() => {
    if (!open) return;
    const existingTime = drafts[0]?.scheduled_time;
    if (drafts.length === 1 && typeof existingTime === "number" && existingTime > 0) {
      const d = new Date(existingTime * 1000);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const dateStr = `${yyyy}-${mm}-${dd}`;
      const hh = String(d.getHours()).padStart(2, "0");
      const min = String(d.getMinutes()).padStart(2, "0");
      const timeStr = `${hh}:${min}`;

      setMode("exact");
      setExactDate(dateStr);
      setExactTime(timeStr);
      setWindowDate(dateStr);
      setIntervalDate(dateStr);
      setDayStartDate(dateStr);
      setDayCount(3);
      setError(null);
      setSaving(false);
    } else {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const dd = String(today.getDate()).padStart(2, "0");
      const todayStr = `${yyyy}-${mm}-${dd}`;
      setMode("window");
      setWindowDate(todayStr);
      setExactDate(todayStr);
      setIntervalDate(todayStr);
      setDayStartDate(todayStr);
      setDayCount(3);
      setError(null);
      setSaving(false);
    }
    setSeed(Math.floor(Math.random() * 100000));
  }, [open, drafts]);

  // Initialize multi-day allocations.
  useEffect(() => {
    if (mode !== "multiday" || n === 0) return;
    const basePerDay = Math.floor(n / dayCount);
    const remainder = n % dayCount;
    const newDays: DayConfig[] = [];
    for (let i = 0; i < dayCount; i++) {
      const d = new Date(dayStartDate);
      d.setDate(d.getDate() + i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      newDays.push({
        date: `${yyyy}-${mm}-${dd}`,
        windowStart: "17:00",
        windowEnd: "19:00",
        count: basePerDay + (i < remainder ? 1 : 0),
      });
    }
    setDays(newDays);
  }, [mode, dayStartDate, dayCount, n]);

  // Convert date+time string to UTC seconds (using local timezone).
  const toEpoch = (date: string, time: string): number => {
    if (!date || !time) {
      return Math.floor(Date.now() / 1000);
    }
    const dParts = date.split("-").map(Number);
    const tParts = time.split(":").map(Number);
    if (dParts.length !== 3 || tParts.length !== 2 || dParts.some(Number.isNaN) || tParts.some(Number.isNaN)) {
      return Math.floor(Date.now() / 1000);
    }
    const [y, m, d] = dParts;
    const [h, min] = tParts;
    const dateObj = new Date(y, m - 1, d, h, min);
    const val = dateObj.getTime();
    if (Number.isNaN(val)) {
      return Math.floor(Date.now() / 1000);
    }
    return Math.floor(val / 1000);
  };

  const [preview, setPreview] = useState<ScheduleAssignment[]>([]);

  useEffect(() => {
    let active = true;
    const loadPreview = async () => {
      if (n === 0) {
        setPreview([]);
        return;
      }
      try {
        const daysInput = days.map((d) => {
          const [y, m, dayNum] = d.date.split("-").map(Number);
          const midnight = new Date(y, m - 1, dayNum, 0, 0, 0);
          const dayStart = Math.floor(midnight.getTime() / 1000);
          
          const [sh, smin] = d.windowStart.split(":").map(Number);
          const [eh, emin] = d.windowEnd.split(":").map(Number);
          const windowStartOffset = sh * 3600 + smin * 60;
          const windowEndOffset = eh * 3600 + emin * 60;

          return {
            day_start: dayStart,
            window_start_offset: windowStartOffset,
            window_end_offset: windowEndOffset,
            item_count: d.count,
          };
        });

        const exactBase = toEpoch(exactDate, exactTime);
        const exactTimes = Array.from({ length: n }, (_, i) => exactBase + i * 60);

        const winStart = toEpoch(windowDate, windowStart);
        const winEnd = toEpoch(windowDate, windowEnd);

        const intStart = toEpoch(intervalDate, intervalStart);
        const intSeconds = intervalMinutes * 60;

        const res = await api.computeSchedule({
          mode: mode === "multiday" ? "multiday" : mode,
          distribution,
          item_count: n,
          exact_times: exactTimes,
          window_start: winStart,
          window_end: winEnd,
          interval_start: intStart,
          interval_seconds: intSeconds,
          days: daysInput,
          min_gap_seconds: 60,
          seed: seed,
        });

        if (active) {
          const mapped = res.map((a: { item_index: number; scheduled_time: number }) => ({
            item_id: drafts[a.item_index].id,
            scheduled_time: a.scheduled_time,
          }));
          setPreview(mapped);
        }
      } catch (err) {
        if (active) {
          setPreview([]);
        }
      }
    };

    loadPreview();
    return () => {
      active = false;
    };
  }, [mode, distribution, windowDate, windowStart, windowEnd, exactDate, exactTime,
      intervalDate, intervalStart, intervalMinutes, days, seed, n, drafts]);

  const shuffle = () => setSeed(Math.floor(Math.random() * 100000));

  const totalAllocated = mode === "multiday" ? days.reduce((s, d) => s + d.count, 0) : n;
  const allocationValid = totalAllocated === n;
  const hasPreview = preview.length === n;

  const formatTime = (epoch: number) => {
    const d = new Date(epoch * 1000);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatDate = (epoch: number) => {
    const d = new Date(epoch * 1000);
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  };

  // Group preview by day for display.
  const groupedPreview = useMemo(() => {
    const groups: { date: string; items: { time: string; message: string }[] }[] = [];
    let currentDate = "";
    for (const a of preview) {
      const date = formatDate(a.scheduled_time);
      const time = formatTime(a.scheduled_time);
      const draft = drafts.find((d) => d.id === a.item_id);
      const message = draft?.commit_message ?? "";
      if (date !== currentDate) {
        groups.push({ date, items: [] });
        currentDate = date;
      }
      groups[groups.length - 1].items.push({ time, message });
    }
    return groups;
  }, [preview, drafts]);

  const handleConfirm = async () => {
    if (!hasPreview || !allocationValid) return;
    setSaving(true);
    setError(null);
    try {
      await onConfirm(preview);
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  const updateDayCount = (idx: number, newCount: number) => {
    setDays((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], count: Math.max(0, newCount) };
      return next;
    });
  };

  const updateDayWindow = (idx: number, start: string, end: string) => {
    setDays((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], windowStart: start, windowEnd: end };
      return next;
    });
  };

  if (!open || drafts.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex w-full max-w-2xl max-h-[90vh] flex-col rounded-[var(--radius-dialog)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <span className="text-sm font-medium">Schedule {n} draft{n === 1 ? "" : "s"}</span>
          <button onClick={onClose} className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 gap-4 overflow-y-auto px-4 py-3">
          {/* Left: configuration */}
          <div className="flex w-72 shrink-0 flex-col gap-3">
            {/* Mode */}
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">Mode</span>
              <select value={mode} onChange={(e) => setMode(e.target.value as ScheduleMode)}
                className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-xs outline-none">
                <option value="exact">Exact time</option>
                <option value="window">Time window</option>
                <option value="interval">Interval</option>
                <option value="multiday">Multi-day</option>
              </select>
            </label>

            {/* Distribution (for window/multiday) */}
            {(mode === "window" || mode === "multiday") && (
              <label className="block">
                <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">Distribution</span>
                <select value={distribution} onChange={(e) => setDistribution(e.target.value as Distribution)}
                  className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-xs outline-none">
                  <option value="even">Even</option>
                  <option value="variable">Variable</option>
                </select>
              </label>
            )}

            {/* Exact mode config */}
            {mode === "exact" && (
              <>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">Date</span>
                  <input type="date" value={exactDate} onChange={(e) => setExactDate(e.target.value)}
                    className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-xs outline-none" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">Start time</span>
                  <input type="time" value={exactTime} onChange={(e) => setExactTime(e.target.value)}
                    className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-xs outline-none" />
                </label>
                <p className="text-[10px] text-[var(--color-faint)]">
                  Drafts are scheduled 1 minute apart starting at this time.
                </p>
              </>
            )}

            {/* Window mode config */}
            {mode === "window" && (
              <>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">Date</span>
                  <input type="date" value={windowDate} onChange={(e) => setWindowDate(e.target.value)}
                    className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-xs outline-none" />
                </label>
                <div className="flex gap-2">
                  <label className="block flex-1">
                    <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">Start</span>
                    <input type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)}
                      className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-xs outline-none" />
                  </label>
                  <label className="block flex-1">
                    <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">End</span>
                    <input type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)}
                      className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-xs outline-none" />
                  </label>
                </div>
              </>
            )}

            {/* Interval mode config */}
            {mode === "interval" && (
              <>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">Date</span>
                  <input type="date" value={intervalDate} onChange={(e) => setIntervalDate(e.target.value)}
                    className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-xs outline-none" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">Start time</span>
                  <input type="time" value={intervalStart} onChange={(e) => setIntervalStart(e.target.value)}
                    className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-xs outline-none" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">Interval (minutes)</span>
                  <input type="number" min={1} value={intervalMinutes} onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                    className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-xs outline-none" />
                </label>
              </>
            )}

            {/* Multi-day config */}
            {mode === "multiday" && (
              <>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">Start date</span>
                  <input type="date" value={dayStartDate} onChange={(e) => setDayStartDate(e.target.value)}
                    className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-xs outline-none" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]">Number of days</span>
                  <input type="number" min={1} max={30} value={dayCount} onChange={(e) => setDayCount(Math.max(1, Number(e.target.value)))}
                    className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-xs outline-none" />
                </label>
                {days.length > 0 && (
                  <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg)]">
                    <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--color-faint)]">
                      Daily allocation {totalAllocated}/{n}
                    </div>
                    {days.map((day, i) => (
                      <div key={i} className="flex flex-col gap-1 border-t border-[var(--color-border)] px-2 py-1.5 first:border-t-0">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-medium text-[var(--color-muted)]">{day.date}</span>
                          <div className="flex items-center gap-1">
                            <input type="number" min={0} value={day.count}
                              onChange={(e) => updateDayCount(i, Number(e.target.value))}
                              className="w-12 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1 py-0.5 text-xs text-center outline-none" />
                            <span className="text-[10px] text-[var(--color-faint)]">drafts</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-faint)]">
                          <span>Window:</span>
                          <input type="time" value={day.windowStart}
                            onChange={(e) => updateDayWindow(i, e.target.value, day.windowEnd)}
                            className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1 py-0.5 text-[10px] outline-none w-16" />
                          <span>to</span>
                          <input type="time" value={day.windowEnd}
                            onChange={(e) => updateDayWindow(i, day.windowStart, e.target.value)}
                            className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1 py-0.5 text-[10px] outline-none w-16" />
                        </div>
                      </div>
                    ))}
                    {!allocationValid && (
                      <div className="px-2 py-1 text-[10px] text-[var(--color-danger)]">
                        Allocations must sum to {n}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Shuffle for variable distribution */}
            {distribution === "variable" && (mode === "window" || mode === "multiday") && (
              <Button variant="default" onClick={shuffle}>
                <Shuffle className="h-3.5 w-3.5" /> Shuffle Schedule
              </Button>
            )}

            {/* Summary */}
            {hasPreview && (
              <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[10px] text-[var(--color-muted)]">
                {n} drafts
                {mode === "multiday" && ` · ${days.filter((d) => d.count > 0).length} days`}
                {preview.length > 0 && <>
                  <br />First: {formatDate(preview[0].scheduled_time)} {formatTime(preview[0].scheduled_time)}
                  <br />Last: {formatDate(preview[preview.length - 1].scheduled_time)} {formatTime(preview[preview.length - 1].scheduled_time)}
                </>}
              </div>
            )}
          </div>

          {/* Right: preview */}
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="mb-1 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">Preview</span>
            {hasPreview ? (
              <div className="flex-1 overflow-y-auto rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg)]">
                {groupedPreview.map((group, gi) => (
                  <div key={gi}>
                    <div className="sticky top-0 bg-[var(--color-surface-2)] px-2 py-1 text-[10px] font-medium text-[var(--color-muted)]">
                      {group.date}
                    </div>
                    {group.items.map((item, ii) => (
                      <div key={ii} className="flex items-start gap-2 border-b border-[var(--color-border)] px-2 py-1 last:border-b-0">
                        <span className="shrink-0 w-14 text-right font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-faint)]">
                          {item.time}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-xs text-[var(--color-text)]">
                          {item.message || <span className="text-[var(--color-faint)]">No message</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-xs text-[var(--color-faint)]">
                Configure scheduling to see preview
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-[var(--color-border)] px-4 py-3">
          {error && (
            <span className="flex items-center gap-1 text-xs text-[var(--color-danger)]">
              <AlertTriangle className="h-3.5 w-3.5" /> {error}
            </span>
          )}
          <div className="flex gap-2 ml-auto">
            <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button variant="primary" onClick={handleConfirm} disabled={!hasPreview || !allocationValid || saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : `Schedule ${n} draft${n === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
