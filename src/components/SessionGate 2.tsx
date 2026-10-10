import React, { useState } from 'react';
import { createSession, getSession } from '../api/client';

interface SessionGateProps {
  onJoined: (sessionId: string, userId: string, userName: string, isHost: boolean) => void;
}

function generateUserId() {
  return Math.random().toString(36).slice(2, 10);
}

export const SessionGate: React.FC<SessionGateProps> = ({ onJoined }) => {
  const [userName, setUserName] = useState(() => {
    try {
      return localStorage.getItem('weaver_user_name') || '';
    } catch {
      return '';
    }
  });
  const [joinId, setJoinId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<'menu' | 'join'>('menu');

  const saveUserName = (name: string) => {
    try {
      if (name.trim()) localStorage.setItem('weaver_user_name', name.trim());
    } catch { /* noop */ }
  };

  const handleCreate = async () => {
    const finalName = userName.trim() || 'Host';
    saveUserName(finalName);
    setLoading(true);
    setError('');
    try {
      const { sessionId } = await createSession();
      onJoined(sessionId, generateUserId(), finalName, true);
    } catch {
      setError('Could not reach Weaver server. Ensure the backend is running on port 1234.');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!joinId.trim()) {
      setError('Please enter a Workspace ID.');
      return;
    }
    const finalName = userName.trim() || 'Collaborator';
    saveUserName(finalName);
    setLoading(true);
    setError('');
    try {
      await getSession(joinId.trim().toUpperCase());
      onJoined(joinId.trim().toUpperCase(), generateUserId(), finalName, false);
    } catch {
      setError('Workspace not found or server unavailable. Please check the ID.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="session-gate">
      <div className="session-gate-card">

        {/* Header */}
        <div className="gate-logo">
          <div className="gate-logo-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/>
            </svg>
          </div>
          <div className="gate-logo-text">
            <h1>Weaver</h1>
            <p>Real-Time Collaborative Code Editor</p>
          </div>
        </div>

        {/* User display name input */}
        <div style={{ padding: '0 20px 14px' }}>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>
            Your Name
          </label>
          <input
            className="gate-input"
            style={{ width: '100%', boxSizing: 'border-box' }}
            placeholder="Enter your name (e.g. Alex, Bob, Anoop)"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            maxLength={24}
          />
        </div>

        {/* Options */}
        {phase === 'menu' && (
          <div className="gate-options">
            <div
              className="gate-option"
              onClick={handleCreate}
              style={{ opacity: loading ? 0.5 : 1 }}
            >
              <h3>
                {loading ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />
                    Creating workspace…
                  </span>
                ) : (
                  'New Workspace (Host)'
                )}
              </h3>
              <p>Start a new canonical workspace as Host and invite collaborators with the workspace ID.</p>
            </div>

            <div className="gate-option" onClick={() => setPhase('join')}>
              <h3>Join Workspace (Collaborator)</h3>
              <p>Join an existing workspace. You will work on your personal working copy and merge changes to the host.</p>
            </div>
          </div>
        )}

        {phase === 'join' && (
          <div className="gate-options">
            <div style={{ padding: '4px 20px 6px' }}>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                Workspace ID
              </p>
              <div className="gate-input-group">
                <input
                  id="session-id-input"
                  className="gate-input"
                  placeholder="AB12CD"
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value.toUpperCase())}
                  maxLength={12}
                  onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                  autoFocus
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleJoin}
                  disabled={loading || !joinId.trim()}
                >
                  {loading ? <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> : 'Join'}
                </button>
              </div>
            </div>
            <div style={{ padding: '4px 20px 10px' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => { setPhase('menu'); setError(''); }}
              >
                Back
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            margin: '0 20px 8px',
            padding: '5px 8px',
            background: 'var(--red-bg)',
            border: '1px solid rgba(244,71,71,0.3)',
            borderLeft: '3px solid var(--red)',
            borderRadius: 'var(--radius)',
            color: 'var(--red)',
            fontSize: 11,
          }}>
            {error}
          </div>
        )}

        {/* Footer note */}
        <div className="gate-footer">
          Weaver • AST-Aware CRDT Real-Time Collaborative Programming Environment
        </div>
      </div>
    </div>
  );
};
