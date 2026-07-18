import { h, Component, render } from 'preact';
import type { ComponentChildren } from 'preact';
import App from './App';
import './styles.css';

interface ErrorBoundaryState {
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: ComponentChildren;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'monospace', color: '#7c3aed', background: '#faf5ff', minHeight: '100vh' }}>
          <h2>Application Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {String(this.state.error)}{'\n'}{this.state.error?.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
  document.getElementById('root')!,
);
