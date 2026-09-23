import React, { useState } from 'react';
import type { UserInfo, ActiveNodeInfo, ActivityLogItem } from '../collaboration/store';
import type { LiveConflictState } from '../editor/LiveConflictBanner';

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
  liveConflict?: LiveConflictState;
  localActiveNode?: ActiveNodeInfo | null;
  onShowConflict?: () => void;
  activityLogs?: ActivityLogItem[];
  onOpenLogs?: () => void;
  followingUserId?: string | null;
  onFollowUser?: (userId: string | null) => void;
}

const syncLabel: Record<string, string> = {
  connected: 'Synchronized',
  connecting: 'Connecting',
  disconnected: 'Offline',
};
const syncClass: Record<string, string> = {
  connected: 'green',
  connecting: 'yellow',
  disconnected: 'grey',
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
  liveConflict,
  localActiveNode,
  onShowConflict,
  activityLogs = [],
  onOpenLogs,
  followingUserId,
  onFollowUser,
}) => {
  const [copied, setCopied] = useState(false);

  const allUsers = localUser
    ? [localUser, ...users.filter((u) => u.id !== localUser.id)]
    : users;

  const isConflict  = liveConflict?.severity === 'conflict';
  const isCompat    = liveConflict?.severity === 'compatible';
  const isChecking  = liveConflict?.severity === 'checking';
  const hasActivity = liveConflict && liveConflict.severity !== 'idle';

  const handleCopyId = () => {
    navigator.clipboard.writeText(sessionId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="right-panel">
      <div className="panel-header">
        <span className="panel-title">Collaboration</span>
      </div>

      <div className="panel-body">

        {/* ── Live Conflict Guard ─────────────────────────────────────────────── */}
        <div className={`panel-section live-monitor-card ${isConflict ? 'live-conflict' : isCompat ? 'live-compatible' : ''}`}>
          <div className="panel-section-title">
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span className={`live-dot ${hasActivity ? (isConflict ? 'live-dot-red' : 'live-dot-green') : 'live-dot-grey'}`} />
              Conflict Guard
            </span>
            {hasActivity && isConflict && (
              <button
                className="btn btn-danger btn-sm"
                onClick={onShowConflict}
                style={{ fontSize: 10, padding: '1px 6px' }}
              >
                Review
              </button>
            )}
          </div>

          {/* Your target */}
          <div className="live-row">
            <span className="live-row-label">Your target</span>
            <span className="live-row-value">
              {localActiveNode ? (
                <span className="node-chip your-chip">
                  <span className="node-chip-type">
                    {localActiveNode.node_type === 'ClassDef' ? 'cls' : 'fn'}
                  </span>
                  {localActiveNode.name}
                  <span className="node-chip-line"> L{localActiveNode.line_start}</span>
                </span>
              ) : (
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
              )}
            </span>
          </div>

          {/* Peer target */}
          <div className="live-row">
            <span className="live-row-label">Peer target</span>
            <span className="live-row-value">
              {hasActivity && liveConflict!.peerNode ? (
                <span className="node-chip peer-chip">
                  <span className="node-chip-type">fn</span>
                  <span style={{ color: liveConflict!.peerColor }}>{liveConflict!.peerNode}</span>
                  <span className="node-chip-peer"> @{liveConflict!.peerName}</span>
                </span>
              ) : (
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                  No peers editing concurrently
                </span>
              )}
            </span>
          </div>

          {/* ML verdict */}
          {hasActivity && (
            <div className="live-row">
              <span className="live-row-label">ML verdict</span>
              <span className="live-row-value">
                {isChecking && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)', fontSize: 11 }}>
                    <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} />
                    Classifying
                  </span>
                )}
                {isConflict && (
                  <span className="badge badge-conflict">
                    conflict · {(liveConflict!.confidence * 100).toFixed(0)}%
                  </span>
                )}
                {isCompat && (
                  <span className="badge badge-compatible">
                    compatible · {(liveConflict!.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </span>
            </div>
          )}

          {/* Confidence bar */}
          {hasActivity && liveConflict!.confidence > 0 && (
            <div className="conf-bar-track" style={{ margin: '4px 12px 8px' }}>
              <div
                className={`conf-bar-fill ${isConflict ? 'error' : 'ok'}`}
                style={{ width: `${liveConflict!.confidence * 100}%` }}
              />
            </div>
          )}
        </div>

        {/* ── Workspace / Session ────────────────────────────────────────────── */}
        <div className="panel-section">
          <div className="panel-section-title">Workspace</div>
          <div className="panel-row" style={{ alignItems: 'center' }}>
            <span className="panel-row-label">ID</span>
            <span className="panel-row-value accent" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 6 }}>
              {sessionId}
              <button
                className="session-copy-btn"
                title="Copy Session ID"
                onClick={handleCopyId}
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </span>
          </div>
        </div>

        {/* ── Collaborators ─────────────────────────────────────────────────── */}
        <div className="panel-section">
          <div className="panel-section-title">Collaborators ({allUsers.length})</div>

          {followingUserId && (
            <div className="following-banner">
              <span className="following-indicator-dot" />
              <span className="following-text">
                Following <strong>@{allUsers.find((u) => u.id === followingUserId)?.name || 'Peer'}</strong>
              </span>
              <button
                className="following-stop-btn"
                onClick={() => onFollowUser?.(null)}
                title="Stop following peer cursor"
              >
                Stop
              </button>
            </div>
          )}

          {allUsers.length === 0 ? (
            <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--text-muted)' }}>
              No other users connected
            </div>
          ) : (
            allUsers.map((u) => {
              const name  = u.name  || 'Collaborator';
              const color = u.color || '#4d9cf3';
              const isMe = u.id === localUser?.id;
              const isFollowing = followingUserId === u.id;

              return (
                <div key={u.id} className="user-entry">
                  <div
                    className="user-avatar"
                    style={{ background: color + '22', color }}
                  >
                    {(name[0] || 'U').toUpperCase()}
                  </div>
                  <span className="user-name">{name}</span>
                  {isMe ? (
                    <span className="user-you">you</span>
                  ) : onFollowUser ? (
                    <button
                      className={`user-follow-btn ${isFollowing ? 'active' : ''}`}
                      onClick={() => onFollowUser(isFollowing ? null : u.id)}
                      title={isFollowing ? 'Stop following' : `Follow ${name}'s active cursor & line`}
                    >
                      {isFollowing ? 'Following' : 'Follow'}
                    </button>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        {/* ── Recent Activity & Merges ───────────────────────────────────────── */}
        <div className="panel-section">
          <div className="panel-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Activity & Merges ({activityLogs.length})</span>
            {onOpenLogs && (
              <button
                className="panel-link-btn"
                onClick={onOpenLogs}
                title="Open full activity log panel"
              >
                View all →
              </button>
            )}
          </div>
          {activityLogs.length === 0 ? (
            <div style={{ padding: '6px 12px', fontSize: 11, color: 'var(--text-muted)' }}>
              No collaborator merges or actions yet
            </div>
          ) : (
            <div className="recent-log-list">
              {activityLogs.slice(-3).reverse().map((item) => {
                const time = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                return (
                  <div
                    key={item.id}
                    className="recent-log-item"
                    onClick={onOpenLogs}
                    title="Click to view details in log panel"
                  >
                    <div className="recent-log-header">
                      <span
                        className="recent-log-dot"
                        style={{
                          background:
                            item.type === 'merge'
                              ? 'var(--green)'
                              : item.type === 'conflict'
                              ? 'var(--red)'
                              : item.userColor || 'var(--accent)',
                        }}
                      />
                      <span className="recent-log-actor" style={{ color: item.userColor }}>
                        {item.userName}
                      </span>
                      <span className="recent-log-time">{time}</span>
                    </div>
                    <div className="recent-log-action">{item.action}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Synchronization ───────────────────────────────────────────────── */}
        <div className="panel-section">
          <div className="panel-section-title">Synchronization</div>
          <div className="panel-row">
            <span className="panel-row-label">CRDT State</span>
            <span className="panel-row-value" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className={`status-dot ${syncClass[syncStatus]}${syncStatus === 'connecting' ? ' pulse' : ''}`} />
              {syncLabel[syncStatus]}
            </span>
          </div>
          <div className="panel-row">
            <span className="panel-row-label">Local edits</span>
            <span className="panel-row-value accent">{localChanges}</span>
          </div>
          <div className="panel-row">
            <span className="panel-row-label">Remote edits</span>
            <span className="panel-row-value">{remoteChanges}</span>
          </div>
        </div>

        {/* ── AST Analysis ─────────────────────────────────────────────────── */}
        <div className="panel-section">
          <div className="panel-section-title">AST Analysis</div>
          <div className="panel-row">
            <span className="panel-row-label">Parser</span>
            <span className="panel-row-value">
              {astStatus === 'idle' && <span style={{ color: 'var(--text-muted)' }}>idle</span>}
              {astStatus === 'parsing' && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--yellow)', fontSize: 11 }}>
                  <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} /> parsing
                </span>
              )}
              {astStatus === 'ready' && <span className="state-label ok">ready</span>}
              {astStatus === 'error' && <span className="state-label error">error</span>}
            </span>
          </div>
          <div className="panel-row">
            <span className="panel-row-label">Structural conflicts</span>
            <span className={`panel-row-value ${conflictCount > 0 ? 'error' : 'ok'}`}>
              {conflictCount}
            </span>
          </div>
        </div>

        {/* ── ML Conflict Predictor ─────────────────────────────────────────── */}
        <div className="panel-section">
          <div className="panel-section-title">ML Conflict Predictor</div>
          <div className="panel-row">
            <span className="panel-row-label">Status</span>
            <span className="panel-row-value">
              {mlStatus === 'idle' && <span style={{ color: 'var(--text-muted)' }}>idle</span>}
              {mlStatus === 'classifying' && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--yellow)', fontSize: 11 }}>
                  <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} /> analyzing
                </span>
              )}
              {mlStatus === 'ready' && <span className="state-label ok">active</span>}
            </span>
          </div>
          <div className="panel-row">
            <span className="panel-row-label">Prediction</span>
            <span className="panel-row-value">
              {mlPrediction === 'Compatible' && (
                <span className="badge badge-compatible">{mlPrediction}</span>
              )}
              {mlPrediction === 'Potential Conflict' && (
                <span className="badge badge-conflict">Conflict</span>
              )}
              {mlPrediction && mlPrediction !== 'Compatible' && mlPrediction !== 'Potential Conflict' && (
                <span className="badge badge-uncertain">{mlPrediction}</span>
              )}
              {!mlPrediction && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>}
            </span>
          </div>
          <div className="panel-row">
            <span className="panel-row-label">Confidence</span>
            <span className="panel-row-value">
              {mlConfidence > 0 ? (
                <span style={{ color: mlConfidence >= 0.7 ? 'var(--green)' : 'var(--yellow)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                  {(mlConfidence * 100).toFixed(1)}%
                </span>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>—</span>
              )}
            </span>
          </div>
          {mlConfidence > 0 && (
            <div className="conf-bar-track">
              <div
                className={`conf-bar-fill ${mlConfidence >= 0.7 ? 'ok' : 'warn'}`}
                style={{ width: `${mlConfidence * 100}%` }}
              />
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
