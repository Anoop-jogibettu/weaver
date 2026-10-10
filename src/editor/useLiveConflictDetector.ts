/**
 * useLiveConflictDetector
 * 
 * Continuously monitors as-you-type edits and checks for concurrent AST-level
 * conflicts with peers (or a simulated peer in single-tab demo mode).
 * 
 * Workflow per keystroke:
 * 1. Resolve current cursor line → AST node via /api/parse
 * 2. Broadcast activeNode to peers via Yjs awareness
 * 3. Query peer awareness for concurrent edits in same file
 * 4. If peer is editing same/overlapping node → classify with ML
 * 5. Return live conflict state for rendering
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { parseSource, classifyChanges } from '../api/client';
import {
  broadcastActiveNode,
  getPeerActiveEdits,
  subscribeAwareness,
  type ActiveNodeInfo,
  type PeerEditState,
} from '../collaboration/store';
import type { LiveConflictState } from './LiveConflictBanner';

const IDLE_STATE: LiveConflictState = {
  detected: false,
  severity: 'idle',
  peerName: '',
  peerColor: '',
  localNode: '',
  peerNode: '',
  localFile: '',
  confidence: 0,
  explanation: '',
};

/** Find the AST node at a given cursor line */
function findNodeAtLine(nodes: { node_type: string; name?: string; line_start: number; line_end: number }[], line: number): ActiveNodeInfo | null {
  // Priority: FunctionDef / ClassDef > others
  let best: ActiveNodeInfo | null = null;
  let bestPriority = -1;
  for (const n of nodes) {
    if (line < n.line_start || line > n.line_end) continue;
    const priority = (n.node_type === 'FunctionDef' || n.node_type === 'ClassDef') ? 2 : 1;
    if (priority > bestPriority) {
      bestPriority = priority;
      best = {
        node_type: n.node_type,
        name: n.name || `line:${n.line_start}`,
        line_start: n.line_start,
        line_end: n.line_end,
        operation: 'modified',
      };
    }
  }
  return best;
}

