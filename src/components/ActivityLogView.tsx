import React, { useState, useMemo } from 'react';
import type { ActivityLogItem, ActivityLogType } from '../collaboration/store';

interface ActivityLogViewProps {
  logs: ActivityLogItem[];
  isHost: boolean;
  onClear: () => void;
  onSelectFile?: (filename: string) => void;
}

export const ActivityLogView: React.FC<ActivityLogViewProps> = ({
  logs,
  isHost,
  onClear,
  onSelectFile,
}) => {
  const [filterType, setFilterType] = useState<'all' | ActivityLogType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredLogs = useMemo(() => {
    let result = [...logs].reverse(); // newest first
    if (filterType !== 'all') {
      result = result.filter((item) => item.type === filterType);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (item) =>
          item.action.toLowerCase().includes(q) ||
          item.userName.toLowerCase().includes(q) ||
          (item.filename && item.filename.toLowerCase().includes(q)) ||
          (item.details?.resolution && item.details.resolution.toLowerCase().includes(q))
      );
    }
    return result;
  }, [logs, filterType, searchQuery]);

  const counts = useMemo(() => {
    const c = { all: logs.length, merge: 0, conflict: 0, file: 0, presence: 0 };
    logs.forEach((item) => {
      if (item.type === 'merge') c.merge++;
      else if (item.type === 'conflict') c.conflict++;
      else if (item.type === 'file') c.file++;
      else if (item.type === 'presence') c.presence++;
    });
    return c;
  }, [logs]);

  const getBadgeClass = (type: ActivityLogType) => {
    switch (type) {
      case 'merge':
        return 'log-badge-merge';
      case 'conflict':
        return 'log-badge-conflict';
      case 'file':
        return 'log-badge-file';
      case 'sync':
        return 'log-badge-sync';
      case 'presence':
        return 'log-badge-presence';
      default:
        return 'log-badge-default';
    }
  };

  const getBadgeLabel = (type: ActivityLogType) => {
    switch (type) {
      case 'merge':
        return '🌿 MERGE';
      case 'conflict':
        return '⚡ CONFLICT';
      case 'file':
        return '📄 FILE';
      case 'sync':
        return '↻ SYNC';
      case 'presence':
        return '👤 USER';
      case 'edit':
        return '✎ EDIT';
      default:
        return String(type).toUpperCase();
    }
  };

  return (
    <div className="activity-log-view">
      {/* Controls & Filter Bar */}
      <div className="log-controls-bar">
        <div className="log-filter-chips">
          <button
            className={`log-filter-btn ${filterType === 'all' ? 'active' : ''}`}
            onClick={() => setFilterType('all')}
          >
            All ({counts.all})
          </button>
          <button
            className={`log-filter-btn ${filterType === 'merge' ? 'active' : ''}`}
            onClick={() => setFilterType('merge')}
          >
            🌿 Merges ({counts.merge})
          </button>
          <button
            className={`log-filter-btn ${filterType === 'conflict' ? 'active' : ''}`}
            onClick={() => setFilterType('conflict')}
          >
            ⚡ Conflicts ({counts.conflict})
          </button>
          <button
            className={`log-filter-btn ${filterType === 'file' ? 'active' : ''}`}
            onClick={() => setFilterType('file')}
          >
            📄 Files ({counts.file})
          </button>
          <button
            className={`log-filter-btn ${filterType === 'presence' ? 'active' : ''}`}
            onClick={() => setFilterType('presence')}
          >
            👤 Presence ({counts.presence})
          </button>
        </div>

        <div className="log-actions-right">
          <input
            type="text"
            className="log-search-input"
            placeholder="Filter logs by user, file, action…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <div className="log-live-status" title="Logs are synchronized in real time across all peers via CRDT">
            <span className="live-dot-green" />
            <span>CRDT Sync</span>
          </div>
          {isHost && logs.length > 0 && (
            <button
              className="output-action-btn"
              onClick={onClear}
              title="Clear all activity logs"
            >
              Clear Logs
            </button>
          )}
        </div>
      </div>

      {/* Log Feed */}
      <div className="log-list-scroll">
        {filteredLogs.length === 0 ? (
          <div className="log-empty-state">
            <div className="log-empty-icon">📜</div>
            <div className="log-empty-title">
              {logs.length === 0
                ? 'No collaborator activity or merge logs yet'
                : 'No logs match your filter criteria'}
            </div>
            <div className="log-empty-desc">
              {logs.length === 0
                ? 'When collaborators join, edit files, propose merges, or resolve AST conflicts, all audit events will appear here in real time.'
                : 'Try adjusting your search query or selecting "All" to view all recorded workspace events.'}
            </div>
          </div>
        ) : (
          filteredLogs.map((item) => {
            const isExpanded = expandedIds.has(item.id);
            const hasDetails =
              !!item.details &&
              (!!item.details.resolution ||
                (item.details.astChanges && item.details.astChanges.length > 0) ||
                !!item.details.previewSnippet ||
                !!item.details.linesAdded ||
                !!item.details.oldName);

            const timeStr = new Date(item.timestamp).toLocaleTimeString();
            const dateStr = new Date(item.timestamp).toLocaleDateString([], {
              month: 'short',
              day: 'numeric',
            });

            return (
              <div
                key={item.id}
                className={`log-entry-row ${isExpanded ? 'expanded' : ''}`}
                onClick={() => hasDetails && toggleExpand(item.id)}
              >
                {/* Main line */}
                <div className="log-entry-main">
                  {/* Timestamp */}
                  <span className="log-timestamp" title={`${dateStr} ${timeStr}`}>
                    {timeStr}
                  </span>

                  {/* User badge */}
                  <div
                    className="log-user-badge"
                    style={{ borderColor: item.userColor + '66' }}
                    title={`${item.userName} (${item.isHost ? 'Host' : 'Collaborator'})`}
                  >
                    <span
                      className="log-user-avatar"
                      style={{ background: item.userColor + '26', color: item.userColor }}
                    >
                      {(item.userName[0] || 'U').toUpperCase()}
                    </span>
                    <span className="log-user-name">{item.userName}</span>
                    {item.isHost && <span className="log-host-tag">Host</span>}
                  </div>

                  {/* Type badge */}
                  <span className={`log-badge ${getBadgeClass(item.type)}`}>
                    {getBadgeLabel(item.type)}
                  </span>

                  {/* Action Description */}
                  <span className="log-action-text">{item.action}</span>

                  {/* Target file tag if any */}
                  {item.filename && (
                    <span
                      className="log-file-tag"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onSelectFile && item.filename) onSelectFile(item.filename);
                      }}
                      title="Click to jump to file"
                    >
                      {item.filename}
                    </span>
                  )}

                  {/* Expand toggle */}
                  {hasDetails && (
                    <button
                      className="log-expand-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(item.id);
                      }}
                      title="Toggle details"
                    >
                      {isExpanded ? '▲ Hide Details' : '▼ Details'}
                    </button>
                  )}
                </div>

                {/* Expanded Details Drawer */}
                {isExpanded && hasDetails && (
                  <div className="log-entry-details" onClick={(e) => e.stopPropagation()}>
                    <div className="log-details-grid">
                      {item.details?.resolution && (
                        <div className="log-detail-item">
                          <span className="log-detail-label">Resolution Strategy:</span>
                          <span className="log-detail-val accent">
                            {item.details.resolution.toUpperCase()}
                          </span>
                        </div>
                      )}

                      {item.filename && (
                        <div className="log-detail-item">
                          <span className="log-detail-label">Target File:</span>
                          <span className="log-detail-val code">{item.filename}</span>
                        </div>
                      )}

                      {item.details?.oldName && item.details?.newName && (
                        <div className="log-detail-item">
                          <span className="log-detail-label">Rename:</span>
                          <span className="log-detail-val">
                            {item.details.oldName} → <strong>{item.details.newName}</strong>
                          </span>
                        </div>
                      )}

                      {(item.details?.linesAdded !== undefined || item.details?.linesRemoved !== undefined) && (
                        <div className="log-detail-item">
                          <span className="log-detail-label">Changes:</span>
                          <span className="log-detail-val">
                            <span style={{ color: 'var(--green)' }}>+{item.details.linesAdded || 0}</span>{' '}
                            <span style={{ color: 'var(--red)' }}>-{item.details.linesRemoved || 0}</span>
                          </span>
                        </div>
                      )}
                    </div>

                    {item.details?.astChanges && item.details.astChanges.length > 0 && (
                      <div className="log-ast-changes">
                        <span className="log-detail-label">AST Modifications:</span>
                        <div className="log-ast-tags">
                          {item.details.astChanges.map((ast, i) => (
                            <span key={i} className="node-chip your-chip">
                              {ast}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {item.details?.previewSnippet && (
                      <div className="log-code-preview-wrap">
                        <span className="log-detail-label">Code Snippet:</span>
                        <pre className="log-code-preview">{item.details.previewSnippet}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
