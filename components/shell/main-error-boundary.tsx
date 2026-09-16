"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorState } from "@/components/ui/state";

interface Props {
  /** Changes here (the pathname) clear a caught error — navigating away recovers. */
  resetKey: string;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * Catches a render crash in the main pane so the rail and top bar stay
 * usable and the user gets a Retry instead of a blank screen. React only
 * exposes error boundaries as class components.
 */
export class MainErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console is the right sink here: this is a client render crash, and
    // the app's structured logger is server-side.
    console.error("Main pane crashed", error, info.componentStack);
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <ErrorState
          message="This view hit an error."
          onRetry={() => {
            this.setState({ failed: false });
          }}
        />
      );
    }
    return this.props.children;
  }
}
