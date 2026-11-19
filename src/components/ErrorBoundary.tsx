import React, { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    message: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message || 'Nastala neočakávaná chyba aplikácie.',
    };
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950 p-6 text-slate-100">
          <div className="max-w-lg w-full border border-slate-800 bg-slate-900 rounded-xl p-6 space-y-4">
            <h2 className="font-display text-2xl font-bold text-rose-400">
              Chyba behu hry
            </h2>
            <p className="text-sm text-slate-300 break-words leading-relaxed">
              {this.state.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-sm font-semibold bg-amber-500 text-slate-950 rounded-lg hover:bg-amber-400 transition-colors"
            >
              Reštartovať hru
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
