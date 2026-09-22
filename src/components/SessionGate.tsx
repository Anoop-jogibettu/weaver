import React, { useState } from 'react';
import { createSession, getSession } from '../api/client';

interface SessionGateProps {
  onJoined: (sessionId: string, userId: string) => void;
}

function generateUserId() {
  return Math.random().toString(36).slice(2, 10);
}

export const SessionGate: React.FC<SessionGateProps> = ({ onJoined }) => {
  const [joinId, setJoinId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<'menu' | 'join'>('menu');

  const handleCreate = async () => {
    setLoading(true);
    setError('');
    try {
      const { sessionId } = await createSession();
      const userId = generateUserId();
      onJoined(sessionId, userId);
    } catch (e: any) {
      setError('Could not reach Weaver server. Make sure backend is running on port 1234.');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!joinId.trim()) return;
    setLoading(true);
    setError('');
    try {
      await getSession(joinId.trim().toUpperCase());
      const userId = generateUserId();
      onJoined(joinId.trim().toUpperCase(), userId);
    } catch (e: any) {
      setError('Session not found or server unavailable.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="session-gate">
      <div className="session-gate-card">
        <div className="gate-logo">
          <div className="gate-logo-icon">🧵</div>
          <div className="gate-logo-text">
            <h1>Weaver</h1>
            <p>ML-Assisted AST-Aware CRDT Collaborative Editor</p>
          </div>
        </div>

        {phase === 'menu' && (
          <div className="gate-options">
            <div
              className="gate-option"
              onClick={handleCreate}
              style={{ opacity: loading ? 0.6 : 1 }}
            >
              <h3>
                {loading ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="spinner" /> Creating session…
                  </span>
                ) : (
                  '✦ Create New Session'
                )}
              </h3>
              <p>Start a new collaborative coding session and share the session ID.</p>
            </div>

            <div className="gate-option" onClick={() => setPhase('join')}>
              <h3>⤷ Join Existing Session</h3>
              <p>Enter a session ID to join a colleague's session.</p>
            </div>

            <div
              className="gate-option"
              style={{ borderStyle: 'dashed' }}
              onClick={() => {
                // Demo mode — create a local-only session
                onJoined('DEMO01', generateUserId());
              }}
            >
              <h3>⚡ Demo Mode</h3>
              <p>
                Run offline — no server needed. Simulates a single-user session to explore the
                research pipeline.
              </p>
            </div>
          </div>
        )}

        {phase === 'join' && (
          <div className="gate-options">
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 4 }}>
              Enter your 6-character session ID:
            </p>
            <div className="gate-input-group">
              <input
                className="gate-input"
                placeholder="e.g. AB12CD"
                value={joinId}
                onChange={(e) => setJoinId(e.target.value.toUpperCase())}
                maxLength={8}
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                autoFocus
              />
              <button
                className="btn btn-primary"
                onClick={handleJoin}
                disabled={loading || !joinId.trim()}
              >
                {loading ? <span className="spinner" /> : 'Join'}
              </button>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              style={{ marginTop: 4 }}
              onClick={() => { setPhase('menu'); setError(''); }}
            >
              ← Back
            </button>
          </div>
        )}

        {error && (
          <div
            style={{
              marginTop: 12,
              padding: '8px 12px',
              background: 'var(--red-dim)',
              border: '1px solid rgba(248,113,113,0.3)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--red)',
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            marginTop: 20,
            padding: '10px 12px',
            background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-md)',
            fontSize: 11,
            color: 'var(--text-muted)',
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: 'var(--text-secondary)' }}>Research prototype</strong> — Weaver
          demonstrates ML-assisted AST-aware CRDT conflict classification. Changes are synchronized
          via Yjs (YATA algorithm) and analyzed using Python's AST module + scikit-learn.
        </div>
      </div>
    </div>
  );
};
