import React, { useState } from 'react';

export interface ConflictData {
  proposalId?: string;
  isNewFile?: boolean;
  filename: string;
  hostName: string;
  collaboratorName: string;
  hostContent: string;
  collaboratorContent: string;
  changes?: Array<{
    node_type: string;
    name: string;
    operation: string;
    line_start: number;
    line_end: number;
  }>;
  prediction?: {
    label: number;
    confidence: number;
    prediction: string;
    explanation: string;
  };
}

interface ConflictModalProps {
  conflict: ConflictData;
  onAcceptCollaborator: () => void;
  onKeepHost: () => void;
  onMergeBoth: () => void;
  onCustomMerge?: (mergedCode: string) => void;
  onClose: () => void;
}

export const ConflictModal: React.FC<ConflictModalProps> = ({
  conflict,
  onAcceptCollaborator,
  onKeepHost,
  onMergeBoth,
  onCustomMerge,
  onClose,
}) => {
  const {
    filename,
    hostName,
    collaboratorName,
    hostContent,
    collaboratorContent,
    changes = [],
    prediction,
  } = conflict;

  const [activeTab, setActiveTab] = useState<'compare' | 'custom'>('compare');
  const [customText, setCustomText] = useState(collaboratorContent);

  const isConflict = prediction ? prediction.label === 1 || prediction.prediction.toLowerCase().includes('conflict') : true;

  const handleApplyCustom = () => {
    if (onCustomMerge) {
      onCustomMerge(customText);
    } else {
      onAcceptCollaborator();
    }
  };

  return (
    <div className="conflict-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="conflict-card" style={{ maxWidth: 840 }}>
        {/* Header */}
        <div className="conflict-card-header">
          <div className="icon" style={{ color: conflict.isNewFile ? '#38bdf8' : isConflict ? 'var(--yellow)' : 'var(--green)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div>
            <h2>
              {conflict.isNewFile ? `Review New File: ${filename}` : `Review & Resolve Merge: ${filename}`}
            </h2>
            <p>
              {conflict.isNewFile ? (
                <>
                  Collaborator <strong style={{ color: 'var(--accent)' }}>{collaboratorName}</strong> created new file <strong style={{ color: '#38bdf8' }}>"{filename}"</strong> to add to the Host project.
                </>
              ) : (
                <>
                  Collaborator <strong style={{ color: 'var(--accent)' }}>{collaboratorName}</strong> proposed changes to merge into the Host version (<strong style={{ color: 'var(--green)' }}>{hostName}</strong>).
                </>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {/* View Switcher */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)', padding: '0 16px' }}>
          <button
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'compare' ? '2px solid var(--accent)' : '2px solid transparent',
              color: activeTab === 'compare' ? 'var(--text-primary)' : 'var(--text-muted)',
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
            onClick={() => setActiveTab('compare')}
          >
            Side-by-Side Comparison
          </button>
          <button
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'custom' ? '2px solid var(--accent)' : '2px solid transparent',
              color: activeTab === 'custom' ? 'var(--text-primary)' : 'var(--text-muted)',
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
            onClick={() => setActiveTab('custom')}
          >
            Manual Merge Editor
          </button>
        </div>

        {activeTab === 'compare' ? (
          <>
            {/* Side by side code comparison */}
            <div className="conflict-changes">
              <div className="conflict-change-box">
                <div className="conflict-change-label a">
                  Host Version ({hostName})
                </div>
                <div className="conflict-change-code" style={{ maxHeight: 280, overflowY: 'auto' }}>
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
                    {hostContent || '(File is currently empty)'}
                  </pre>
                </div>
              </div>

              <div className="conflict-change-box">
                <div className="conflict-change-label b">
                  Collaborator Version ({collaboratorName})
                </div>
                <div className="conflict-change-code" style={{ maxHeight: 280, overflowY: 'auto' }}>
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
                    {collaboratorContent || '(File is currently empty)'}
                  </pre>
                </div>
              </div>
            </div>

            {/* AST Changes summary */}
            {changes.length > 0 && (
              <div style={{ padding: '8px 16px', background: 'var(--bg-elevated)', borderTop: '1px solid var(--border)', fontSize: 11 }}>
                <span style={{ color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', marginRight: 8 }}>
                  Detected AST Changes:
                </span>
                {changes.map((c, i) => (
                  <span key={i} style={{ display: 'inline-block', marginRight: 8, padding: '1px 5px', background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                    <strong style={{ color: 'var(--accent)' }}>{c.operation}</strong> {c.node_type} <code>"{c.name}"</code> (L{c.line_start}–{c.line_end})
                  </span>
                ))}
              </div>
            )}

            {/* ML Prediction analysis */}
            {prediction && (
              <div className="ml-prediction-box" style={{ margin: '12px 16px 8px', borderLeftColor: isConflict ? 'var(--yellow)' : 'var(--green)' }}>
                <div className="ml-prediction-label" style={{ color: isConflict ? 'var(--yellow)' : 'var(--green)' }}>
                  ML Conflict Guard Analysis
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className={`badge ${isConflict ? 'badge-conflict' : 'badge-compatible'}`}>
                    {prediction.prediction}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {(prediction.confidence * 100).toFixed(1)}% confidence
                  </span>
                </div>
                <div className="ml-explanation" style={{ marginTop: 6, fontSize: 11.5, color: 'var(--text-secondary)' }}>
                  {prediction.explanation}
                </div>
              </div>
            )}
          </>
        ) : (
          <div style={{ padding: '12px 16px' }}>
            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 6px' }}>
              Edit the resolved final code below that will be committed to the Host version:
            </p>
            <textarea
              style={{
                width: '100%',
                height: 260,
                background: '#0d0f14',
                color: '#fff',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                lineHeight: 1.6,
                padding: 10,
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                resize: 'vertical',
                boxSizing: 'border-box',
                outline: 'none',
              }}
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
            />
          </div>
        )}

        {/* Actions */}
        <div className="conflict-actions" style={{ padding: '12px 16px', display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid var(--border)' }}>
          {conflict.isNewFile ? (
            <>
              <button
                className="btn btn-secondary btn-sm"
                onClick={onKeepHost}
                title="Decline this new file and do not add to project"
              >
                Decline New File
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={onAcceptCollaborator}
                title={`Accept and add "${filename}" into project workspace`}
                style={{ background: 'var(--green)', borderColor: 'var(--green)' }}
              >
                ✓ Accept &amp; Add "{filename}" to Project
              </button>
            </>
          ) : activeTab === 'compare' ? (
            <>
              <button
                className="btn btn-secondary btn-sm"
                onClick={onKeepHost}
                title="Reject incoming merge and preserve current host code"
              >
                Keep Host Version
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={onMergeBoth}
                title="Combine changes from both versions"
              >
                Merge Both
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={onAcceptCollaborator}
                title="Accept collaborator changes and overwrite host code"
              >
                Accept Incoming ({collaboratorName})
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-secondary btn-sm" onClick={() => setActiveTab('compare')}>
                Back to Comparison
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleApplyCustom}>
                Confirm &amp; Commit Merge
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
