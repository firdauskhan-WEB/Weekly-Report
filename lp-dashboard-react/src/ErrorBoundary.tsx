import { Component, type ErrorInfo, type ReactNode } from "react"

// Clears the copies of cafe data this browser saved (keeps the chosen dates) and reloads
function clearSavedAndReload() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith("dashboard:") && k !== "dashboard:range").forEach((k) => localStorage.removeItem(k))
  } catch { /* storage blocked: reloading still helps */ }
  location.reload()
}

// Shows what went wrong instead of a blank white page when part of the dashboard crashes
export class ErrorBoundary extends Component<{ label: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.label} crashed:`, error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="wrap">
        <div className="box crash" role="alert">
          <h2>⚠️ {this.props.label} couldn't be shown</h2>
          <p>The page hit an error while drawing:</p>
          <pre>{error.message || String(error)}</pre>
          <p>This usually comes from an old saved copy of the data or a script answer the page didn't expect. Try clearing the saved data first; if the same message comes back, send it over.</p>
          <div className="crash-actions">
            <button className="primary" onClick={clearSavedAndReload} type="button">Clear saved data &amp; reload</button>
            <button onClick={() => location.reload()} type="button">Just reload</button>
          </div>
        </div>
      </div>
    )
  }
}
