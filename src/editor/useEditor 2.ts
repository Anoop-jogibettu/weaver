import { useEffect, useRef, useCallback } from 'react';
import { EditorView, ViewUpdate, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { insertTab, indentMore, indentLess } from '@codemirror/commands';
import { basicSetup } from 'codemirror';
import { python } from '@codemirror/lang-python';
import { yCollab } from 'y-codemirror.next';
import * as Y from 'yjs';
import { oneDark } from '@codemirror/theme-one-dark';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';

interface UseEditorOptions {
  file: string;
  initialContent?: string;
  awareness?: any;
  onChange?: (content: string, view: EditorView) => void;
  onCursorLine?: (line: number) => void;
  isDraftMode?: boolean;
}

export function useEditor(
  containerRef: React.RefObject<HTMLDivElement | null>,
  options: UseEditorOptions,
) {
  const viewRef = useRef<EditorView | null>(null);

  // Store options in a ref so listeners and hooks access fresh callbacks
  // without triggering editor re-initialization or dependency updates.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const destroyEditor = useCallback(() => {
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }
  }, []);

  const initEditor = useCallback(
    (ytext: Y.Text, undoManager?: Y.UndoManager) => {
      if (!containerRef.current) return;

      // If an EditorView is already initialized for this container, preserve it
      if (viewRef.current) {
        return viewRef.current;
      }

      const updateListener = EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.docChanged && optionsRef.current.onChange) {
          optionsRef.current.onChange(update.state.doc.toString(), update.view);
        }
        // Track cursor line whenever selection or content changes
        if ((update.selectionSet || update.docChanged) && optionsRef.current.onCursorLine) {
          const pos = update.state.selection.main.head;
          const line = update.state.doc.lineAt(pos).number;
          optionsRef.current.onCursorLine(line);
        }
      });

      const awareness = optionsRef.current.awareness || null;
      let initialText = '';
      let ycollabExtension = [];
      
      if (typeof ytext === 'string') {
        initialText = ytext || optionsRef.current.initialContent || '';
      } else {
        initialText = ytext.toString() || optionsRef.current.initialContent || '';
        if (!optionsRef.current.isDraftMode) {
          ycollabExtension = [yCollab(ytext, awareness, { undoManager })];
        }
      }

      const customTabBinding = {
        key: "Tab",
        run: (view: EditorView) => {
          if (view.state.selection.ranges.some((r) => !r.empty)) {
            return indentMore(view);
          }
          return insertTab(view);
        },
        shift: indentLess
      };

      const state = EditorState.create({
        doc: initialText,
        extensions: [
          basicSetup,
          keymap.of([customTabBinding]),
          python(),
          indentationMarkers({ highlightActiveBlock: true }),
          oneDark,
          ...ycollabExtension,
          updateListener,
          EditorView.theme({
            '&': { height: '100%', backgroundColor: '#0d0f14' },
            '.cm-scroller': { overflow: 'auto', fontFamily: "'JetBrains Mono', monospace" },
          }),
        ],
      });

      const view = new EditorView({
        state,
        parent: containerRef.current,
      });

      viewRef.current = view;
      return view;
    },
    [containerRef],
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

  const scrollToLine = useCallback((line: number) => {
    if (!viewRef.current) return;
    try {
      const doc = viewRef.current.state.doc;
      const targetLine = Math.max(1, Math.min(line, doc.lines));
      const pos = doc.line(targetLine).from;
      viewRef.current.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: 'center' }),
      });
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, []);

  return { initEditor, destroyEditor, getContent, setContent, scrollToLine, viewRef };
}
