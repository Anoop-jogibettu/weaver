import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface ReplPanelProps {
  sessionId?: string;
}

export const ReplPanel: React.FC<ReplPanelProps> = ({ sessionId }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    term.current = new Terminal({
      theme: { background: '#0d0f14', foreground: '#e2e2e2' },
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 13,
    });

    const fitAddon = new FitAddon();
    term.current.loadAddon(fitAddon);
    term.current.open(terminalRef.current);
    
    // Fit after a tiny delay to ensure container is fully rendered
    setTimeout(() => {
      try { fitAddon.fit(); } catch (e) {}
    }, 50);

    // Connect to WebSocket
    ws.current = new WebSocket(`ws://${window.location.hostname}:1234/terminal`);

    ws.current.onopen = () => {
      term.current?.writeln('\x1b[32m=== Weaver Interactive Terminal ===\x1b[0m');
      term.current?.writeln('Connected to sandboxed bash shell.');
      term.current?.writeln('Run "python3 script.py" or use interactive REPL.\r\n');
    };

    ws.current.onmessage = (event) => {
      if (typeof event.data === 'string') {
        term.current?.write(event.data);
      }
    };

    term.current.onData((data) => {
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(data);
      }
    });

    const handleResize = () => {
      try { fitAddon.fit(); } catch (e) {}
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      ws.current?.close();
      term.current?.dispose();
    };
  }, []);

  return (
    <div className="repl-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#0d0f14' }}>
      <div className="repl-toolbar">
        <div className="repl-status-badge">
          <span className="repl-status-dot" style={{ backgroundColor: '#2ea043' }} />
          <span>Interactive Shell (xterm.js)</span>
        </div>
      </div>
      <div 
        ref={terminalRef} 
        style={{ flex: 1, overflow: 'hidden', padding: '10px' }} 
        className="xterm-container"
      />
    </div>
  );
};
