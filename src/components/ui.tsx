import type { LucideIcon } from "lucide-react";

// Restrained empty state: icon, title, hint. No oversized cards.
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
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <Icon className="h-6 w-6 text-[var(--color-faint)]" strokeWidth={1.5} />
      <div className="text-[var(--color-muted)]">{title}</div>
      {hint && (
        <div className="max-w-sm text-xs text-[var(--color-faint)]">{hint}</div>
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
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex items-center gap-2 rounded-[var(--radius-control)] px-3 py-1.5 text-xs font-medium transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none";
  const styles = {
    default:
      "border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-text)] hover:bg-[var(--color-border)]",
    primary:
      "bg-[var(--color-accent)] text-[var(--color-accent-fg)] hover:brightness-110",
    ghost:
      "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles}`}>
      {children}
    </button>
  );
}

export function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-[family-name:var(--font-mono)] text-[var(--color-muted)]">
      {children}
    </span>
  );
}
