import React, { useState } from 'react';
import { runRepl } from '../api/client';

interface ReplPanelProps {
  sessionId?: string;
}

interface ConsoleEntry {
  code: string;
  stdout: string;
  stderr: string;
}

export const ReplPanel: React.FC<ReplPanelProps> = ({ sessionId }) => {
  const [code, setCode] = useState('');
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [running, setRunning] = useState(false);

  const execute = async () => {
    const snippet = code.trim();
    if (!snippet || running) return;

    setRunning(true);
    try {
      const result = await runRepl(snippet, sessionId);
      setEntries((previous) => [...previous, {
        code: snippet,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
      }]);
      setCode('');
    } catch (error) {
      setEntries((previous) => [...previous, {
        code: snippet,
        stdout: '',
        stderr: error instanceof Error ? error.message : 'The Python service could not be reached.',
      }]);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="python-console">
      <div className="python-console-toolbar">
        <span><strong>Python</strong> interactive window</span>
        <button className="output-action-btn" onClick={() => setEntries([])} disabled={running}>
          Clear
        </button>
      </div>

      <div className="python-console-history" aria-live="polite">
        {entries.length === 0 && (
          <div className="output-empty">Run a Python expression or statement below. Variables remain available for this workspace.</div>
        )}
        {entries.map((entry, index) => (
          <div className="python-console-entry" key={`${entry.code}-${index}`}>
            <pre className="python-console-input">&gt;&gt;&gt; {entry.code}</pre>
            {entry.stdout && <pre className="output-stdout">{entry.stdout}</pre>}
            {entry.stderr && <pre className="output-stderr">{entry.stderr}</pre>}
          </div>
        ))}
      </div>

      <div className="python-console-composer">
        <textarea
          className="python-console-textarea"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              execute();
            }
          }}
          placeholder="print('Hello, Weaver')"
          spellCheck={false}
          aria-label="Python code"
        />
        <button className="editor-run-btn" onClick={execute} disabled={running || !code.trim()}>
          {running ? 'Running…' : 'Run'}
        </button>
      </div>
    </div>
  );
};
