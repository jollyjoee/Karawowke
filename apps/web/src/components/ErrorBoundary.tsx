'use client';

import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallbackTitle?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'Unexpected rendering error',
    };
  }

  public override componentDidCatch(error: Error): void {
    console.error('[Karawowke UI] ErrorBoundary caught:', error);
  }

  public override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="lounge-backdrop flex min-h-dvh items-center justify-center p-6">
          <div className="deck-panel max-w-md rounded-md p-6 text-left">
            <div className="font-mono text-xs tracking-[0.2em] text-[#e63946] uppercase">
              Deck Fault Recovery
            </div>
            <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold text-[#faf6ee]">
              {this.props.fallbackTitle ?? 'Display Interrupted'}
            </h2>
            <p className="mt-2 text-sm text-[#b0a391]">{this.state.errorMessage}</p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, errorMessage: null })}
              className="mt-5 rounded bg-[#f59e0b] px-4 py-2.5 font-mono text-xs font-bold tracking-wider text-[#0b0a09] uppercase transition hover:bg-[#ffb740]"
            >
              Reset Interface
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
