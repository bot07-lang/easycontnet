import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches render/runtime errors in its subtree so a single crash shows a
 * recoverable panel instead of unmounting the whole app to a blank white
 * screen. `resetKeys` clears the error automatically when navigation changes
 * (e.g. the user goes back to the items list), so they stay in the app.
 */
type Props = {
  children: ReactNode;
  /** When any value here changes, the boundary clears its error and re-renders. */
  resetKeys?: unknown[];
  /** Optional label for the thing that failed, shown in the message. */
  label?: string;
};
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface the real error + component stack in the console for debugging —
    // production React otherwise minifies this away.
    console.error('Caught by ErrorBoundary:', error, info.componentStack);
  }

  override componentDidUpdate(prev: Props) {
    // Auto-recover when the caller navigates elsewhere.
    if (this.state.error && !shallowEqual(prev.resetKeys, this.props.resetKeys)) {
      this.setState({ error: null });
    }
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-base font-semibold text-red-800">Something went wrong{this.props.label ? ` in ${this.props.label}` : ''}.</p>
          <p className="mt-2 break-words text-sm text-red-600">{error.message || String(error)}</p>
          <div className="mt-4 flex justify-center gap-2">
            <button type="button" onClick={() => this.setState({ error: null })}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">
              Try again
            </button>
            <button type="button" onClick={() => window.location.reload()}
                    className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100">
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}

function shallowEqual(a?: unknown[], b?: unknown[]) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => Object.is(v, b[i]));
}
