import { useState, useEffect } from "react";
import {
  Check,
  X,
  Loader2,
  FolderGit2,
  GitCommitHorizontal,
  CalendarClock,
  ArrowRight,
  Sparkles,
  Rocket,
  ShieldCheck,
  ChevronRight,
} from "lucide-react";
import { api, type GitCheck as GitCheckResult } from "../lib/ipc";
import { Button, Mono } from "./ui";
import { brand } from "../lib/brand";

interface OnboardingFlowProps {
  onComplete: () => void;
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [gitCheck, setGitCheck] = useState<GitCheckResult | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (step === 2 && !gitCheck && !checking) {
      setChecking(true);
      api
        .gitCheck()
        .then((res) => {
          setGitCheck(res);
          setCheckError(null);
        })
        .catch((err) => setCheckError(String(err)))
        .finally(() => setChecking(false));
    }
  }, [step, gitCheck, checking]);

  const readyForStep2 =
    gitCheck?.installed && !!gitCheck.user_name && !!gitCheck.user_email;

  const nextStep = () => {
    if (step < 4) setStep((s) => (s + 1) as 1 | 2 | 3 | 4);
    else onComplete();
  };

  const prevStep = () => {
    if (step > 1) setStep((s) => (s - 1) as 1 | 2 | 3 | 4);
  };

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-[var(--color-bg)] p-6 select-none">
      {/* Progress Dots */}
      <div className="mb-8 flex items-center gap-2">
        {[1, 2, 3, 4].map((s) => (
          <div
            key={s}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              s === step
                ? "w-8 bg-[var(--color-accent)]"
                : s < step
                ? "w-3 bg-[var(--color-border-strong)]"
                : "w-3 bg-[var(--color-border)]"
            }`}
          />
        ))}
      </div>

      <div className="w-full max-w-lg rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-2xl transition-all duration-300">
        {/* Screen 1: Welcome */}
        {step === 1 && (
          <div className="flex flex-col items-center text-center animate-fadeIn">
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-[var(--color-surface-2)] border border-[var(--color-border)] shadow-inner">
              <img src={brand.appIcon} alt="GitOutbox Logo" className="h-14 w-14 object-contain" />
            </div>

            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1 text-[11px] text-[var(--color-accent)] font-medium">
              <Sparkles className="h-3 w-3" /> Welcome to GitOutbox
            </div>

            <h1 className="mt-2 text-2xl font-bold tracking-tight text-[var(--color-text)]">
              Commit on your terms
            </h1>

            <p className="mt-3 text-sm text-[var(--color-muted)] leading-relaxed max-w-sm">
              Schedule commits. Stay focused.<br />
              Git when you want—not when you have to.
            </p>

            <div className="mt-8 flex w-full items-center justify-between border-t border-[var(--color-border)] pt-5">
              <button
                onClick={onComplete}
                className="text-xs text-[var(--color-faint)] hover:text-[var(--color-text)] transition-colors"
              >
                Skip Onboarding
              </button>
              <Button variant="primary" onClick={nextStep} className="px-5">
                Continue <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Screen 2: System Check */}
        {step === 2 && (
          <div className="flex flex-col animate-fadeIn">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-accent)]">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[var(--color-text)]">System Check</h2>
                <p className="text-xs text-[var(--color-muted)]">Verifying local Git execution environment</p>
              </div>
            </div>

            <div className="mt-3 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] divide-y divide-[var(--color-border)]">
              {checkError ? (
                <div className="p-4 text-xs text-[var(--color-danger)]">{checkError}</div>
              ) : checking && !gitCheck ? (
                <div className="flex items-center gap-3 p-4 text-xs text-[var(--color-muted)]">
                  <Loader2 className="h-4 w-4 animate-spin text-[var(--color-accent)]" /> Checking environment…
                </div>
              ) : (
                <>
                  <CheckRow
                    ok={!!gitCheck?.installed}
                    label="Git Installed"
                    value={gitCheck?.installed ? "Detected" : "Not Found"}
                  />
                  <CheckRow
                    ok={!!gitCheck?.installed}
                    label="Git Version"
                    value={gitCheck?.version ?? "Unknown"}
                  />
                  <CheckRow
                    ok={!!gitCheck?.user_name && !!gitCheck?.user_email}
                    label="Authentication Ready"
                    value={
                      gitCheck?.user_name
                        ? `${gitCheck.user_name} <${gitCheck.user_email}>`
                        : "Config missing"
                    }
                  />
                  <CheckRow
                    ok={!!readyForStep2}
                    label="Environment Ready"
                    value={readyForStep2 ? "Ready to schedule" : "Setup needed"}
                  />
                </>
              )}
            </div>

            {!readyForStep2 && gitCheck && (
              <p className="mt-3 text-xs text-[var(--color-warn)]">
                {!gitCheck.installed
                  ? "Git CLI was not found. Please install Git to use GitOutbox."
                  : "Set git config user.name and user.email to proceed."}
              </p>
            )}

            <div className="mt-6 flex w-full items-center justify-between border-t border-[var(--color-border)] pt-5">
              <Button variant="ghost" onClick={prevStep}>
                Back
              </Button>
              <Button variant="primary" onClick={nextStep} disabled={!readyForStep2}>
                Continue <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Screen 3: How GitOutbox Works */}
        {step === 3 && (
          <div className="flex flex-col animate-fadeIn">
            <div className="text-center mb-6">
              <h2 className="text-base font-semibold text-[var(--color-text)]">How GitOutbox Works</h2>
              <p className="text-xs text-[var(--color-muted)]">Three simple steps to automate your commits safely</p>
            </div>

            <div className="flex flex-col gap-3">
              <StepCard
                num="1"
                icon={FolderGit2}
                title="Add Repository"
                desc="Point GitOutbox to any local Git repository on your system."
              />
              <StepCard
                num="2"
                icon={GitCommitHorizontal}
                title="Create Draft Commits"
                desc="Stage changes, assign file paths, and write commit messages."
              />
              <StepCard
                num="3"
                icon={CalendarClock}
                title="Schedule Execution"
                desc="Pick exact release times or auto-distribute across your work week."
              />
            </div>

            <div className="mt-6 flex w-full items-center justify-between border-t border-[var(--color-border)] pt-5">
              <button
                onClick={onComplete}
                className="text-xs text-[var(--color-faint)] hover:text-[var(--color-text)] transition-colors"
              >
                Skip
              </button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={prevStep}>
                  Back
                </Button>
                <Button variant="primary" onClick={nextStep}>
                  Continue <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Screen 4: You're Ready */}
        {step === 4 && (
          <div className="flex flex-col items-center text-center animate-fadeIn">
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--color-ok)_15%,transparent)] border border-[color-mix(in_srgb,var(--color-ok)_30%,transparent)] text-[var(--color-ok)] shadow-lg">
              <Rocket className="h-10 w-10 animate-bounce" />
            </div>

            <h2 className="text-2xl font-bold tracking-tight text-[var(--color-text)]">
              You're Ready
            </h2>

            <p className="mt-2 text-sm text-[var(--color-muted)] max-w-xs">
              Start scheduling commits and shipping code on your own schedule.
            </p>

            <div className="mt-8 flex w-full flex-col gap-2 border-t border-[var(--color-border)] pt-5">
              <Button variant="primary" onClick={onComplete} className="w-full py-2.5 text-sm justify-center">
                Open GitOutbox <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CheckRow({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3.5 py-2.5 text-xs">
      <div className="flex items-center gap-2.5">
        {ok ? (
          <Check className="h-4 w-4 text-[var(--color-ok)] shrink-0" strokeWidth={2.5} />
        ) : (
          <X className="h-4 w-4 text-[var(--color-danger)] shrink-0" strokeWidth={2.5} />
        )}
        <span className="font-medium text-[var(--color-text)]">{label}</span>
      </div>
      <Mono className="text-[11px] text-[var(--color-muted)] truncate max-w-[200px]">{value}</Mono>
    </div>
  );
}

function StepCard({
  num,
  icon: Icon,
  title,
  desc,
}: {
  num: string;
  icon: typeof FolderGit2;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-3.5 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 transition-colors hover:border-[var(--color-border-strong)]">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-xs font-bold text-[var(--color-accent)]">
        {num}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text)]">
          <Icon className="h-3.5 w-3.5 text-[var(--color-muted)]" />
          {title}
        </div>
        <div className="mt-0.5 text-[11px] text-[var(--color-muted)] leading-normal">{desc}</div>
      </div>
    </div>
  );
}
