import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('JARVIS frontend fault:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="min-h-screen bg-void p-8 text-slate-100">
        <section className="mx-auto mt-20 max-w-3xl rounded border border-warning/40 bg-panel p-6 shadow-alert">
          <p className="text-xs uppercase tracking-[0.22em] text-warning">Frontend fault</p>
          <h1 className="mt-3 text-2xl font-semibold">JARVIS failed to initialize cleanly.</h1>
          <p className="mt-4 text-slate-300">
            A browser runtime error occurred before the HUD could finish booting, Sir. The details are below.
          </p>
          <pre className="mt-4 overflow-auto rounded bg-void p-4 text-sm text-warning">
            {this.state.error?.stack || this.state.error?.message || String(this.state.error)}
          </pre>
        </section>
      </main>
    );
  }
}
