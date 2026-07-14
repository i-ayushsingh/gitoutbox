import { useEffect, useState } from "react";
import { Check, X, Loader2 } from "lucide-react";
import { api, type GitCheck as GitCheckResult } from "../lib/ipc";
import { Button, Mono } from "./ui";
import { brand } from "../lib/brand";

// Onboarding screen 2 (spec §24): verify Git + show identity. Never modifies
// Git identity — read-only.
export function GitCheckScreen({ onContinue }: { onContinue: () => void }) {
  const [result, setResult] = useState<GitCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .gitCheck()
      .then(setResult)
      .catch((e) => setError(String(e)));
  }, []);

  const ready = result?.installed && !!result.user_name && !!result.user_email;

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-4">
          <img src={brand.primaryLogo} className="h-16 object-contain" alt="GitOutbox Logo" />
          <h1 className="text-base font-semibold text-center">Prepare work now. Ship it on your schedule.</h1>
        </div>

        <div className="rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="border-b border-[var(--color-border)] px-4 py-2.5 text-xs font-medium text-[var(--color-muted)]">
            Git environment
          </div>

          {error && (
            <div className="px-4 py-3 text-xs text-[var(--color-danger)]">{error}</div>
          )}

          {!result && !error && (
            <div className="flex items-center gap-2 px-4 py-4 text-xs text-[var(--color-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking Git…
            </div>
          )}

          {result && (
            <div className="divide-y divide-[var(--color-border)]">
              <Row
                ok={result.installed}
                label="Git installed"
                value={result.version ?? "Not found"}
              />
              <Row
                ok={!!result.user_name}
                label="user.name"
                value={result.user_name ?? "Not configured"}
              />
              <Row
                ok={!!result.user_email}
                label="user.email"
                value={result.user_email ?? "Not configured"}
              />
            </div>
          )}
        </div>

        {result && !ready && (
          <p className="mt-3 text-xs text-[var(--color-faint)]">
            {!result.installed
              ? "Install Git and restart GitOutbox to continue."
              : "Set your Git identity with git config user.name and user.email. GitOutbox will not change it for you."}
          </p>
        )}

        <div className="mt-5 flex justify-end">
          <Button variant="primary" onClick={onContinue} disabled={!ready}>
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        {ok ? (
          <Check className="h-4 w-4 text-[var(--color-ok)]" strokeWidth={2} />
        ) : (
          <X className="h-4 w-4 text-[var(--color-danger)]" strokeWidth={2} />
        )}
        <span className="text-xs text-[var(--color-muted)]">{label}</span>
      </div>
      <Mono>{value}</Mono>
    </div>
  );
}