export function useLiveConflictDetector() {
  const [liveConflict, setLiveConflict] = useState<LiveConflictState>(IDLE_STATE);
  const [localActiveNode, setLocalActiveNode] = useState<ActiveNodeInfo | null>(null);
  const [simulatedPeer, setSimulatedPeer] = useState<PeerEditState | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Track latest state to re-analyze when peers move
  const latestContext = useRef({ content: '', file: '', cursorLine: 1 });

  const resetToIdle = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      setLiveConflict(IDLE_STATE);
      setLocalActiveNode(null);
      broadcastActiveNode('', 0, null, false);
    }, 5000); // hide banner after 5s of inactivity
  }, []);

  /**
   * Call this on every editor content change (debounced internally).
   */
  const analyzeEdit = useCallback(
    (content: string, file: string, cursorLine: number) => {
      latestContext.current = { content, file, cursorLine };
      // Reset idle timer whenever user types
      resetToIdle();

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        if (!content.trim()) return;

        try {
          // 1. Parse current content to resolve AST node at cursor
          const parseResult = await parseSource(content, file);
          if (!parseResult.success || !parseResult.nodes) return;

          const myNode = findNodeAtLine(parseResult.nodes, cursorLine);
          setLocalActiveNode(myNode);

          // 2. Broadcast our current editing state to peers
          broadcastActiveNode(file, cursorLine, myNode, true);

          // 3. Get peer edits for the same file (plus any simulated peer for demo purposes)
          const peerEdits = getPeerActiveEdits().filter((p) => p.activeFile === file && p.editing);
          if (simulatedPeer && simulatedPeer.activeFile === file) {
            peerEdits.push(simulatedPeer);
          }

          if (peerEdits.length === 0) {
            // Nobody else editing this file right now
            setLiveConflict(IDLE_STATE);
            return;
          }

          // 4. Show "checking" briefly while we classify
          setLiveConflict({
            ...IDLE_STATE,
            severity: 'checking',
            peerName: peerEdits[0].user.name,
            peerColor: peerEdits[0].user.color,
            localNode: myNode?.name || '',
            peerNode: peerEdits[0].activeNode?.name || '(unknown)',
            localFile: file,
          });

          // 5. Run ML classification for each peer
          for (const peer of peerEdits) {
            const peerNode = peer.activeNode;

            // Build change descriptors for the ML model
            const changeA = myNode
              ? {
                  node_type: myNode.node_type,
                  name: myNode.name,
                  operation: 'modified',
                  line_start: myNode.line_start,
                  line_end: myNode.line_end,
                  parent: 'Module',
                }
              : {
                  node_type: 'Unknown',
                  name: `line:${cursorLine}`,
                  operation: 'modified',
                  line_start: cursorLine,
                  line_end: cursorLine,
                  parent: 'Module',
                };

            const changeB = peerNode
              ? {
                  node_type: peerNode.node_type,
                  name: peerNode.name,
                  operation: peerNode.operation || 'modified',
                  line_start: peerNode.line_start,
                  line_end: peerNode.line_end,
                  parent: 'Module',
                }
              : {
                  node_type: 'Unknown',
                  name: `line:${peer.activeLine}`,
                  operation: 'modified',
                  line_start: peer.activeLine,
                  line_end: peer.activeLine,
                  parent: 'Module',
                };

            try {
              const result = await classifyChanges(changeA, changeB);
              const pred = result.prediction;
              const isConflict = pred.prediction === 'Potential Conflict';

              setLiveConflict({
                detected: isConflict,
                severity: isConflict ? 'conflict' : 'compatible',
                peerName: peer.user.name,
                peerColor: peer.user.color,
                localNode: myNode?.name || `line:${cursorLine}`,
                peerNode: peerNode?.name || `line:${peer.activeLine}`,
                localFile: file,
                confidence: pred.confidence,
                explanation: pred.explanation || '',
              });
            } catch {
              // ML service unavailable — do a fast heuristic instead
              const overlap =
                myNode &&
                peerNode &&
                myNode.name === peerNode.name &&
                myNode.node_type === peerNode.node_type;

              setLiveConflict({
                detected: !!overlap,
                severity: overlap ? 'conflict' : 'compatible',
                peerName: peer.user.name,
                peerColor: peer.user.color,
                localNode: myNode?.name || `line:${cursorLine}`,
                peerNode: peerNode?.name || `line:${peer.activeLine}`,
                localFile: file,
                confidence: 0.75,
                explanation: 'Heuristic: same AST node name detected (ML service unavailable)',
              });
            }
          }
        } catch {
          // parse failed (e.g. incomplete syntax) — don't crash, just skip
          broadcastActiveNode(file, cursorLine, null, true);
        }
      }, 350); // 350ms debounce — fast enough to feel real-time
    },
    [resetToIdle],
  );

  // When awareness changes (e.g. a peer types or moves), re-evaluate against our current context
  useEffect(() => {
    const unsub = subscribeAwareness(() => {
      const { content, file, cursorLine } = latestContext.current;
      if (content && file) {
        analyzeEdit(content, file, cursorLine);
      }
    });
    return unsub;
  }, [analyzeEdit]);

  // Demo helper: simulate a peer editing the exact same node we are
  const triggerSimulatedConflict = useCallback(() => {
    const { content, file, cursorLine } = latestContext.current;
    if (!file) return;
    
    // Fake peer editing same location
    const peer: PeerEditState = {
      user: { id: 'sim-1', name: 'DemoBot', color: '#f59e0b', isHost: false },
      activeFile: file,
      activeLine: cursorLine,
      activeNode: localActiveNode || { node_type: 'FunctionDef', name: 'demo_function', line_start: cursorLine, line_end: cursorLine + 5, operation: 'modified' },
      editing: true,
      lastEditTime: Date.now(),
    };
    
    setSimulatedPeer(peer);
    
    // Re-run analysis immediately
    if (content) {
      analyzeEdit(content, file, cursorLine);
    }
    
    // Clear simulation after 10 seconds
    setTimeout(() => {
      setSimulatedPeer(null);
      resetToIdle();
    }, 10000);
  }, [localActiveNode, analyzeEdit, resetToIdle]);

  return { liveConflict, localActiveNode, analyzeEdit, triggerSimulatedConflict };
}
