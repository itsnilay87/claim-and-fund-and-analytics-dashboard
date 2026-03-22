/**
 * @module main
 * @description Dashboard entry point — mounts <App> with UISettingsProvider and ErrorBoundary.
 *
 * Renders the standalone analytics dashboard into #root.  Wraps the app
 * in UISettingsProvider (theme context) and a minimal ErrorBoundary.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { UISettingsProvider } from './theme';

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return React.createElement('pre', {
        style: { color: '#EF4444', background: '#111', padding: 24, margin: 24, fontSize: 14, whiteSpace: 'pre-wrap', borderRadius: 8 }
      }, `REACT ERROR:\n${this.state.error.message}\n\n${this.state.error.stack}`);
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <UISettingsProvider>
        <App />
      </UISettingsProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
