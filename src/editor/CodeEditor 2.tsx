import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as Y from 'yjs';
import { getYText } from '../collaboration/store';
import { useEditor } from './useEditor';

interface CodeEditorProps {
  file: string;
  initialContent?: string;
  onContentChange?: (content: string) => void;
  readOnly?: boolean;
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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const ytextRef = useRef<Y.Text | null>(null);
  const undoManagerRef = useRef<Y.UndoManager | null>(null);
  const [ready, setReady] = useState(false);

  const handleChange = useCallback(
    (content: string) => {
      onContentChange?.(content);
    },
    [onContentChange],
  );

  const { initEditor } = useEditor(containerRef, {
    file,
    initialContent: initialContent || DEFAULT_CONTENTS[file] || '',
    onChange: handleChange,
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
    const defaultContent = initialContent || DEFAULT_CONTENTS[file] || '';
    if (ytext.length === 0 && defaultContent) {
      ytext.insert(0, defaultContent);
    }

    const undo = new Y.UndoManager(ytext);
    undoManagerRef.current = undo;

    initEditor(ytext, undo);
    setReady(true);

    return () => {
      undo.destroy();
    };
  }, [file, initEditor, initialContent]);

  return (
    <div className="editor-wrap">
      {!ready && (
        <div className="empty-state" style={{ height: '100%' }}>
          <div className="spinner" />
          <span>Initializing editor…</span>
        </div>
      )}
      <div
        ref={containerRef}
        style={{ height: '100%', display: ready ? 'block' : 'none' }}
      />
    </div>
  );
};
