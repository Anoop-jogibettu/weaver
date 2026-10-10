import React, { useState, useEffect, useCallback, useRef } from 'react';

export interface LiveConflictState {
  detected: boolean;
  severity: 'conflict' | 'compatible' | 'checking' | 'idle';
  peerName: string;
  peerColor: string;
  localNode: string;
  peerNode: string;
  localFile: string;
  confidence: number;
  explanation: string;
}

interface LiveConflictBannerProps {
  liveConflict: LiveConflictState;
  onReview: () => void;
}

export const LiveConflictBanner: React.FC<LiveConflictBannerProps> = ({
  liveConflict,
  onReview,
}) => {
  const [visible, setVisible] = useState(false);
  const [animate, setAnimate] = useState(false);
  const prevSeverity = useRef<string>('idle');

  useEffect(() => {
    const isActive = liveConflict.severity !== 'idle';
    setVisible(isActive);

    if (liveConflict.severity !== prevSeverity.current) {
      setAnimate(true);
      const t = setTimeout(() => setAnimate(false), 600);
      prevSeverity.current = liveConflict.severity;
      return () => clearTimeout(t);
    }
  }, [liveConflict.severity]);

  if (!visible) return null;

  const isConflict = liveConflict.severity === 'conflict';
  const isCompatible = liveConflict.severity === 'compatible';
  const isChecking = liveConflict.severity === 'checking';

  return (
    <div
      className={`live-conflict-banner ${liveConflict.severity} ${animate ? 'banner-animate' : ''}`}
      role="alert"
      aria-live="polite"
    >
      <div className="lcb-icon">
        {isConflict && <span className="lcb-icon-symbol conflict-pulse">⚠</span>}
        {isCompatible && <span className="lcb-icon-symbol">✓</span>}
        {isChecking && <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />}
      </div>

      <div className="lcb-body">
        <div className="lcb-title">
          {isConflict && (
            <>
              <strong>Potential Merge Conflict</strong>
              <span className="lcb-conf-badge">
                {(liveConflict.confidence * 100).toFixed(0)}% confidence
              </span>
            </>
          )}
          {isCompatible && <strong>Structurally Compatible</strong>}
          {isChecking && <strong>Analyzing concurrent edits…</strong>}
        </div>
        <div className="lcb-detail">
          {isConflict && (
            <>
              <span className="lcb-peer" style={{ color: liveConflict.peerColor }}>
                {liveConflict.peerName}
              </span>
              {' '}is concurrently modifying{' '}
              <code className="lcb-node">{liveConflict.peerNode}</code>
              {liveConflict.localNode && liveConflict.localNode !== liveConflict.peerNode && (
                <> · You are editing <code className="lcb-node">{liveConflict.localNode}</code></>
              )}
            </>
          )}
          {isCompatible && (
            <>
              <span className="lcb-peer" style={{ color: liveConflict.peerColor }}>
                {liveConflict.peerName}
              </span>
              {' '}is editing{' '}
              <code className="lcb-node">{liveConflict.peerNode}</code>
              {liveConflict.localNode && liveConflict.localNode !== liveConflict.peerNode && (
                <> · You are editing <code className="lcb-node">{liveConflict.localNode}</code></>
              )}
              {' — no structural collision detected.'}
            </>
          )}
          {isChecking && 'Running AST diff and ML classification…'}
        </div>
      </div>

      {isConflict && (
        <button
          className="lcb-action-btn"
          onClick={onReview}
          aria-label="Review conflict details"
        >
          Review &amp; Resolve
        </button>
      )}
    </div>
  );
};

/** Compact "typing indicator" shown inside the editor gutter area when you are actively editing */
export const ActiveNodeChip: React.FC<{ nodeName: string; lineStart: number }> = ({
  nodeName,
  lineStart,
}) => (
  <div className="active-node-chip">
    <span className="anc-dot" />
    <span>Editing</span>
    <code>{nodeName}</code>
    <span className="anc-line">·L{lineStart}</span>
  </div>
);
