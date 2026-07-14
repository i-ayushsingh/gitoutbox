import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./ui";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 bg-[var(--color-bg)] p-8 text-center">
          <AlertTriangle className="h-8 w-8 text-[var(--color-danger)]" strokeWidth={1.5} />
          <div className="text-sm font-medium text-[var(--color-text)]">
            Something went wrong
          </div>
          <div className="max-w-md text-xs text-[var(--color-muted)]">
            {this.state.error?.message ?? "An unexpected error occurred."}
          </div>
          <Button
            variant="primary"
            onClick={() => {
              this.setState({ hasError: false, error: null });
            }}
          >
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
