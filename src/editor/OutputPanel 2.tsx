import React, { useEffect, useRef, useState, useCallback } from 'react';
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

export type BottomPanelTab = 'problems' | 'output' | 'logs' | 'repl';

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
  lintErrors?: Array<{ line: number; message: string }>;
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
  lintErrors = [],
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(250);
  const isDragging = useRef(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return;
    const newHeight = window.innerHeight - e.clientY;
    setHeight(Math.max(120, Math.min(newHeight, window.innerHeight * 0.8)));
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  useEffect(() => {
    if (activeTab === 'output' && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [results, running, activeTab]);

  const mergeCount = activityLogs.filter((l) => l.type === 'merge').length;

  return (
    <div className="output-panel" style={{ height: `${height}px` }}>
      <div 
        className="panel-resizer" 
        onMouseDown={handleMouseDown}
        style={{ height: '4px', width: '100%', cursor: 'row-resize', position: 'absolute', top: '-2px', zIndex: 10 }}
      />
      {/* Panel title bar with tabs */}
      <div className="output-panel-bar">
        <div className="output-panel-tabs">
          <div
            className={`output-panel-tab ${activeTab === 'problems' ? 'active' : ''}`}
            onClick={() => onTabChange?.('problems')}
          >
            Problems
            {lintErrors.length > 0 && (
              <span className="tab-counter-badge error">{lintErrors.length}</span>
            )}
          </div>
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

      {/* Tab: Problems */}
      {activeTab === 'problems' && (
        <div className="output-content logs-content" style={{ padding: '8px 0', overflowY: 'auto', flex: 1 }}>
          {lintErrors.length === 0 ? (
            <div style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 12 }}>
              No problems have been detected in the workspace.
            </div>
          ) : (
            <div className="log-list">
              {lintErrors.map((err, i) => (
                <div key={i} className="log-item" style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ color: 'var(--red)', display: 'flex' }}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path fillRule="evenodd" clipRule="evenodd" d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm9-3.5a1 1 0 11-2 0 1 1 0 012 0zM7.5 7v4.5h1V7h-1z" />
                      </svg>
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                      Syntax Error
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      Line {err.line}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 22 }}>
                    {err.message}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
