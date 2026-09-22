import React from 'react';
import { UserInfo, getSyncStatus } from '../collaboration/store';

interface CollabPanelProps {
  users: UserInfo[];
  localUser: UserInfo | null;
  sessionId: string;
  localChanges: number;
  remoteChanges: number;
  astStatus: 'idle' | 'parsing' | 'ready' | 'error';
  mlStatus: 'idle' | 'classifying' | 'ready';
  mlPrediction: string;
  mlConfidence: number;
  conflictCount: number;
  syncStatus: 'connected' | 'connecting' | 'disconnected';
  onShowConflict?: () => void;
  onRunDemo?: (scenario: 'compatible' | 'conflict') => void;
}

const syncColors = {
  connected: 'green',
  connecting: 'yellow',
  disconnected: 'grey',
} as const;

const syncLabels = {
  connected: 'Synchronized',
  connecting: 'Connecting…',
  disconnected: 'Offline (local)',
};

export const CollabPanel: React.FC<CollabPanelProps> = ({
  users,
  localUser,
  sessionId,
  localChanges,
  remoteChanges,
  astStatus,
  mlStatus,
  mlPrediction,
  mlConfidence,
  conflictCount,
  syncStatus,
  onShowConflict,
  onRunDemo,
}) => {
  const allUsers = localUser
    ? [localUser, ...users.filter((u) => u.id !== localUser.id)]
    : users;

  return (
    <div className="right-panel">
      <div className="panel-header">
        <div className="panel-title">Collaboration &amp; Research</div>
      </div>

      <div className="panel-body">
        {/* Session */}
        <div className="stat-card">
          <div className="stat-card-title">Session</div>
          <div
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 18,
              fontWeight: 700,
              color: 'var(--accent)',
              letterSpacing: '0.1em',
              marginBottom: 4,
            }}
          >
            {sessionId}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Share this ID for others to join
          </div>
        </div>

        {/* Connected Users */}
        <div className="stat-card">
          <div className="stat-card-title">Connected Users</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {allUsers.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No users connected</div>
            ) : (
              allUsers.map((u) => (
                <div key={u.id} className="user-chip">
                  <div
                    className="user-avatar"
                    style={{ background: u.color + '33', border: `1px solid ${u.color}`, color: u.color }}
                  >
                    {u.name[0]}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {u.name}
                      {u.id === localUser?.id && (
                        <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> (you)</span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {u.id.slice(0, 8)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Sync Status */}
        <div className="stat-card">
          <div className="stat-card-title">Synchronization</div>
          <div className="stat-row">
            <span className="stat-label">CRDT Status</span>
            <span className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span
                className={`status-dot ${syncColors[syncStatus]}${syncStatus === 'connecting' ? ' pulse' : ''}`}
              />
              <span style={{ color: syncStatus === 'connected' ? 'var(--green)' : syncStatus === 'connecting' ? 'var(--yellow)' : 'var(--text-muted)', fontSize: 11 }}>
                {syncLabels[syncStatus]}
              </span>
            </span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Local Changes</span>
            <span className="stat-value accent">{localChanges}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Remote Changes</span>
            <span className="stat-value purple">{remoteChanges}</span>
          </div>
        </div>

        {/* AST Analysis */}
        <div className="stat-card">
          <div className="stat-card-title">AST Analysis</div>
          <div className="stat-row">
            <span className="stat-label">Parser Status</span>
            <span className="stat-value">
              {astStatus === 'idle' && <span style={{ color: 'var(--text-muted)' }}>Idle</span>}
              {astStatus === 'parsing' && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--yellow)' }}>
                  <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
                  Parsing
                </span>
              )}
              {astStatus === 'ready' && <span className="green">Ready ✓</span>}
              {astStatus === 'error' && <span className="red">Parse Error</span>}
            </span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Structural Conflicts</span>
            <span className={`stat-value ${conflictCount > 0 ? 'red' : 'green'}`}>
              {conflictCount}
            </span>
          </div>
        </div>

        {/* ML Prediction */}
        <div className="stat-card">
          <div className="stat-card-title">ML Classifier</div>
          <div className="stat-row">
            <span className="stat-label">Status</span>
            <span className="stat-value">
              {mlStatus === 'idle' && <span style={{ color: 'var(--text-muted)' }}>Idle</span>}
              {mlStatus === 'classifying' && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--yellow)' }}>
                  <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
                  Classifying
                </span>
              )}
              {mlStatus === 'ready' && <span className="green">Done</span>}
            </span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Prediction</span>
            <span className="stat-value" style={{ fontSize: 11 }}>
              {mlPrediction === 'Compatible' ? (
                <span className="badge badge-compatible">{mlPrediction}</span>
              ) : mlPrediction === 'Potential Conflict' ? (
                <span className="badge badge-conflict">{mlPrediction}</span>
              ) : mlPrediction ? (
                <span className="badge badge-uncertain">{mlPrediction}</span>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>—</span>
              )}
            </span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Confidence</span>
            <span className="stat-value">
              {mlConfidence > 0 ? (
                <span style={{ color: mlConfidence >= 0.7 ? 'var(--green)' : 'var(--yellow)' }}>
                  {(mlConfidence * 100).toFixed(1)}%
                </span>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>—</span>
              )}
            </span>
          </div>
          {mlConfidence > 0 && (
            <div style={{ marginTop: 6 }}>
              <div className="ml-confidence-bar">
                <div
                  className="ml-confidence-fill"
                  style={{
                    width: `${mlConfidence * 100}%`,
                    background: mlConfidence >= 0.7 ? 'var(--green)' : 'var(--yellow)',
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Conflict alert */}
        {conflictCount > 0 && (
          <button
            className="btn btn-danger"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={onShowConflict}
          >
            ⚠ View Conflict Details
          </button>
        )}

        {/* Demo Scenarios */}
        <div className="stat-card">
          <div className="stat-card-title">Demo Scenarios</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              className="btn btn-secondary btn-sm"
              style={{ justifyContent: 'center', fontSize: 11 }}
              onClick={() => onRunDemo?.('compatible')}
            >
              ▶ Run Compatible Scenario
            </button>
            <button
              className="btn btn-secondary btn-sm"
              style={{ justifyContent: 'center', fontSize: 11, borderColor: 'rgba(248,113,113,0.3)', color: 'var(--red)' }}
              onClick={() => onRunDemo?.('conflict')}
            >
              ▶ Run Conflict Scenario
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
