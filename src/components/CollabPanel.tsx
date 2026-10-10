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
  onSimulateConflict?: () => void;
}

const syncLabel: Record<string, string> = {
  connected:    'synced',
  connecting:   'connecting',
  disconnected: 'offline',
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
  onSimulateConflict,
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

        {/* ── Conflict Guard ──────────────────────────────────────────────── */}
        <div className={`panel-section live-monitor-card${isConflict ? ' live-conflict' : isCompat ? ' live-compatible' : ''}`}>
          <div className="panel-section-title">
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span className={`live-dot ${hasActivity ? (isConflict ? 'live-dot-red' : 'live-dot-green') : 'live-dot-grey'}`} />
              Conflict Guard
            </span>
            <span style={{ display: 'flex', gap: 4 }}>
              {hasActivity && isConflict && (
                <button className="sim-peer-btn" onClick={onShowConflict}>Review</button>
              )}
              {!hasActivity && onSimulateConflict && (
                <button
                  className="sim-peer-btn"
                  onClick={onSimulateConflict}
                  title="Simulate a peer editing the same function for demo"
                >
                  Simulate
                </button>
              )}
            </span>
          </div>

          <div className="live-row">
            <span className="live-row-label">Your target</span>
            <span className="live-row-value">
              {localActiveNode ? (
                <span className="node-chip your-chip">
                  <span className="node-chip-type">
                    {localActiveNode.node_type === 'ClassDef' ? 'cls' : 'fn'}
                  </span>
                  {localActiveNode.name}
                  <span className="node-chip-line">L{localActiveNode.line_start}</span>
                </span>
              ) : (
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
              )}
            </span>
          </div>

          <div className="live-row">
            <span className="live-row-label">Peer target</span>
            <span className="live-row-value">
              {hasActivity && liveConflict!.peerNode ? (
                <span className="node-chip peer-chip">
                  <span className="node-chip-type">fn</span>
                  <span style={{ color: liveConflict!.peerColor }}>{liveConflict!.peerNode}</span>
                  <span className="node-chip-peer">@{liveConflict!.peerName}</span>
                </span>
              ) : (
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                  No concurrent peers
                </span>
              )}
            </span>
          </div>

          {hasActivity && (
            <div className="live-row">
              <span className="live-row-label">Verdict</span>
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

          {hasActivity && liveConflict!.confidence > 0 && (
            <div className="conf-bar-track" style={{ margin: '4px 12px 6px' }}>
              <div
                className={`conf-bar-fill ${isConflict ? 'error' : 'ok'}`}
                style={{ width: `${liveConflict!.confidence * 100}%` }}
              />
            </div>
          )}
        </div>

        {/* ── Collaborators ───────────────────────────────────────────────── */}
        <div className="panel-section">
          <div className="panel-section-title">
            <span>Collaborators</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>{allUsers.length}</span>
          </div>

          {followingUserId && (
            <div className="following-banner">
              <span className="following-indicator-dot" />
              <span className="following-text">
                Following <strong>@{allUsers.find((u) => u.id === followingUserId)?.name || 'Peer'}</strong>
              </span>
              <button className="following-stop-btn" onClick={() => onFollowUser?.(null)}>Stop</button>
            </div>
          )}

          {allUsers.length === 0 ? (
            <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--text-muted)' }}>
              No peers connected
            </div>
          ) : (
            allUsers.map((u) => {
              const name  = u.name  || 'Collaborator';
              const color = u.color || '#5e81ac';
              const isMe = u.id === localUser?.id;
              const isFollowing = followingUserId === u.id;

              return (
                <div key={u.id} className="user-entry">
                  <div className="user-avatar" style={{ background: color + '33', color }}>
                    {(name[0] || 'U').toUpperCase()}
                  </div>
                  <span className="user-name">{name}</span>
                  {isMe ? (
                    <span className="user-you">you</span>
                  ) : onFollowUser ? (
                    <button
                      className={`user-follow-btn ${isFollowing ? 'active' : ''}`}
                      onClick={() => onFollowUser(isFollowing ? null : u.id)}
                      title={isFollowing ? 'Stop following' : `Follow ${name}`}
                    >
                      {isFollowing ? 'Following' : 'Follow'}
                    </button>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        {/* ── Activity ────────────────────────────────────────────────────── */}
        <div className="panel-section">
          <div className="panel-section-title">
            <span>Activity</span>
            {onOpenLogs && (
              <button className="panel-link-btn" onClick={onOpenLogs}>View all</button>
            )}
          </div>
          {activityLogs.length === 0 ? (
            <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--text-muted)' }}>
              No activity yet
            </div>
          ) : (
            <div className="recent-log-list">
              {activityLogs.slice(-3).reverse().map((item) => {
                const time = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                return (
                  <div key={item.id} className="recent-log-item" onClick={onOpenLogs}>
                    <div className="recent-log-header">
                      <span
                        className="recent-log-dot"
                        style={{
                          background:
                            item.type === 'merge' ? 'var(--green)'
                            : item.type === 'conflict' ? 'var(--red)'
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

        {/* ── Synchronization ─────────────────────────────────────────────── */}
        <div className="panel-section">
          <div className="panel-section-title">Synchronization</div>
          <div className="panel-row">
            <span className="panel-row-label">CRDT</span>
            <span className="panel-row-value" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className={`status-dot ${syncStatus === 'connected' ? 'green' : syncStatus === 'connecting' ? 'yellow pulse' : 'grey'}`} />
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
              {astStatus === 'idle' && <span className="state-label muted">idle</span>}
              {astStatus === 'parsing' && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                  <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} />
                  <span style={{ color: 'var(--yellow)' }}>parsing</span>
                </span>
              )}
              {astStatus === 'ready' && <span className="state-label ok">ready</span>}
              {astStatus === 'error' && <span className="state-label error">error</span>}
            </span>
          </div>
          <div className="panel-row">
            <span className="panel-row-label">Conflicts</span>
            <span className={`panel-row-value ${conflictCount > 0 ? 'error' : ''}`}>
              {conflictCount}
            </span>
          </div>
        </div>

        {/* ── Conflict Prediction ──────────────────────────────────────────── */}
        <div className="panel-section">
          <div className="panel-section-title">Conflict Prediction</div>
          <div className="panel-row">
            <span className="panel-row-label">Status</span>
            <span className="panel-row-value">
              {mlStatus === 'idle' && <span className="state-label muted">idle</span>}
              {mlStatus === 'classifying' && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                  <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} />
                  <span style={{ color: 'var(--yellow)' }}>analyzing</span>
                </span>
              )}
              {mlStatus === 'ready' && <span className="state-label ok">ready</span>}
            </span>
          </div>
          <div className="panel-row">
            <span className="panel-row-label">Prediction</span>
            <span className="panel-row-value">
              {mlPrediction === 'Compatible' && (
                <span className="badge badge-compatible">compatible</span>
              )}
              {mlPrediction === 'Potential Conflict' && (
                <span className="badge badge-conflict">conflict</span>
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

        {/* ── Workspace ID ─────────────────────────────────────────────────── */}
        <div className="panel-section" style={{ paddingBottom: 10 }}>
          <div className="panel-section-title">Workspace</div>
          <div className="panel-row" style={{ alignItems: 'center' }}>
            <span className="panel-row-label">ID</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', letterSpacing: '0.06em' }}>
                {sessionId}
              </span>
              <button className="session-copy-btn" onClick={handleCopyId}>
                {copied ? 'copied' : 'copy'}
              </button>
            </span>
          </div>
        </div>

      </div>
    </div>
  );
};
