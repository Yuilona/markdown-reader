import { Component, type ErrorInfo, type ReactNode } from 'react';

import * as logger from '../../lib/logger';
import styles from './ErrorBoundary.module.css';

/**
 * React error boundary (R12.6, PR-8).
 *
 * Wraps the document tree ONLY — NOT the whole app. If the boundary
 * itself caught the Titlebar (and the Titlebar crashed), the user would
 * have no way to close the window. By keeping Titlebar + theme +
 * lightbox + toast providers OUTSIDE the boundary, a render crash inside
 * DocumentView still leaves the user with:
 *   - A working titlebar (minimize / close).
 *   - The theme system + 200ms fade behavior.
 *   - The toast/log infrastructure (for any subsequent error).
 *   - The "重新加载" button this fallback renders.
 *
 * Reset semantics:
 *   The `onReset` prop is invoked when the user clicks the "重新加载"
 *   button. App.tsx wires it to `setDoc(null)` then re-loads from the
 *   current path. The boundary itself watches `resetKey` — when the
 *   parent changes that key (e.g. via the doc swap that follows the
 *   reset call), the boundary's internal "I have a crash" state is
 *   cleared and children re-render normally.
 *
 * Logging:
 *   `componentDidCatch` calls `logger.error(...)` so the crash makes it
 *   into the rolling log file (R10.9, R12.7) on top of the console
 *   error React emits by default in development.
 *
 * Class component? React error boundaries require it. There's no hook
 *   equivalent yet (as of React 18). Keep this class self-contained;
 *   any state that needs hook-only APIs should live in the wrapped
 *   children, not here.
 */

interface ErrorBoundaryProps {
  /** Children to render under the boundary. When a render error is
   *  caught, the fallback UI replaces these. */
  children: ReactNode;
  /** Optional reset callback. When the user clicks the "重新加载"
   *  button, this is invoked synchronously before the boundary clears
   *  its state. App.tsx uses it to re-trigger document loading. */
  onReset?: () => void;
  /**
   * When this value changes, the boundary clears any captured error and
   * re-renders its children. Pair with the document path so loading a
   * new file naturally retries — even if the user didn't click the
   * reset button.
   */
  resetKey?: string | number | null;
}

interface ErrorBoundaryState {
  error: Error | null;
  /** Stored alongside `error` so the disclosure can show the React
   *  component stack alongside the JS stack trace. */
  componentStack: string | null;
}

const INITIAL_STATE: ErrorBoundaryState = {
  error: null,
  componentStack: null,
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = INITIAL_STATE;

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // Capturing the error in state flips the next render into the
    // fallback path. `componentStack` is populated separately in
    // `componentDidCatch` (which has access to the React-specific
    // `ErrorInfo`).
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    // Log to the rolling file logger. The console.error mirror inside
    // logger.error keeps DevTools output intact too.
    logger.error('ErrorBoundary caught a render error:', error, info.componentStack ?? '');
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    // When the parent bumps `resetKey`, clear our captured error so the
    // children re-render. We DON'T want this to also fire `onReset` —
    // the reset prop is a USER-INITIATED retry, not the doc-change
    // recovery.
    if (
      this.state.error !== null &&
      this.props.resetKey !== prevProps.resetKey
    ) {
      this.setState(INITIAL_STATE);
    }
  }

  private handleReset = (): void => {
    // Fire the parent callback FIRST so any state setup (e.g. re-fetch
    // the document) happens before we clear our internal state. The
    // parent's setState will trigger a re-render that finds us in
    // "no error" mode and shows the children again.
    if (this.props.onReset) {
      try {
        this.props.onReset();
      } catch (err) {
        // The reset itself crashed — log but don't escalate; the
        // existing fallback stays visible.
        logger.error('ErrorBoundary onReset handler threw:', err);
      }
    }
    this.setState(INITIAL_STATE);
  };

  render() {
    const { error, componentStack } = this.state;
    if (error === null) {
      return this.props.children;
    }

    // Fallback UI: centered card. Title + friendly message + expandable
    // details + reset button.
    const detailParts: string[] = [];
    if (error.stack) {
      detailParts.push(error.stack);
    } else {
      detailParts.push(`${error.name}: ${error.message}`);
    }
    if (componentStack) {
      detailParts.push('---');
      detailParts.push('Component stack:');
      detailParts.push(componentStack);
    }
    const detailsText = detailParts.join('\n');

    return (
      <div className={styles.wrapper} role="alert" aria-live="assertive">
        <div className={styles.card}>
          <h2 className={styles.title}>出错了</h2>
          <p className={styles.message}>渲染文档时发生了错误。</p>
          <pre className={styles.errMessage}>{error.message || error.name}</pre>
          <details className={styles.details}>
            <summary className={styles.detailsSummary}>查看技术详情</summary>
            <pre className={styles.detailsBody}>{detailsText}</pre>
          </details>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.resetBtn}
              onClick={this.handleReset}
            >
              重新加载
            </button>
          </div>
        </div>
      </div>
    );
  }
}
