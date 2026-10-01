import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as Y from 'yjs';
import { getYText, getAwareness } from '../collaboration/store';
import { useEditor } from './useEditor';
import { LiveConflictBanner, ActiveNodeChip } from './LiveConflictBanner';
import type { LiveConflictState } from './LiveConflictBanner';

interface CodeEditorProps {
  file: string;
  initialContent?: string;
  onContentChange?: (content: string, cursorLine: number) => void;
  readOnly?: boolean;
  liveConflict?: LiveConflictState;
  localNodeName?: string;
  localNodeLine?: number;
  onReviewConflict?: () => void;
  targetLine?: number | null;
}

const DEFAULT_CONTENTS: Record<string, string> = {
  'main.py': `def calculate(x):
    return x * 2

def greet(name):
    return f"Hello, {name}!"
`,
  'utils.py': `def format_output(value):
    return str(value).strip()

def clamp(val, lo, hi):
    return max(lo, min(hi, val))
`,
  'models.py': `class DataModel:
    def __init__(self, data):
        self.data = data

    def validate(self):
        return self.data is not None
`,
};

export const CodeEditor: React.FC<CodeEditorProps> = ({
  file,
  initialContent,
  onContentChange,
  liveConflict,
  localNodeName,
  localNodeLine,
  onReviewConflict,
  targetLine,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const ytextRef = useRef<Y.Text | null>(null);
  const undoManagerRef = useRef<Y.UndoManager | null>(null);
  const [ready, setReady] = useState(false);
  const cursorLineRef = useRef(1);

  // Keep onContentChange in a ref so cursor/text changes don't trigger re-renders or re-inits
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  const handleChange = useCallback((content: string) => {
    onContentChangeRef.current?.(content, cursorLineRef.current);
  }, []);

  const handleCursorLine = useCallback((line: number) => {
    cursorLineRef.current = line;
    if (ytextRef.current) {
      onContentChangeRef.current?.(ytextRef.current.toString(), line);
    }
  }, []);

  // Capture initialContent once on mount
  const initialContentRef = useRef(initialContent);
  if (initialContentRef.current === undefined && initialContent !== undefined) {
    initialContentRef.current = initialContent;
  }

  const isDraftMode = !file.endsWith('.md') && !file.endsWith('.txt');

  const { initEditor, destroyEditor, scrollToLine, getContent } = useEditor(containerRef, {
    file,
    initialContent: initialContentRef.current || DEFAULT_CONTENTS[file] || '',
    awareness: getAwareness(),
    onChange: handleChange,
    onCursorLine: handleCursorLine,
    isDraftMode,
  });

  useEffect(() => {
    let ytext: Y.Text;
    try {
      ytext = getYText(file);
      ytextRef.current = ytext;
    } catch {
      // collaboration not yet initialized — skip
      return;
    }

    // Initialize Y.Text with default content if empty
    const defaultContent = initialContentRef.current || DEFAULT_CONTENTS[file] || '';
    if (ytext.length === 0 && defaultContent) {
      ytext.insert(0, defaultContent);
    }

    const undo = new Y.UndoManager(ytext);
    undoManagerRef.current = undo;

    initEditor(ytext, undo);
    setReady(true);

    return () => {
      undo.destroy();
      destroyEditor();
    };
  }, [file, initEditor, destroyEditor]);

  useEffect(() => {
    if (targetLine && ready) {
      scrollToLine(targetLine);
    }
  }, [targetLine, ready, scrollToLine]);

  const showConflictBorder =
    liveConflict &&
    (liveConflict.severity === 'conflict' || liveConflict.severity === 'compatible');

  const handlePushToShared = () => {
    if (!ytextRef.current) return;
    const currentShared = ytextRef.current.toString();
    const localContent = getContent();
    if (currentShared !== localContent) {
      ytextRef.current.delete(0, ytextRef.current.length);
      ytextRef.current.insert(0, localContent);
    }
  };

  return (
    <div className="editor-wrap">
      {/* Live As-You-Type Conflict Banner */}
      {liveConflict && (
        <LiveConflictBanner
          liveConflict={liveConflict}
          onReview={onReviewConflict ?? (() => {})}
        />
      )}

      {/* Active AST node chip */}
      {localNodeName && localNodeLine && (
        <ActiveNodeChip nodeName={localNodeName} lineStart={localNodeLine} />
      )}

      {/* Draft Mode Toolbar */}
      {isDraftMode && ready && (
        <div style={{ position: 'absolute', top: 10, right: 20, zIndex: 10 }}>
          <button 
            className="editor-action-btn accent" 
            onClick={handlePushToShared}
            title="Push local draft to shared collaborative document"
            style={{ backgroundColor: '#2ea043', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            🚀 Push to Shared
          </button>
        </div>
      )}

      {!ready && (
        <div className="empty-state" style={{ height: '100%' }}>
          <div className="spinner" />
          <span>Initializing editor…</span>
        </div>
      )}
      <div
        ref={containerRef}
        className={showConflictBorder ? `editor-conflict-border-${liveConflict!.severity}` : ''}
        style={{ height: '100%', display: ready ? 'block' : 'none' }}
      />
    </div>
  );
};
