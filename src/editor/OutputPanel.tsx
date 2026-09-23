import React, { useEffect, useRef } from 'react';
import type { ActivityLogItem } from '../collaboration/store';
import { ActivityLogView } from '../components/ActivityLogView';
import { ReplPanel } from './ReplPanel';

export interface RunResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  elapsed: number;
  filename: string;
  timestamp: number;
}

export type BottomPanelTab = 'output' | 'logs' | 'repl';

interface OutputPanelProps {
  results: RunResult[];
  running: boolean;
  onClear: () => void;
  onClose: () => void;
  stdin: string;
  onStdinChange: (v: string) => void;
  activeTab?: BottomPanelTab;
  onTabChange?: (tab: BottomPanelTab) => void;
  activityLogs?: ActivityLogItem[];
  isHost?: boolean;
  onClearLogs?: () => void;
  onSelectFile?: (filename: string) => void;
  sessionId?: string;
}

export const OutputPanel: React.FC<OutputPanelProps> = ({
  results,
  running,
  onClear,
  onClose,
  stdin,
  onStdinChange,
  activeTab = 'output',
  onTabChange,
  activityLogs = [],
  isHost = false,
  onClearLogs = () => {},
  onSelectFile,
  sessionId,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeTab === 'output' && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [results, running, activeTab]);

  const mergeCount = activityLogs.filter((l) => l.type === 'merge').length;

  return (
    <div className="output-panel">
      {/* Panel title bar with tabs */}
      <div className="output-panel-bar">
        <div className="output-panel-tabs">
          <div
            className={`output-panel-tab ${activeTab === 'output' ? 'active' : ''}`}
            onClick={() => onTabChange?.('output')}
          >
            Output
            {results.length > 0 && (
              <span className="tab-counter-badge neutral">{results.length}</span>
            )}
          </div>
          <div
            className={`output-panel-tab ${activeTab === 'repl' ? 'active' : ''}`}
            onClick={() => onTabChange?.('repl')}
          >
            Interactive REPL
            <span className="tab-counter-badge accent">Python</span>
          </div>
          <div
            className={`output-panel-tab ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => onTabChange?.('logs')}
          >
            Activity & Merge Log
            {activityLogs.length > 0 && (
              <span className={`tab-counter-badge ${mergeCount > 0 ? 'accent' : 'neutral'}`}>
                {activityLogs.length}
              </span>
            )}
          </div>
        </div>

        <div className="output-panel-actions">
          {activeTab === 'output' && (
            <>
              {running && (
                <span className="output-running-label">
                  <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} />
                  Running…
                </span>
              )}
              <button
                className="output-action-btn"
                title="Clear output"
                onClick={onClear}
                disabled={running}
              >
                Clear
              </button>
            </>
          )}

          <button
            className="output-action-btn"
            title="Close panel"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Tab: Output / Execution */}
      {activeTab === 'output' && (
        <>
          {/* Stdin row */}
          <div className="output-stdin-row">
            <span className="output-stdin-label">stdin</span>
            <input
              className="output-stdin-input"
              type="text"
              placeholder="Optional input to pass to the program…"
              value={stdin}
              onChange={(e) => onStdinChange(e.target.value)}
            />
          </div>

          {/* Output scroll area */}
          <div className="output-scroll" ref={scrollRef}>
            {results.length === 0 && !running && (
              <div className="output-empty">
                Press <kbd>▶ Run</kbd> to execute the active file.
              </div>
            )}

            {results.map((r, i) => (
              <div key={i} className="output-run-block">
                {/* Run header */}
                <div className="output-run-header">
                  <span className={`output-exit-badge ${r.exit_code === 0 ? 'ok' : 'error'}`}>
                    {r.exit_code === 0 ? '✓' : `exit ${r.exit_code}`}
                  </span>
                  <span className="output-run-filename">{r.filename}</span>
                  <span className="output-run-meta">
                    {r.elapsed}s · {new Date(r.timestamp).toLocaleTimeString()}
                  </span>
                </div>

                {/* stdout */}
                {r.stdout && <pre className="output-stdout">{r.stdout}</pre>}

                {/* stderr */}
                {r.stderr && <pre className="output-stderr">{r.stderr}</pre>}

                {/* No output */}
                {!r.stdout && !r.stderr && (
                  <div className="output-no-output">Program exited with no output.</div>
                )}
              </div>
            ))}

            {running && (
              <div className="output-run-block">
                <div className="output-run-header">
                  <span className="output-exit-badge running">running</span>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Tab: Interactive REPL */}
      {activeTab === 'repl' && <ReplPanel sessionId={sessionId} />}

      {/* Tab: Activity & Merge Log */}
      {activeTab === 'logs' && (
        <ActivityLogView
          logs={activityLogs}
          isHost={isHost}
          onClear={onClearLogs}
          onSelectFile={onSelectFile}
        />
      )}
    </div>
  );
};
