import React from 'react';

interface ConflictData {
  changeA: {
    userId: string;
    userName: string;
    node_type: string;
    name: string;
    operation: string;
    line_start: number;
    line_end: number;
  };
  changeB: {
    userId: string;
    userName: string;
    node_type: string;
    name: string;
    operation: string;
    line_start: number;
    line_end: number;
  };
  features: Record<string, number>;
  prediction: {
    label: number;
    confidence: number;
    prediction: string;
    explanation: string;
    feature_importances: Record<string, number>;
    inference_time_ms?: number;
  };
}

interface ConflictModalProps {
  conflict: ConflictData;
  onAcceptA: () => void;
  onAcceptB: () => void;
  onKeepBoth: () => void;
  onManual: () => void;
  onClose: () => void;
}

const OpBadge: React.FC<{ op: string }> = ({ op }) => (
  <span className={`op-badge ${op}`}>{op}</span>
);

export const ConflictModal: React.FC<ConflictModalProps> = ({
  conflict,
  onAcceptA,
  onAcceptB,
  onKeepBoth,
  onManual,
  onClose,
}) => {
  const { changeA, changeB, features, prediction } = conflict;
  const topFeatures = Object.entries(prediction.feature_importances || {}).slice(0, 4);

  return (
    <div className="conflict-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="conflict-card">
        {/* Header */}
        <div className="conflict-card-header">
          <div className="icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div>
            <h2>Potential Structural Conflict Detected</h2>
            <p>
              Two users have made concurrent changes to the same AST structure. ML confidence:{' '}
              <strong style={{ color: 'var(--yellow)' }}>
                {(prediction.confidence * 100).toFixed(1)}%
              </strong>
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {/* Change comparison */}
        <div className="conflict-changes">
          <div className="conflict-change-box">
            <div className="conflict-change-label a">
              User A — {changeA.userName}
            </div>
            <div className="conflict-change-code">
              <div>
                <OpBadge op={changeA.operation} />
                <strong>{changeA.node_type}</strong>
                {changeA.name && <> "<span style={{ color: 'var(--accent)' }}>{changeA.name}</span>"</>}
              </div>
              <div style={{ marginTop: 6, color: 'var(--text-muted)', fontSize: 11 }}>
                Lines {changeA.line_start}–{changeA.line_end}
              </div>
            </div>
          </div>

          <div className="conflict-change-box">
            <div className="conflict-change-label b">
              User B — {changeB.userName}
            </div>
            <div className="conflict-change-code">
              <div>
                <OpBadge op={changeB.operation} />
                <strong>{changeB.node_type}</strong>
                {changeB.name && <> "<span style={{ color: 'var(--green)' }}>{changeB.name}</span>"</>}
              </div>
              <div style={{ marginTop: 6, color: 'var(--text-muted)', fontSize: 11 }}>
                Lines {changeB.line_start}–{changeB.line_end}
              </div>
            </div>
          </div>
        </div>

        {/* Meta */}
        <div className="conflict-meta">
          <div className="conflict-meta-item">
            <span>Affected AST Node</span>
            <span>
              <code style={{ color: 'var(--accent)', fontSize: 12 }}>{changeA.node_type}</code>
            </span>
          </div>
          <div className="conflict-meta-item">
            <span>Node Name</span>
            <span>
              <code style={{ color: 'var(--text-primary)', fontSize: 12 }}>
                {changeA.name || '—'}
              </code>
            </span>
          </div>
          <div className="conflict-meta-item">
            <span>Same AST Node</span>
            <span style={{ color: features.same_function || features.same_class || features.same_name ? 'var(--red)' : 'var(--green)' }}>
              {features.same_function || features.same_class || features.same_name ? 'Yes ⚠' : 'No'}
            </span>
          </div>
          <div className="conflict-meta-item">
            <span>Line Overlap</span>
            <span style={{ color: features.line_overlap ? 'var(--red)' : 'var(--green)' }}>
              {features.line_overlap ? 'Yes ⚠' : 'No'}
            </span>
          </div>
        </div>

        {/* ML Prediction */}
        <div className="ml-prediction-box">
          <div className="ml-prediction-label">
            🤖 ML Classifier Result
            {prediction.inference_time_ms !== undefined && (
              <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>
                ({prediction.inference_time_ms.toFixed(1)}ms)
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span
              className={`badge ${prediction.label === 0 ? 'badge-compatible' : prediction.confidence < 0.6 ? 'badge-uncertain' : 'badge-conflict'}`}
              style={{ fontSize: 13 }}
            >
              {prediction.prediction}
            </span>
            <span style={{ fontFamily: 'JetBrains Mono', fontSize: 14, fontWeight: 700, color: 'var(--yellow)' }}>
              {(prediction.confidence * 100).toFixed(1)}% confidence
            </span>
          </div>
          <div className="ml-confidence-bar" style={{ marginTop: 8 }}>
            <div
              className="ml-confidence-fill"
              style={{ width: `${prediction.confidence * 100}%` }}
            />
          </div>
          <div className="ml-explanation">{prediction.explanation}</div>

          {topFeatures.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
                Key Features (Importance)
              </div>
              {topFeatures.map(([feat, imp]) => (
                <div key={feat} className="feature-bar-row">
                  <span className="feature-bar-label">{feat.replace(/_/g, ' ')}</span>
                  <div className="feature-bar-track">
                    <div className="feature-bar-fill" style={{ width: `${Math.min(imp * 100 * 3, 100)}%` }} />
                  </div>
                  <span className="feature-bar-val">{(imp * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="conflict-actions">
          <button className="conflict-action-btn primary" onClick={onAcceptA}>
            Accept User A
          </button>
          <button className="conflict-action-btn" onClick={onAcceptB}>
            Accept User B
          </button>
          <button className="conflict-action-btn" onClick={onKeepBoth}>
            Keep Both
          </button>
          <button className="conflict-action-btn" onClick={onManual} style={{ color: 'var(--yellow)', borderColor: 'rgba(251,191,36,0.3)' }}>
            Manual Resolve
          </button>
        </div>
      </div>
    </div>
  );
};
