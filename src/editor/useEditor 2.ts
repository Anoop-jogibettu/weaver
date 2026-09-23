import { useEffect, useRef, useCallback } from 'react';
import { EditorView, ViewUpdate } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { python } from '@codemirror/lang-python';
import { yCollab } from 'y-codemirror.next';
import * as Y from 'yjs';
import { getYText } from '../collaboration/store';

// Dark theme for CodeMirror
import { oneDark } from '@codemirror/theme-one-dark';

interface UseEditorOptions {
  file: string;
  initialContent?: string;
  onChange?: (content: string, view: EditorView) => void;
}

export function useEditor(
  containerRef: React.RefObject<HTMLDivElement | null>,
  options: UseEditorOptions,
) {
  const viewRef = useRef<EditorView | null>(null);
  const { file, initialContent, onChange } = options;

  const initEditor = useCallback(
    (ytext: Y.Text, undoManager: Y.UndoManager) => {
      if (!containerRef.current) return;
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }

      const updateListener = EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.docChanged && onChange) {
          onChange(update.state.doc.toString(), update.view);
        }
      });

      const state = EditorState.create({
        doc: ytext.toString() || initialContent || '',
        extensions: [
          basicSetup,
          python(),
          oneDark,
          yCollab(ytext, undoManager),
          updateListener,
          EditorView.theme({
            '&': { height: '100%', backgroundColor: '#0d0f14' },
            '.cm-scroller': { overflow: 'auto', fontFamily: "'JetBrains Mono', monospace" },
          }),
        ],
      });

      viewRef.current = new EditorView({
        state,
        parent: containerRef.current,
      });
    },
    [containerRef, initialContent, onChange],
  );

  const getContent = useCallback(() => {
    return viewRef.current?.state.doc.toString() ?? '';
  }, []);

  const setContent = useCallback((content: string) => {
    if (!viewRef.current) return;
    const view = viewRef.current;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    });
  }, []);

  useEffect(() => {
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, []);

  return { initEditor, getContent, setContent, viewRef };
}
