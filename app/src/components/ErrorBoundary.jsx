/**
 * @module ErrorBoundary
 * @description React class-based error boundary with retry UI.
 *
 * Catches render errors in child components and displays a styled
 * error card with message and "Try Again" button.  Accepts a `label`
 * prop for contextual error messaging.
 *
 * @prop {string} [label] - Heading text shown when an error is caught.
 * @prop {React.ReactNode} children - Components to wrap.
 */
import { Component } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-8 max-w-lg text-center">
            <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-lg font-bold text-white mb-2">
              {this.props.label || 'Something went wrong'}
            </h2>
            <p className="text-sm text-slate-400 mb-6">
              {this.state.error?.message || 'An unexpected error occurred. Please try again.'}
            </p>
            <button
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
