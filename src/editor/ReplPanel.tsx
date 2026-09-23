import React, { useState, useRef, useEffect, useCallback } from 'react';
import { runRepl } from '../api/client';

interface ReplEntry {
  id: string;
  command: string;
  stdout: string;
  stderr: string;
  success: boolean;
  timestamp: number;
}

interface ReplPanelProps {
  sessionId?: string;
}

export const ReplPanel: React.FC<ReplPanelProps> = ({ sessionId }) => {
  const [history, setHistory] = useState<ReplEntry[]>([
    {
      id: 'init',
      command: '# Python 3.x Interactive REPL session connected',
      stdout: 'Type Python expressions or statements. State persists across commands.',
      stderr: '',
      success: true,
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, busy]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cmd = input.trim();
    if (!cmd || busy) return;

    setInput('');
    setBusy(true);
    setCmdHistory((prev) => [...prev, cmd]);
    setHistoryIndex(-1);

    try {
      const res = await runRepl(cmd, sessionId || 'default-session');
      setHistory((prev) => [
        ...prev,
        {
          id: `repl-${Date.now()}-${Math.random()}`,
          command: cmd,
          stdout: res.stdout || '',
          stderr: res.stderr || '',
          success: res.success ?? (res.exit_code === 0),
          timestamp: Date.now(),
        },
      ]);
    } catch (err: any) {
      setHistory((prev) => [
        ...prev,
        {
          id: `repl-err-${Date.now()}`,
          command: cmd,
          stdout: '',
          stderr: err.message || 'Execution error',
          success: false,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, busy, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (cmdHistory.length === 0) return;
      const nextIndex = historyIndex === -1 ? cmdHistory.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      setInput(cmdHistory[nextIndex] || '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex === -1) return;
      const nextIndex = historyIndex + 1;
      if (nextIndex >= cmdHistory.length) {
        setHistoryIndex(-1);
        setInput('');
      } else {
        setHistoryIndex(nextIndex);
        setInput(cmdHistory[nextIndex] || '');
      }
    }
  };

  const handleClear = () => {
    setHistory([]);
    inputRef.current?.focus();
  };

  return (
    <div className="repl-panel">
      <div className="repl-toolbar">
        <div className="repl-status-badge">
          <span className="repl-status-dot" />
          <span>Interactive REPL</span>
          <span className="repl-session-label">{sessionId ? `Session: ${sessionId}` : 'Local'}</span>
        </div>
        <div className="repl-toolbar-actions">
          <button className="output-action-btn" onClick={handleClear} title="Clear terminal">
            Clear
          </button>
        </div>
      </div>

      <div className="repl-output" onClick={() => inputRef.current?.focus()}>
        {history.map((entry) => (
          <div key={entry.id} className="repl-entry">
            <div className="repl-prompt-line">
              <span className="repl-prompt-arrow">&gt;&gt;&gt;</span>
              <span className="repl-cmd-text">{entry.command}</span>
            </div>
            {entry.stdout && <pre className="repl-stdout">{entry.stdout}</pre>}
            {entry.stderr && <pre className="repl-stderr">{entry.stderr}</pre>}
          </div>
        ))}

        {busy && (
          <div className="repl-busy-line">
            <span className="repl-prompt-arrow">&gt;&gt;&gt;</span>
            <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5, marginLeft: 6 }} />
            <span className="repl-evaluating">evaluating…</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form className="repl-input-bar" onSubmit={handleSubmit}>
        <span className="repl-prompt-arrow">&gt;&gt;&gt;</span>
        <input
          ref={inputRef}
          type="text"
          className="repl-input-field"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type python expression (e.g. 2 + 2, x = [1,2,3], math.sqrt(16))..."
          disabled={busy}
          autoFocus
        />
        <button type="submit" className="repl-send-btn" disabled={busy || !input.trim()}>
          Run
        </button>
      </form>
    </div>
  );
};
