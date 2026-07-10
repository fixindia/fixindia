import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  message?: string;
}

/**
 * Top-level React error boundary (7.2). Without this, a single render error
 * in any child white-screens the whole SPA. Renders a friendly fallback with a
 * reload button and surfaces the error message only in development.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
     
    console.error('[ErrorBoundary] Render error:', error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, message: undefined });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      const isDev = import.meta.env.DEV;
      return (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#050505] text-center px-6">
          <div className="text-5xl mb-4">⚠️</div>
          <h1 className="text-xl font-black uppercase tracking-widest text-emerald-400 mb-2">
            Something went wrong
          </h1>
          <p className="text-white/50 text-sm mb-6 max-w-md">
            The app hit an unexpected error. Reloading usually fixes it.
          </p>
          {isDev && this.state.message && (
            <pre className="text-rose-400/80 text-xs bg-white/5 border border-white/10 rounded p-3 mb-6 max-w-lg overflow-auto text-left">
              {this.state.message}
            </pre>
          )}
          <button
            onClick={this.handleReload}
            className="bg-emerald-500 hover:bg-emerald-600 text-black font-black uppercase tracking-widest px-6 py-3 rounded transition-colors"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
