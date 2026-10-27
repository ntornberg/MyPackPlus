import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

import { AppLogger } from "../../../utils/logger";

type Props = {
  /** Names the area in logs, e.g. "planner drawer". */
  name: string;
  children?: ReactNode;
  /** Replaces the default notice, e.g. for small inline cards. */
  fallback?: ReactNode;
};

type State = { error: Error | null };

/**
 * Keeps a render crash from blanking the whole React root: logs it and shows
 * a notice with a way to try rendering again.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    AppLogger.error(
      `[ErrorBoundary] ${this.props.name} crashed`,
      error,
      info.componentStack,
    );
  }

  private reset = () => this.setState({ error: null });

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div
        role="alert"
        className="m-2 space-y-2 rounded-md border border-destructive/40 bg-background p-3 text-sm text-destructive"
      >
        <p>Something went wrong in MyPack Plus.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={this.reset}>
            Try again
          </Button>
          <Button size="sm" variant="ghost" onClick={() => location.reload()}>
            Refresh page
          </Button>
        </div>
      </div>
    );
  }
}
