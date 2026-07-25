import { OnboardingFlow } from "./OnboardingFlow";

export function GitCheckScreen({ onContinue }: { onContinue: () => void }) {
  return <OnboardingFlow onComplete={onContinue} />;
}
