import { Component } from 'react'

/**
 * Generic error boundary. Renders a visible error panel instead of a blank
 * page when a child component throws during render or in an effect.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info)
    this.setState({ info })
  }

  handleReload = () => {
    this.setState({ error: null, info: null })
    if (typeof window !== 'undefined') window.location.reload()
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white p-6">
          <div className="max-w-2xl mx-auto mt-12 rounded-xl border border-red-300 dark:border-red-500/30 bg-white dark:bg-slate-900 p-6 shadow-lg">
            <h1 className="text-lg font-bold text-red-600 dark:text-red-400 mb-2">
              Something went wrong rendering this page
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              The error below was caught and the rest of the app is still safe.
            </p>
            <pre className="text-xs bg-slate-100 dark:bg-slate-950 p-3 rounded overflow-auto max-h-64 whitespace-pre-wrap break-words">
{String(this.state.error?.stack || this.state.error?.message || this.state.error)}
            </pre>
            <div className="mt-4 flex gap-2">
              <button
                onClick={this.handleReload}
                className="px-3 py-1.5 text-sm rounded-md bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                Reload page
              </button>
              <a
                href="/login"
                className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Go to login
              </a>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
