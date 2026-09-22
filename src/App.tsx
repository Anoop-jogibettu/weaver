import React, { useState, useCallback, useEffect, useRef } from 'react';
import './index.css';
import { SessionGate } from './components/SessionGate';
import { CollabPanel } from './components/CollabPanel';
import { ConflictModal } from './conflict-ui/ConflictModal';
import { CodeEditor } from './editor/CodeEditor';
import { ResearchDashboard } from './research-dashboard/ResearchDashboard';
import {
  initCollaboration,
  getConnectedUsers,
  getSyncStatus,
  getRecentChanges,
  recordChange,
  getLocalUser,
  UserInfo,
  destroy,
} from './collaboration/store';
import { diffSource, classifyChanges } from './api/client';

type Tab = 'editor' | 'research';
const FILES = ['main.py', 'utils.py', 'models.py'];

function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [userId, setUserId]       = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('editor');
  const [activeFile, setActiveFile] = useState('main.py');
  const [users, setUsers]         = useState<UserInfo[]>([]);
  const [syncStatus, setSyncStatus] = useState<'connected'|'connecting'|'disconnected'>('disconnected');
  const [localChanges, setLocalChanges]   = useState(0);
  const [remoteChanges, setRemoteChanges] = useState(0);
  const [astStatus, setAstStatus]   = useState<'idle'|'parsing'|'ready'|'error'>('idle');
  const [mlStatus, setMlStatus]     = useState<'idle'|'classifying'|'ready'>('idle');
  const [mlPrediction, setMlPrediction] = useState('');
  const [mlConfidence, setMlConfidence] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [conflict, setConflict]     = useState<any>(null);
  const [toasts, setToasts]         = useState<{id:number;msg:string;type:string}[]>([]);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const prevContents = useRef<Record<string, string>>({});
  const analyzeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastId = useRef(0);

  const toast = useCallback((msg: string, type = 'info') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  // ─── Join/Create session ────────────────────────────────────────────────────
  const handleJoined = useCallback((sid: string, uid: string) => {
    setSessionId(sid);
    setUserId(uid);
    try {
      initCollaboration(sid, uid);
      toast(`Joined session ${sid}`, 'success');
    } catch (e) {
      // Demo mode or server unavailable — proceed without CRDT
      toast('Running in demo mode (no sync server)', 'info');
    }
  }, [toast]);

  // ─── Poll presence & sync status ────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    const interval = setInterval(() => {
      setUsers(getConnectedUsers().filter(u => u.id !== userId));
      setSyncStatus(getSyncStatus());
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionId, userId]);

  // ─── Handle content changes from editor ─────────────────────────────────────
  const handleContentChange = useCallback(
    (content: string, file: string) => {
      const prev = prevContents.current[file] ?? '';
      if (content === prev) return;

      prevContents.current[file] = content;
      setFileContents((fc) => ({ ...fc, [file]: content }));
      setLocalChanges((n) => n + 1);

      // Record CRDT change record
      recordChange(file, 'edit', content.slice(0, 40), 0, content.split('\n').length);

      // Debounce AST diff + ML classify (1.5s after last keystroke)
      if (analyzeTimerRef.current) clearTimeout(analyzeTimerRef.current);
      analyzeTimerRef.current = setTimeout(async () => {
        if (!prev || !content) return;
        setAstStatus('parsing');
        try {
          const diffResult = await diffSource(prev, content, file);
          setAstStatus('ready');

          if (diffResult.success && diffResult.changes.length > 0) {
            // Simulate a concurrent change from the "other user" for demo purposes
            // In real use, this would come from another user's CRDT op
            const recentRemote = getRecentChanges(2);
            if (recentRemote.length >= 2) {
              const changeA = diffResult.changes[0];
              const changeB = {
                ...diffResult.changes[0],
                name: diffResult.changes[0].name || 'remote_change',
              };
              setMlStatus('classifying');
              const result = await classifyChanges(changeA, changeB);
              setMlStatus('ready');
              setMlPrediction(result.prediction.prediction);
              setMlConfidence(result.prediction.confidence);
            }
          }
        } catch {
          setAstStatus('error');
        }
      }, 1500);
    },
    [],
  );

  // ─── Demo scenarios ─────────────────────────────────────────────────────────
  const handleRunDemo = useCallback(
    async (scenario: 'compatible' | 'conflict') => {
      if (scenario === 'compatible') {
        const changeA = {
          node_type: 'FunctionDef', name: 'calculate',
          operation: 'modified', line_start: 2, line_end: 3, parent: 'Module',
        };
        const changeB = {
          node_type: 'FunctionDef', name: 'validate',
          operation: 'added', line_start: 6, line_end: 8, parent: 'Module',
        };
        setMlStatus('classifying');
        try {
          const result = await classifyChanges(changeA, changeB);
          setMlStatus('ready');
          setMlPrediction(result.prediction.prediction);
          setMlConfidence(result.prediction.confidence);
          setConflictCount(0);
          toast(`Demo: ${result.prediction.prediction} (${(result.prediction.confidence * 100).toFixed(1)}%)`, 'success');
        } catch {
          toast('Python service unavailable for ML classification', 'error');
          setMlPrediction('Compatible');
          setMlConfidence(0.85);
          setConflictCount(0);
          setMlStatus('ready');
        }
      } else {
        const localUser = getLocalUser();
        const changeA = {
          node_type: 'FunctionDef', name: 'calculate',
          operation: 'modified', line_start: 2, line_end: 3, parent: 'Module',
        };
        const changeB = {
          node_type: 'FunctionDef', name: 'calculate',
          operation: 'modified', line_start: 2, line_end: 3, parent: 'Module',
        };
        setMlStatus('classifying');
        try {
          const result = await classifyChanges(changeA, changeB);
          setMlStatus('ready');
          setMlPrediction(result.prediction.prediction);
          setMlConfidence(result.prediction.confidence);
          setConflictCount(1);
          // Build conflict object for the modal
          setConflict({
            changeA: {
              userId: localUser?.id ?? 'user-a',
              userName: localUser?.name ?? 'Alice',
              ...changeA,
            },
            changeB: {
              userId: 'remote-user',
              userName: 'Bob',
              ...changeB,
            },
            features: result.features,
            prediction: result.prediction,
          });
        } catch {
          // Fallback demo without ML
          toast('Python service unavailable — showing demo conflict', 'info');
          const fallbackPrediction = {
            label: 1, confidence: 0.92,
            prediction: 'Potential Conflict',
            explanation: 'Both changes target the same FunctionDef node; both_modify=true, same_function=true',
            feature_importances: { same_function: 0.42, both_modify: 0.31, op_combo_score: 0.18, line_overlap: 0.09 },
          };
          setMlPrediction(fallbackPrediction.prediction);
          setMlConfidence(fallbackPrediction.confidence);
          setConflictCount(1);
          setConflict({
            changeA: { userId: 'user-a', userName: 'Alice', ...changeA },
            changeB: { userId: 'user-b', userName: 'Bob', ...changeB },
            features: { same_function: 1, both_modify: 1, op_combo_score: 3, line_overlap: 1, same_name: 1 },
            prediction: fallbackPrediction,
          });
          setMlStatus('ready');
        }
      }
    },
    [toast],
  );

  // ─── Conflict resolution ─────────────────────────────────────────────────────
  const resolveConflict = useCallback(
    (how: 'a' | 'b' | 'both' | 'manual') => {
      const msgs: Record<string, string> = {
        a: 'Accepted User A\'s changes.',
        b: 'Accepted User B\'s changes.',
        both: 'Kept both changes (appended).',
        manual: 'Marked for manual resolution — edit freely.',
      };
      setConflict(null);
      setConflictCount(0);
      setMlPrediction('Compatible');
      toast(msgs[how], 'success');
    },
    [toast],
  );

  // ─── Render ──────────────────────────────────────────────────────────────────
  if (!sessionId) {
    return <SessionGate onJoined={handleJoined} />;
  }

  const localUser = getLocalUser();

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="app-header">
        <div className="logo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/>
          </svg>
          Weaver
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', paddingLeft: 8 }}>
          ML-Assisted AST-Aware CRDT Collaborative Editor
        </span>

        <div className="header-sep" />

        <div className="header-tabs">
          <div
            className={`header-tab ${activeTab === 'editor' ? 'active' : ''}`}
            onClick={() => setActiveTab('editor')}
          >
            Editor
          </div>
          <div
            className={`header-tab ${activeTab === 'research' ? 'active' : ''}`}
            onClick={() => setActiveTab('research')}
          >
            Research Evaluation
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            className={`status-dot ${syncStatus === 'connected' ? 'green' : syncStatus === 'connecting' ? 'yellow pulse' : 'grey'}`}
          />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {syncStatus === 'connected' ? 'Synced' : syncStatus === 'connecting' ? 'Connecting' : 'Offline'}
          </span>
        </div>
      </header>

      {/* Body */}
      {activeTab === 'editor' ? (
        <div className="workspace">
          {/* Sidebar */}
          <aside className="sidebar">
            <div className="sidebar-section">
              <div className="sidebar-label">Explorer</div>
              {FILES.map((f) => (
                <div
                  key={f}
                  className={`file-item ${activeFile === f ? 'active' : ''}`}
                  onClick={() => setActiveFile(f)}
                >
                  <span className="file-dot" />
                  {f}
                </div>
              ))}
            </div>

            <div className="sidebar-footer">
              {sessionId && (
                <div className="session-badge">
                  <div className="session-label">Session ID</div>
                  <div className="session-id">{sessionId}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                    {(users.length + 1)} user{users.length !== 0 ? 's' : ''} connected
                  </div>
                </div>
              )}
            </div>
          </aside>

          {/* Editor */}
          <main className="editor-area">
            <div className="editor-toolbar">
              {FILES.map((f) => (
                <div
                  key={f}
                  className={`file-tab ${activeFile === f ? 'active' : ''}`}
                  onClick={() => setActiveFile(f)}
                >
                  <span className="dot" />
                  {f}
                </div>
              ))}
            </div>
            {FILES.map((f) => (
              <div key={f} style={{ display: f === activeFile ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
                <CodeEditor
                  file={f}
                  onContentChange={(content) => handleContentChange(content, f)}
                />
              </div>
            ))}
          </main>

          {/* Right Panel */}
          <CollabPanel
            users={users}
            localUser={localUser}
            sessionId={sessionId}
            localChanges={localChanges}
            remoteChanges={remoteChanges}
            astStatus={astStatus}
            mlStatus={mlStatus}
            mlPrediction={mlPrediction}
            mlConfidence={mlConfidence}
            conflictCount={conflictCount}
            syncStatus={syncStatus}
            onShowConflict={() => conflict && setConflict(conflict)}
            onRunDemo={handleRunDemo}
          />
        </div>
      ) : (
        <div className="workspace" style={{ overflow: 'hidden' }}>
          <ResearchDashboard />
        </div>
      )}

      {/* Conflict Modal */}
      {conflict && (
        <ConflictModal
          conflict={conflict}
          onAcceptA={() => resolveConflict('a')}
          onAcceptB={() => resolveConflict('b')}
          onKeepBoth={() => resolveConflict('both')}
          onManual={() => resolveConflict('manual')}
          onClose={() => setConflict(null)}
        />
      )}

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            <span style={{
              color: t.type === 'success' ? 'var(--green)' : t.type === 'error' ? 'var(--red)' : 'var(--accent)',
              fontSize: 14,
            }}>
              {t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : 'ℹ'}
            </span>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
