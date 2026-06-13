import { Component, type ReactNode, type ErrorInfo } from 'react'
import { RefreshCw, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'

interface Props  { children: ReactNode; fallback?: ReactNode }
interface State  { hasError: boolean; error: Error | null; showDetails: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, showDetails: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  reset = () => this.setState({ hasError: false, error: null, showDetails: false })

  render() {
    if (!this.state.hasError) return this.props.children

    if (this.props.fallback) return this.props.fallback

    const { error, showDetails } = this.state

    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl border border-red-100 shadow-sm max-w-md w-full p-8 text-center space-y-4">
          <div className="mx-auto w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-danger" />
          </div>

          <div>
            <h2 className="text-lg font-bold text-gray-900">Something went wrong</h2>
            <p className="text-sm text-gray-500 mt-1">
              An unexpected error occurred on this page. Your data is safe.
            </p>
          </div>

          <div className="flex justify-center gap-3">
            <button
              onClick={this.reset}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-light transition-colors"
            >
              <RefreshCw className="w-4 h-4" /> Try Again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              Reload Page
            </button>
          </div>

          {error && (
            <div>
              <button
                onClick={() => this.setState(s => ({ showDetails: !s.showDetails }))}
                className="flex items-center gap-1 mx-auto text-xs text-gray-500 hover:text-gray-600"
              >
                {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {showDetails ? 'Hide' : 'Show'} error details
              </button>
              {showDetails && (
                <pre className="mt-2 text-left text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-auto max-h-40 text-red-700 font-mono">
                  {error.message}
                  {'\n'}
                  {error.stack?.split('\n').slice(1, 5).join('\n')}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }
}
