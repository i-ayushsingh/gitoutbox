import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center select-none animate-fadeIn">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-faint)] mb-3 shadow-sm">
        <Icon className="h-6 w-6" strokeWidth={1.5} />
      </div>
      <div className="text-sm font-semibold text-[var(--color-text)] mb-1">{title}</div>
      {hint && (
        <div className="max-w-sm text-xs text-[var(--color-muted)] leading-relaxed mb-4">{hint}</div>
      )}
      {action}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "default",
  disabled,
  type = "button",
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "ghost" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] px-3 py-1.5 text-xs font-medium transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none active:scale-[0.98]";
  const styles = {
    default:
      "border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-text)] hover:bg-[var(--color-border)] hover:border-[var(--color-border-strong)]",
    primary:
      "bg-[var(--color-accent)] text-[var(--color-accent-fg)] hover:brightness-110 shadow-sm",
    ghost:
      "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
    danger:
      "bg-[color-mix(in_srgb,var(--color-danger)_15%,transparent)] text-[var(--color-danger)] border border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-danger)_25%,transparent)]",
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles} ${className}`}>
      {children}
    </button>
  );
}

export function Badge({
  children,
  variant = "default",
  className = "",
}: {
  children: React.ReactNode;
  variant?: "default" | "ok" | "warn" | "danger" | "accent" | "faint";
  className?: string;
}) {
  const styles = {
    default: "bg-[var(--color-surface-2)] text-[var(--color-muted)] border-[var(--color-border)]",
    ok: "bg-[color-mix(in_srgb,var(--color-ok)_15%,transparent)] text-[var(--color-ok)] border-[color-mix(in_srgb,var(--color-ok)_30%,transparent)]",
    warn: "bg-[color-mix(in_srgb,var(--color-warn)_15%,transparent)] text-[var(--color-warn)] border-[color-mix(in_srgb,var(--color-warn)_30%,transparent)]",
    danger: "bg-[color-mix(in_srgb,var(--color-danger)_15%,transparent)] text-[var(--color-danger)] border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)]",
    accent: "bg-[color-mix(in_srgb,var(--color-accent)_15%,transparent)] text-[var(--color-accent)] border-[color-mix(in_srgb,var(--color-accent)_30%,transparent)]",
    faint: "bg-transparent text-[var(--color-faint)] border-[var(--color-border)]",
  }[variant];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-tight ${styles} ${className}`}
    >
      {children}
    </span>
  );
}

export function Mono({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`font-[family-name:var(--font-mono)] text-[var(--color-muted)] ${className}`}>
      {children}
    </span>
  );
}
