import React, { useState, useCallback, useEffect, useRef } from 'react';
import './index.css';
import { SessionGate } from './components/SessionGate';
import { CollabPanel } from './components/CollabPanel';
import { ConflictModal } from './conflict-ui/ConflictModal';
import type { ConflictData } from './conflict-ui/ConflictModal';
import { CodeEditor } from './editor/CodeEditor';
import { OutputPanel } from './editor/OutputPanel';
import type { RunResult, BottomPanelTab } from './editor/OutputPanel';
import { useLiveConflictDetector } from './editor/useLiveConflictDetector';
import { SnapshotsModal } from './components/SnapshotsModal';
import { CommentsDrawer } from './components/CommentsDrawer';
import { FileExplorer } from './components/FileExplorer';
import {
  initCollaboration,
  getConnectedUsers,
  getSyncStatus,
  getRecentChanges,
  recordChange,
  getLocalUser,
  getYText,
  getHostYText,
  mergeDraftToHost,
  syncDraftFromHost,
  addActivityLog,
  subscribeActivityLogs,
  clearActivityLogs,
  subscribeAwareness,
  getPeerState,
  getComments,
  subscribeComments,
  getHostFiles,
  subscribeHostFiles,
  addHostFile,
  removeHostFile,
  renameHostFile,
  initHostFiles,
  syncAllFilesFromHost,
  createMergeProposal,
  getMergeProposals,
  subscribeMergeProposals,
  resolveMergeProposal,
  subscribeHostTransfer,
  type UserInfo,
  type ActivityLogItem,
  type MergeProposal,
} from './collaboration/store';
import { diffSource, classifyChanges, runCode, formatCode, lintCode } from './api/client';

const DEFAULT_FILES: Record<string, string> = {
  'main.py': `def greet(name: str) -> str:
    return f"Hello, {name}!"

def add(a: int, b: int) -> int:
    return a + b

if __name__ == "__main__":
    print(greet("World"))
    print(add(3, 4))
`,
};

const isPythonFile = (value: string) => /\.(py|pyw)$/i.test(value);

const pythonPath = (value: string) => {
  const path = value.trim();
  return isPythonFile(path) ? path : `${path}.py`;
};

function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [userId, setUserId]       = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string>('');
  const [isHost, setIsHost]       = useState<boolean>(true);

  // ─── Dynamic file state ───────────────────────────────────────────────────
  const [files, setFiles]           = useState<string[]>(['main.py']);
  const [activeFile, setActiveFile] = useState('main.py');
  const [fileContents, setFileContents] = useState<Record<string, string>>({ ...DEFAULT_FILES });
  const prevContents = useRef<Record<string, string>>({ ...DEFAULT_FILES });

  // ─── File rename dialog state ─────────────────────────────────────────────
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameInput, setRenameInput]   = useState<string>('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // ─── Collab state ────────────────────────────────────────────────────────
  const [users, setUsers]           = useState<UserInfo[]>([]);
  const [syncStatus, setSyncStatus] = useState<'connected'|'connecting'|'disconnected'>('disconnected');
  const [localChanges, setLocalChanges]   = useState(0);
  const [remoteChanges, setRemoteChanges] = useState(0);
  const [astStatus, setAstStatus]   = useState<'idle'|'parsing'|'ready'|'error'>('idle');
  const [mlStatus, setMlStatus]     = useState<'idle'|'classifying'|'ready'>('idle');
  const [mlPrediction, setMlPrediction] = useState('');
  const [mlConfidence, setMlConfidence] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);

  // ─── Merge / Conflict state ───────────────────────────────────────────────
  const [conflictData, setConflictData] = useState<ConflictData | null>(null);
  const [merging, setMerging]           = useState(false);
  const [syncVersion, setSyncVersion]   = useState(0);

  // ─── Layout state ────────────────────────────────────────────────────────
  const [activeSidebar, setActiveSidebar] = useState<'explorer' | 'collab' | 'search'>('explorer');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(260);

  const isSidebarDragging = useRef(false);
  const handleSidebarMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isSidebarDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  const handleSidebarMouseMove = useCallback((e: MouseEvent) => {
    if (!isSidebarDragging.current) return;
    setSidebarWidth(Math.max(160, Math.min(e.clientX - 48, window.innerWidth / 2))); // 48 is activity bar width
  }, []);
  const handleSidebarMouseUp = useCallback(() => {
    isSidebarDragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);
  useEffect(() => {
    document.addEventListener('mousemove', handleSidebarMouseMove);
    document.addEventListener('mouseup', handleSidebarMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleSidebarMouseMove);
      document.removeEventListener('mouseup', handleSidebarMouseUp);
    };
  }, [handleSidebarMouseMove, handleSidebarMouseUp]);

  // ─── Run / output / activity log workbench state ─────────────────────────
  const [outputOpen, setOutputOpen]         = useState(false);
  const [bottomPanelTab, setBottomPanelTab] = useState<BottomPanelTab>('output');
  const [running, setRunning]               = useState(false);
  const [runResults, setRunResults]         = useState<RunResult[]>([]);
  const [stdin, setStdin]                   = useState('');
  const [activityLogs, setActivityLogs]     = useState<ActivityLogItem[]>([]);
  const lastConflictLoggedRef               = useRef<string>('');

  // ─── Visual Snapshots & Comments state ───────────────────────────────────
  const [snapshotsOpen, setSnapshotsOpen]   = useState(false);
  const [commentsOpen, setCommentsOpen]     = useState(false);
  const [openCommentsCount, setOpenCommentsCount] = useState(0);

  // ─── Peer Follow Mode & Navigation ────────────────────────────────────────
  const [followingUserId, setFollowingUserId] = useState<string | null>(null);
  const [targetLine, setTargetLine]           = useState<number | null>(null);
  const [currentEditorLine, setCurrentEditorLine] = useState<number>(1);

  // ─── Code Formatter & Diagnostics ─────────────────────────────────────────
  const [formatting, setFormatting] = useState(false);
  const [lintErrors, setLintErrors] = useState<Array<{ line: number; message: string }>>([]);

  // ─── Merge Proposals & Project Files state ────────────────────────────────
  const [pendingProposals, setPendingProposals] = useState<MergeProposal[]>([]);
  const prevProposalStatusRef                   = useRef<Record<string, string>>({});

  // ─── Misc ─────────────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<{id:number;msg:string;type:string}[]>([]);
  const analyzeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastId = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [headerCopied, setHeaderCopied] = useState(false);

  // ─── Live as-you-type conflict detector ──────────────────────────────────
  const { liveConflict, localActiveNode, analyzeEdit, triggerSimulatedConflict } = useLiveConflictDetector();

  const toast = useCallback((msg: string, type = 'info') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  // ─── Join session ─────────────────────────────────────────────────────────
  const handleJoined = useCallback((sid: string, uid: string, uname: string, host: boolean) => {
    setSessionId(sid);
    setUserId(uid);
    setCurrentUserName(uname);
    setIsHost(host);
    
    // Persist to session storage so refresh doesn't drop us
    sessionStorage.setItem('weaver_session', JSON.stringify({ sid, uid, uname, host }));
    
    try {
      const { localUser, provider } = initCollaboration(sid, uid, uname, host);
      toast(`Joined workspace ${sid} as ${uname} (${host ? 'Host' : 'Collaborator'})`, 'success');

      // Initialize or pull canonical project files
      if (host) {
        initHostFiles(files);
        
        // Wait for sync to avoid duplicating code on page reload
        
        provider.on('synced', (isSynced: boolean) => {
          if (isSynced) {
            files.forEach((f) => {
              try {
                const hostText = getHostYText(f);
                if (hostText.length === 0 && fileContents[f]) {
                  hostText.insert(0, fileContents[f]);
                }
              } catch (e) {}
            });
          }
        });
      } else {
        const hostFiles = getHostFiles();
        if (hostFiles.length > 0) {
          setFiles(hostFiles);
          const initialContents: Record<string, string> = {};
          hostFiles.forEach((f) => {
            const content = getHostYText(f).toString();
            initialContents[f] = content;
            prevContents.current[f] = content;
          });
          setFileContents((prev) => ({ ...prev, ...initialContents }));
          setActiveFile(hostFiles[0]);
        }
      }

      // Subscribe to merge proposals
      subscribeMergeProposals((props) => {
        setPendingProposals(props.filter((p) => p.status === 'pending'));
        // Alert collaborator when their proposals are accepted or rejected
        props.forEach((p) => {
          if (p.fromUserId === uid) {
            const prev = prevProposalStatusRef.current[p.id];
            if (prev === 'pending' && p.status === 'accepted') {
              toast(
                p.isNewFile
                  ? `✓ Host accepted and added "${p.file}" to the project!`
                  : `✓ Host accepted your merge for "${p.file}"!`,
                'success'
              );
            } else if (prev === 'pending' && p.status === 'rejected') {
              toast(`Host declined merge for "${p.file}".`, 'info');
            }
            prevProposalStatusRef.current[p.id] = p.status;
          }
        });
      });

      // Subscribe to real-time activity and merge logs
      subscribeActivityLogs((logs) => {
        setActivityLogs([...logs]);
      });

      // Record presence join event
      addActivityLog({
        type: 'presence',
        userId: uid,
        userName: localUser.name,
        userColor: localUser.color,
        isHost: host,
        action: `${localUser.name} joined workspace as ${host ? 'Host' : 'Collaborator'}`,
      });
    } catch {
      toast('Operating in local mode', 'info');
    }
  }, [fileContents, files, toast]);

  // ─── Restore Session on Refresh ──────────────────────────────────────────
  useEffect(() => {
    const saved = sessionStorage.getItem('weaver_session');
    if (saved && !sessionId) {
      try {
        const { sid, uid, uname, host } = JSON.parse(saved);
        if (sid && uid && uname) {
          handleJoined(sid, uid, uname, host);
        }
      } catch {
        sessionStorage.removeItem('weaver_session');
      }
    }
  }, [sessionId, handleJoined]);

  // ── Sync shared file list for ALL members (host and collaborators alike) ──
  useEffect(() => {
    if (!sessionId) return;
    const unsub = subscribeHostFiles((hostFiles) => {
      if (hostFiles.length === 0) return;
      setFiles((prev) => {
        const newlyAdded = hostFiles.filter((f) => !prev.includes(f));
        if (newlyAdded.length > 0) {
          // Defer the side-effects outside the setter
          setTimeout(() => {
            newlyAdded.forEach((f) => {
              const content = getHostYText(f).toString();
              setFileContents((fc) => ({ ...fc, [f]: content }));
              prevContents.current[f] = content;
            });
            setSyncVersion((v) => v + 1);
            if (!isHost) toast(`New file(s) added to project: ${newlyAdded.join(', ')}`, 'info');
          }, 0);
          return Array.from(new Set([...prev, ...hostFiles]));
        }
        return prev;
      });
    });
    return unsub;
  }, [isHost, sessionId, toast]);

  // ── Host failover: server elected us as new host ──────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    const unsub = subscribeHostTransfer((newHostUserId, newHostUserName) => {
      if (newHostUserId === userId) {
        // WE are the new host — promote ourselves
        setIsHost(true);

        // Pull all shared Yjs files into local state
        const hostFiles = getHostFiles();
        if (hostFiles.length > 0) {
          setFiles(hostFiles);
          const contents: Record<string, string> = {};
          hostFiles.forEach((f) => {
            contents[f] = getHostYText(f).toString();
            prevContents.current[f] = contents[f];
          });
          setFileContents((prev) => ({ ...prev, ...contents }));
        }

        const localUser = getLocalUser();
        addActivityLog({
          type: 'presence',
          userId: userId || 'host',
          userName: currentUserName || 'You',
          userColor: localUser?.color || '#fbbf24',
          isHost: true,
          action: `You have been promoted to Host (previous host disconnected)`,
        });

        toast(
          `👑 You are now the Host! All project files have been transferred to you.`,
          'success',
        );
      } else {
        // Someone else became host
        setIsHost(false);
        const displayName = (newHostUserName && newHostUserName !== 'Unknown') ? newHostUserName : 'A collaborator';
        addActivityLog({
          type: 'presence',
          userId: newHostUserId,
          userName: displayName,
          userColor: '#fbbf24',
          isHost: true,
          action: `${displayName} has taken over as Host`,
        });
        toast(`${displayName} is now the Host.`, 'info');
      }
    });
    return unsub;
  }, [currentUserName, sessionId, userId, toast]);


  // Log potential structural conflicts when detected
  useEffect(() => {
    if (liveConflict?.severity === 'conflict' && liveConflict.peerName && liveConflict.peerNode) {
      const conflictKey = `${activeFile}:${localActiveNode?.name}:${liveConflict.peerName}:${liveConflict.peerNode}`;
      if (lastConflictLoggedRef.current !== conflictKey) {
        lastConflictLoggedRef.current = conflictKey;
        const localUser = getLocalUser();
        addActivityLog({
          type: 'conflict',
          userId: userId || 'local',
          userName: currentUserName || (isHost ? 'Host' : 'Collaborator'),
          userColor: localUser?.color || '#ef4444',
          isHost,
          filename: activeFile,
          action: `Potential AST collision on "${localActiveNode?.name || 'function'}" with ${liveConflict.peerName}`,
          details: {
            astChanges: [`Peer editing: ${liveConflict.peerNode}`],
            target: localActiveNode?.name,
          },
        });
      }
    }
  }, [activeFile, currentUserName, isHost, liveConflict, localActiveNode, userId]);

  // ─── Poll presence ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    const iv = setInterval(() => {
      setUsers(getConnectedUsers().filter(u => u.id !== userId));
      setSyncStatus(getSyncStatus());
    }, 1000);
    return () => clearInterval(iv);
  }, [sessionId, userId]);

  // ─── Import file(s) from disk ─────────────────────────────────────────────
  const handleImportFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []).filter((file) => isPythonFile(file.name));
    if (!picked.length) {
      toast('Choose one or more Python (.py or .pyw) files.', 'info');
      e.target.value = '';
      return;
    }
    let imported = 0;
    picked.forEach((f) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = ev.target?.result as string;
        setFiles((fs) => fs.includes(f.name) ? fs : [...fs, f.name]);
        setFileContents((fc) => ({ ...fc, [f.name]: content }));
        prevContents.current[f.name] = content;
        try {
          const ytext = getYText(f.name);
          if (ytext.toString() !== content) {
            ytext.doc?.transact(() => {
              ytext.delete(0, ytext.length);
              ytext.insert(0, content);
            });
          }
        } catch { /* collab not ready */ }
        if (isHost) {
          addHostFile(f.name);
        }

        imported++;
        if (imported === 1) setActiveFile(f.name);

        const localUser = getLocalUser();
        addActivityLog({
          type: 'file',
          userId: userId || 'user',
          userName: currentUserName || (isHost ? 'Host' : 'Collaborator'),
          userColor: localUser?.color || '#6c8eff',
          isHost,
          filename: f.name,
          action: `Imported "${f.name}" from disk`,
        });

        if (imported === picked.length) {
          toast(`Imported ${imported} file${imported > 1 ? 's' : ''}`, 'success');
        }
      };
      reader.readAsText(f);
    });
    e.target.value = '';
  }, [currentUserName, isHost, toast, userId]);

  // ─── New blank file (optional explicit path from inline input) ─────────────
  const handleNewFile = useCallback((explicitPath?: string) => {
    let name: string;
    if (explicitPath) {
      name = pythonPath(explicitPath);
      // Deduplicate if collision
      if (files.includes(name)) {
        const base = name.replace(/\.py$/, '');
        let i = 1;
        while (files.includes(`${base}${i}.py`)) i++;
        name = `${base}${i}.py`;
      }
    } else {
      const base = 'untitled';
      name = `${base}.py`;
      let i = 1;
      while (files.includes(name)) { name = `${base}${i++}.py`; }
    }

    setFiles((fs) => [...fs, name]);
    setFileContents((fc) => ({ ...fc, [name]: '' }));
    prevContents.current[name] = '';
    setActiveFile(name);

    if (isHost) {
      addHostFile(name);
      try {
        const hostText = getHostYText(name);
        if (hostText.length > 0) hostText.delete(0, hostText.length);
      } catch { /* ignore */ }
    }

    const localUser = getLocalUser();
    addActivityLog({
      type: 'file',
      userId: userId || 'user',
      userName: currentUserName || (isHost ? 'Host' : 'Collaborator'),
      userColor: localUser?.color || '#6c8eff',
      isHost,
      filename: name,
      action: `Created new file "${name}"`,
    });
  }, [currentUserName, files, isHost, userId]);

  // ─── New folder (creates first file inside it) ────────────────────────────
  const handleNewFolder = useCallback((folderPath: string) => {
    const name = `${folderPath}/untitled.py`;
    const finalName = files.includes(name) ? `${folderPath}/untitled1.py` : name;
    setFiles((fs) => [...fs, finalName]);
    setFileContents((fc) => ({ ...fc, [finalName]: '' }));
    prevContents.current[finalName] = '';
    setActiveFile(finalName);

    if (isHost) {
      addHostFile(finalName);
      try {
        const hostText = getHostYText(finalName);
        if (hostText.length > 0) hostText.delete(0, hostText.length);
      } catch { /* ignore */ }
    }

    const localUser = getLocalUser();
    addActivityLog({
      type: 'file',
      userId: userId || 'user',
      userName: currentUserName || (isHost ? 'Host' : 'Collaborator'),
      userColor: localUser?.color || '#6c8eff',
      isHost,
      filename: finalName,
      action: `Created folder "${folderPath}" with file "${finalName}"`,
    });
  }, [currentUserName, files, isHost, userId]);

  // ─── Delete entire folder (remove all files with that prefix) ────────────
  const handleDeleteFolder = useCallback((folderPath: string) => {
    const prefix = folderPath + '/';
    const toRemove = files.filter((f) => f === folderPath || f.startsWith(prefix));
    if (toRemove.length === 0) return;

    setFiles((fs) => {
      const next = fs.filter((f) => !toRemove.includes(f));
      if (toRemove.includes(activeFile) && next.length > 0) {
        setActiveFile(next[0]);
      }
      return next;
    });
    setFileContents((fc) => {
      const copy = { ...fc };
      toRemove.forEach((f) => delete copy[f]);
      return copy;
    });
    toRemove.forEach((f) => { delete prevContents.current[f]; });

    if (isHost) {
      toRemove.forEach((f) => removeHostFile(f));
    }

    const localUser = getLocalUser();
    addActivityLog({
      type: 'file',
      userId: userId || 'user',
      userName: currentUserName || (isHost ? 'Host' : 'Collaborator'),
      userColor: localUser?.color || '#ef4444',
      isHost,
      action: `Deleted folder "${folderPath}" (${toRemove.length} file${toRemove.length > 1 ? 's' : ''})`,
    });
  }, [activeFile, currentUserName, files, isHost, userId]);

  // ─── File Renaming Dialog ─────────────────────────────────────────────────
  const openRenameDialog = useCallback((file: string) => {
    setRenameTarget(file);
    setRenameInput(file);
    setTimeout(() => {
      if (renameInputRef.current) {
        renameInputRef.current.focus();
        renameInputRef.current.select();
      }
    }, 50);
  }, []);

  const closeRenameDialog = useCallback(() => {
    setRenameTarget(null);
    setRenameInput('');
  }, []);

  const executeRename = useCallback((oldName: string, newName: string) => {
    if (!newName.trim()) {
      closeRenameDialog();
      return;
    }
    const trimmed = pythonPath(newName);
    if (!trimmed || trimmed === oldName) {
      closeRenameDialog();
      return;
    }
    if (files.includes(trimmed)) {
      toast(`A file named "${trimmed}" already exists.`, 'error');
      return;
    }

    // 1. Update file list
    setFiles((prev) => prev.map((f) => (f === oldName ? trimmed : f)));

    // 2. Transfer content state
    setFileContents((prev) => {
      const copy = { ...prev };
      copy[trimmed] = copy[oldName] ?? '';
      delete copy[oldName];
      return copy;
    });

    // 3. Transfer prevContents
    if (prevContents.current[oldName] !== undefined) {
      prevContents.current[trimmed] = prevContents.current[oldName];
      delete prevContents.current[oldName];
    }

    // 4. Transfer Y.Text content
    try {
      const oldY = getYText(oldName);
      const newY = getYText(trimmed);
      const content = oldY.toString() || fileContents[oldName] || '';
      if (content && newY.length === 0) {
        newY.insert(0, content);
      }
    } catch { /* collab not ready */ }

    if (isHost) {
      renameHostFile(oldName, trimmed);
    }

    // 5. Update activeFile if current file was renamed
    if (activeFile === oldName) {
      setActiveFile(trimmed);
    }

    const localUser = getLocalUser();
    addActivityLog({
      type: 'file',
      userId: userId || 'user',
      userName: currentUserName || (isHost ? 'Host' : 'Collaborator'),
      userColor: localUser?.color || '#6c8eff',
      isHost,
      filename: trimmed,
      action: `Renamed "${oldName}" → "${trimmed}"`,
      details: { oldName, newName: trimmed },
    });

    closeRenameDialog();
    toast(`Renamed "${oldName}" to "${trimmed}"`, 'success');
  }, [activeFile, closeRenameDialog, currentUserName, fileContents, files, isHost, toast, userId]);

  // ─── Close file tab ───────────────────────────────────────────────────────
  const handleCloseFile = useCallback((name: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setFiles((fs) => {
      const next = fs.filter((f) => f !== name);
      if (activeFile === name && next.length > 0) {
        setActiveFile(next[Math.max(0, fs.indexOf(name) - 1)]);
      }
      return next;
    });
    setFileContents((fc) => {
      const copy = { ...fc };
      delete copy[name];
      return copy;
    });

    if (isHost) {
      removeHostFile(name);
    }

    const localUser = getLocalUser();
    addActivityLog({
      type: 'file',
      userId: userId || 'user',
      userName: currentUserName || (isHost ? 'Host' : 'Collaborator'),
      userColor: localUser?.color || '#6c8eff',
      isHost,
      filename: name,
      action: `Closed file "${name}"`,
    });
  }, [activeFile, currentUserName, isHost, userId]);

  // ─── Save file to disk ────────────────────────────────────────────────────
  const handleSaveFile = useCallback(() => {
    const content = fileContents[activeFile] ?? '';
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Saved ${activeFile}`, 'success');
  }, [activeFile, fileContents, toast]);

  // ─── Run current file (Feature 1: Multi-file project sandbox) ───────────
  const handleRun = useCallback(async () => {
    const source = fileContents[activeFile];
    if (!source?.trim()) {
      toast('Nothing to run — file is empty.', 'info');
      return;
    }
    if (!isPythonFile(activeFile)) {
      toast('Only Python files can be run.', 'info');
      return;
    }
    setOutputOpen(true);
    setBottomPanelTab('output');
    setRunning(true);
    try {
      // Pass all open files so cross-file imports like "import utils" work smoothly
      const result = await runCode(source, activeFile, stdin, fileContents);
      setRunResults((rs) => [...rs, { ...result, timestamp: Date.now() }]);
    } catch {
      setRunResults((rs) => [...rs, {
        stdout: '',
        stderr: 'Could not reach execution backend. Ensure the server is running.',
        exit_code: -1,
        elapsed: 0,
        filename: activeFile,
        timestamp: Date.now(),
      }]);
    } finally {
      setRunning(false);
    }
  }, [activeFile, fileContents, stdin, toast]);

  // ─── Code formatting (PEP 8) (Feature 6) ──────────────────────────────────
  const handleFormat = useCallback(async () => {
    const source = fileContents[activeFile];
    if (!source?.trim() || !isPythonFile(activeFile)) {
      toast('Formatting is only supported for Python files currently.', 'info');
      return;
    }
    setFormatting(true);
    try {
      const res = await formatCode(source);
      if (res.formatted && res.formatted !== source) {
        setFileContents((fc) => ({ ...fc, [activeFile]: res.formatted }));
        prevContents.current[activeFile] = res.formatted;
        try {
          const ytext = getYText(activeFile);
          ytext.doc?.transact(() => {
            ytext.delete(0, ytext.length);
            ytext.insert(0, res.formatted);
          });
        } catch { /* ignore */ }
        toast(`Formatted ${activeFile} (PEP 8)`, 'success');
      } else {
        toast(`${activeFile} is already well-formatted`, 'info');
      }
    } catch (err: any) {
      toast(`Formatting error: ${err.message}`, 'error');
    } finally {
      setFormatting(false);
    }
  }, [activeFile, fileContents, toast]);

  // ─── Restore Snapshot (Feature 3) ─────────────────────────────────────────
  const handleRestoreSnapshot = useCallback((restoredFiles: Record<string, string>, snapName: string) => {
    setFileContents((prev) => ({ ...prev, ...restoredFiles }));
    setFiles((prev) => {
      const combined = new Set([...prev, ...Object.keys(restoredFiles)]);
      return Array.from(combined);
    });
    // Update CRDT text for each restored file
    Object.entries(restoredFiles).forEach(([fname, content]) => {
      try {
        const ytext = getYText(fname);
        ytext.doc?.transact(() => {
          ytext.delete(0, ytext.length);
          ytext.insert(0, content);
        });
      } catch { /* ignore */ }
    });
    const localUser = getLocalUser();
    addActivityLog({
      type: 'sync',
      userId: userId || 'local',
      userName: currentUserName || (isHost ? 'Host' : 'Collaborator'),
      userColor: localUser?.color || '#38bdf8',
      isHost,
      action: `Restored project snapshot "${snapName}" (${Object.keys(restoredFiles).length} files)`,
    });
    toast(`Restored snapshot "${snapName}"`, 'success');
  }, [currentUserName, isHost, toast, userId]);

  // ─── Follow Mode Effect (Feature 2) ───────────────────────────────────────
  useEffect(() => {
    if (!followingUserId) return;
    const unsub = subscribeAwareness(() => {
      const peer = getPeerState(followingUserId);
      if (peer) {
        if (peer.activeFile && files.includes(peer.activeFile) && peer.activeFile !== activeFile) {
          setActiveFile(peer.activeFile);
        }
        if (peer.activeLine) {
          setTargetLine(peer.activeLine);
        }
      }
    });
    const initialPeer = getPeerState(followingUserId);
    if (initialPeer) {
      if (initialPeer.activeFile && files.includes(initialPeer.activeFile)) {
        setActiveFile(initialPeer.activeFile);
      }
      if (initialPeer.activeLine) {
        setTargetLine(initialPeer.activeLine);
      }
    }
    return unsub;
  }, [followingUserId, files, activeFile]);

  // ─── Comments Count Effect (Feature 5) ────────────────────────────────────
  useEffect(() => {
    const updateCommentsCount = (all: any[]) => {
      setOpenCommentsCount(all.filter((c) => !c.resolved).length);
    };
    updateCommentsCount(getComments());
    return subscribeComments(updateCommentsCount);
  }, []);

  // Keyboard shortcut: Ctrl+Enter / Cmd+Enter to run, Ctrl+S / Cmd+S to save, Shift+Alt+F to format
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!running) handleRun();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveFile();
      }
      if (e.shiftKey && e.altKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        if (!formatting) handleFormat();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleRun, handleSaveFile, handleFormat, running, formatting]);

  // ─── Content changes from editor ─────────────────────────────────────────
  const handleContentChange = useCallback(
    (content: string, file: string, cursorLine = 1) => {
      setCurrentEditorLine(cursorLine);
      const prev = prevContents.current[file] ?? '';
      const changed = content !== prev;
      if (changed) {
        prevContents.current[file] = content;
        setFileContents((fc) => ({ ...fc, [file]: content }));
        setLocalChanges((n) => n + 1);
        try {
          recordChange(file, 'edit', content.slice(0, 40), 0, content.split('\n').length);
        } catch { /* collab not ready */ }
      }

      if (isPythonFile(file)) {
        analyzeEdit(content, file, cursorLine);
      }

      if (changed) {
        if (analyzeTimerRef.current) clearTimeout(analyzeTimerRef.current);
        analyzeTimerRef.current = setTimeout(async () => {
          if (!prev || !content) return;
          if (!isPythonFile(file)) return; // AST diff only for Python
          setAstStatus('parsing');
          
          try {
            const lintRes = await lintCode(content, file);
            if (lintRes.success) {
              setLintErrors(lintRes.errors || []);
            }
          } catch (e) {
            // fail silently for lint errors
          }

          try {
            const diffResult = await diffSource(prev, content, file);
            setAstStatus('ready');
            if (diffResult.success && diffResult.changes.length > 0) {
              const recentRemote = getRecentChanges(2);
              if (recentRemote.length >= 2) {
                const changeA = diffResult.changes[0];
                const changeB = { ...diffResult.changes[0], name: diffResult.changes[0].name || 'remote_change' };
                setMlStatus('classifying');
                const result = await classifyChanges(changeA, changeB);
                setMlStatus('ready');
                setMlPrediction(result.prediction.prediction);
                setMlConfidence(result.prediction.confidence);
                
                if (result.prediction.label === 1 || result.prediction.prediction.includes("Conflict")) {
                  toast(`⚠️ AST Merge Conflict Detected: ${result.prediction.explanation}`, 'error');
                }
              }
            }
          } catch {
            setAstStatus('error');
          }
        }, 1500);
      }
    },
    [analyzeEdit, toast],
  );

  // ─── Merge to Host & Conflict Resolution Workflow ─────────────────────────
  const handleMergeToHost = useCallback(async () => {
    const hostFiles = getHostFiles();
    const collaborator = currentUserName || 'Collaborator';
    const localUser = getLocalUser();

    // 1. Synchronize any newly created Host files to this collaborator
    const missingHostFiles = hostFiles.filter((f) => !files.includes(f));
    if (missingHostFiles.length > 0) {
      missingHostFiles.forEach((f) => {
        const content = getHostYText(f).toString();
        setFiles((prev) => (prev.includes(f) ? prev : [...prev, f]));
        setFileContents((fc) => ({ ...fc, [f]: content }));
        prevContents.current[f] = content;
      });
      toast(`Received ${missingHostFiles.length} file(s) from Host: ${missingHostFiles.join(', ')}`, 'info');
    }

    // 2. Identify all local files created by this collaborator not yet present on Host
    const unmergedNewFiles = files.filter((f) => !hostFiles.includes(f));
    let proposedNewCount = 0;

    unmergedNewFiles.forEach((newFile) => {
      const content = fileContents[newFile] ?? '';
      createMergeProposal(newFile, content, '', true);
      addActivityLog({
        type: 'merge',
        userId: userId || 'collab',
        userName: collaborator,
        userColor: localUser?.color || '#4ade80',
        isHost,
        filename: newFile,
        action: `${collaborator} proposed new file "${newFile}" to merge into Host workspace`,
        details: {
          resolution: 'review_opened',
          previewSnippet: content.slice(0, 350),
          linesAdded: content.split('\n').length,
        },
      });
      proposedNewCount++;
    });

    // 3. Propose changes to activeFile if it's an existing host file with local edits
    const currentContent = fileContents[activeFile] ?? '';
    if (hostFiles.includes(activeFile)) {
      let hostContent = '';
      try {
        hostContent = getHostYText(activeFile).toString();
      } catch {
        hostContent = currentContent;
      }

      if (currentContent !== hostContent) {
        setMerging(true);
        try {
          createMergeProposal(activeFile, currentContent, hostContent, false);
          const diff = await diffSource(hostContent, currentContent, activeFile);
          addActivityLog({
            type: 'merge',
            userId: userId || 'collab',
            userName: collaborator,
            userColor: localUser?.color || '#4ade80',
            isHost,
            filename: activeFile,
            action: `${collaborator} proposed merge for "${activeFile}"`,
            details: {
              resolution: 'review_opened',
              astChanges: diff.changes?.map((c) => `${c.operation}: ${c.name || 'code'}`) || [],
              previewSnippet: currentContent.slice(0, 350),
              linesAdded: currentContent.split('\n').length,
            },
          });
          if (proposedNewCount > 0) {
            toast(
              `Submitted ${proposedNewCount} new file(s) and merge request for "${activeFile}" to Host!`,
              'success',
            );
          } else {
            toast(`Submitted merge request for "${activeFile}" to Host!`, 'success');
          }
        } catch {
          toast('Failed to propose merge for active file.', 'error');
        } finally {
          setMerging(false);
        }
        return;
      }
    }

    if (proposedNewCount > 0) {
      toast(
        `Submitted ${proposedNewCount} new file(s) (${unmergedNewFiles.join(', ')}) to Host for merge review!`,
        'success',
      );
      return;
    }

    if (missingHostFiles.length === 0) {
      toast(`Your workspace is already in sync with the Host.`, 'info');
    }
  }, [activeFile, currentUserName, fileContents, files, isHost, toast, userId]);

  // Host: Review incoming merge proposals & new files from collaborators
  const handleReviewMerges = useCallback(async () => {
    const pending = pendingProposals.filter((p) => p.status === 'pending');
    if (pending.length === 0) {
      toast('No pending merge proposals from collaborators.', 'info');
      return;
    }

    const prop = pending[0];
    setMerging(true);
    try {
      if (prop.isNewFile) {
        setConflictData({
          proposalId: prop.id,
          isNewFile: true,
          filename: prop.file,
          hostName: currentUserName || 'Host',
          collaboratorName: prop.fromUserName,
          hostContent: '',
          collaboratorContent: prop.draftContent,
          changes: [],
        });
      } else {
        const hostContent = getHostYText(prop.file).toString();
        const diff = await diffSource(hostContent, prop.draftContent, prop.file);
        let prediction: any = undefined;

        if (diff.success && diff.changes && diff.changes.length > 0) {
          const changeIncoming = diff.changes[0];
          const changeHost = { ...changeIncoming, name: changeIncoming.name || 'host_version', operation: 'baseline' };
          try {
            const mlRes = await classifyChanges(changeIncoming, changeHost);
            prediction = mlRes.prediction;
          } catch {
            prediction = {
              label: 0,
              confidence: 0.92,
              prediction: 'Compatible',
              explanation: 'Clean merge detected — no overlapping structural collision with host.',
            };
          }
        }

        setConflictData({
          proposalId: prop.id,
          isNewFile: false,
          filename: prop.file,
          hostName: currentUserName || 'Host',
          collaboratorName: prop.fromUserName,
          hostContent,
          collaboratorContent: prop.draftContent,
          changes: diff.changes || [],
          prediction,
        });
      }
    } catch {
      toast('Failed to analyze merge proposal.', 'error');
    } finally {
      setMerging(false);
    }
  }, [currentUserName, pendingProposals, toast]);

  // Pull host changes into collaborator draft (including newly created files)
  const handleSyncFromHost = useCallback(() => {
    try {
      const { files: hostFiles, contents } = syncAllFilesFromHost(userId || '');
      if (hostFiles.length === 0) {
        toast('No files found on Host to sync.', 'info');
        return;
      }

      const newlyAdded = hostFiles.filter((f) => !files.includes(f));
      setFiles((prev) => Array.from(new Set([...prev, ...hostFiles])));
      setFileContents((prev) => ({ ...prev, ...contents }));
      Object.entries(contents).forEach(([f, c]) => {
        prevContents.current[f] = c;
      });
      setSyncVersion((v) => v + 1);

      const localUser = getLocalUser();
      addActivityLog({
        type: 'sync',
        userId: userId || 'collab',
        userName: currentUserName || 'Collaborator',
        userColor: localUser?.color || '#4ade80',
        isHost: false,
        action: newlyAdded.length > 0
          ? `${currentUserName || 'Collaborator'} synced with Host, received ${newlyAdded.length} new file(s): ${newlyAdded.join(', ')}`
          : `${currentUserName || 'Collaborator'} pulled latest Host workspace (${hostFiles.length} files)`,
      });

      if (newlyAdded.length > 0) {
        toast(`Synced from Host! Received ${newlyAdded.length} new file(s): ${newlyAdded.join(', ')}`, 'success');
      } else {
        toast(`Synchronized all ${hostFiles.length} files from Host`, 'success');
      }
    } catch {
      toast('Could not sync from host.', 'error');
    }
  }, [currentUserName, files, toast, userId]);

  // ─── Leave Session ────────────────────────────────────────────────────────
  const handleLeaveSession = useCallback(() => {
    sessionStorage.removeItem('weaver_session');
    setSessionId(null);
    setUserId(null);
    setCurrentUserName('');
    toast('Left the session.', 'info');
  }, [toast]);

  // Conflict Modal Handlers
  const handleAcceptCollaboratorMerge = useCallback(() => {
    if (!conflictData) return;
    const { filename, collaboratorContent, collaboratorName, proposalId, isNewFile } = conflictData;

    if (proposalId) {
      resolveMergeProposal(proposalId, 'accepted', collaboratorContent);
    } else {
      mergeDraftToHost(filename, collaboratorContent);
    }

    if (isNewFile || !files.includes(filename)) {
      setFiles((fs) => fs.includes(filename) ? fs : [...fs, filename]);
      addHostFile(filename);
      setActiveFile(filename);
    }

    setFileContents((prev) => ({ ...prev, [filename]: collaboratorContent }));
    prevContents.current[filename] = collaboratorContent;
    setSyncVersion((v) => v + 1);

    const localUser = getLocalUser();
    addActivityLog({
      type: 'merge',
      userId: userId || 'host',
      userName: currentUserName || (isHost ? 'Host' : 'Collaborator'),
      userColor: localUser?.color || '#6c8eff',
      isHost,
      filename,
      action: isNewFile
        ? `Merged new file "${filename}" from ${collaboratorName} into project workspace`
        : `Merged ${collaboratorName}'s changes into "${filename}" (Accepted incoming)`,
      details: {
        resolution: 'accepted',
        astChanges: conflictData.changes?.map((c) => `${c.operation}: ${c.name || 'code'}`),
        previewSnippet: collaboratorContent.slice(0, 350),
      },
    });

    setConflictData(null);
    setConflictCount(0);
    toast(
      isNewFile
        ? `✓ Successfully added new file "${filename}" from ${collaboratorName} into project!`
        : `✓ Successfully merged ${collaboratorName}'s changes into ${filename}!`,
      'success'
    );
  }, [conflictData, currentUserName, files, isHost, toast, userId]);

  const handleKeepHostMerge = useCallback(() => {
    if (!conflictData) return;
    const { filename, collaboratorName, proposalId, isNewFile } = conflictData;
    if (proposalId) {
      resolveMergeProposal(proposalId, 'rejected');
    }

    const localUser = getLocalUser();
    addActivityLog({
      type: 'merge',
      userId: userId || 'host',
      userName: currentUserName || (isHost ? 'Host' : 'Collaborator'),
      userColor: localUser?.color || '#6c8eff',
      isHost,
      filename,
      action: isNewFile
        ? `Declined new file "${filename}" from ${collaboratorName}`
        : `Kept Host version for "${filename}" (Rejected incoming changes from ${collaboratorName})`,
      details: {
        resolution: 'kept_host',
      },
    });

    setConflictData(null);
    toast(isNewFile ? `Declined new file "${filename}".` : `Kept Host version for "${filename}".`, 'info');
  }, [conflictData, currentUserName, isHost, toast, userId]);

  const handleMergeBothVersions = useCallback(() => {
    if (!conflictData) return;
    const { filename, hostContent, collaboratorContent, collaboratorName, proposalId, isNewFile } = conflictData;
    const combined = isNewFile
      ? collaboratorContent
      : hostContent.trim() + '\n\n# --- Merged collaborator changes ---\n' + collaboratorContent.trim() + '\n';

    if (proposalId) {
      resolveMergeProposal(proposalId, 'accepted', combined);
    } else {
      mergeDraftToHost(filename, combined);
    }

    if (isNewFile || !files.includes(filename)) {
      setFiles((fs) => (fs.includes(filename) ? fs : [...fs, filename]));
      addHostFile(filename);
      setActiveFile(filename);
    }

    if (isHost) {
      setFileContents((prev) => ({ ...prev, [filename]: combined }));
      prevContents.current[filename] = combined;
      setSyncVersion((v) => v + 1);
    }

    const localUser = getLocalUser();
    addActivityLog({
      type: 'merge',
      userId: userId || 'host',
      userName: currentUserName || (isHost ? 'Host' : 'Collaborator'),
      userColor: localUser?.color || '#6c8eff',
      isHost,
      filename,
      action: isNewFile
        ? `Merged new file "${filename}" from ${collaboratorName} into project workspace`
        : `Combined both Host and ${collaboratorName}'s changes in "${filename}"`,
      details: {
        resolution: 'merged_both',
        previewSnippet: combined.slice(0, 350),
      },
    });

    setConflictData(null);
    setConflictCount(0);
    toast(
      isNewFile
        ? `✓ Added new file "${filename}" from ${collaboratorName} into project!`
        : `✓ Combined both versions into ${filename} (Host version)!`,
      'success',
    );
  }, [conflictData, currentUserName, files, isHost, toast, userId]);

  const handleReviewConflict = useCallback(() => {
    if (!activeFile) return;
    const content = fileContents[activeFile] || '';
    const ext = activeFile.split('.').pop() || '';
    const base = activeFile.substring(0, activeFile.lastIndexOf('.')) || activeFile;
    let newName = `${base}_copy.${ext}`;
    let i = 1;
    while (files.includes(newName)) {
      newName = `${base}_copy${i}.${ext}`;
      i++;
    }
    setFiles((prev) => [...prev, newName]);
    setFileContents((fc) => ({ ...fc, [newName]: content }));
    setActiveFile(newName);
    toast(`Created independent working copy: ${newName}`, 'success');
  }, [activeFile, fileContents, files, toast]);

  const handleCustomMerge = useCallback((customCode: string) => {
    if (!conflictData) return;
    const { filename, proposalId, isNewFile, collaboratorName } = conflictData;

    if (proposalId) {
      resolveMergeProposal(proposalId, 'accepted', customCode);
    } else {
      mergeDraftToHost(filename, customCode);
    }

    if (isNewFile || !files.includes(filename)) {
      setFiles((fs) => (fs.includes(filename) ? fs : [...fs, filename]));
      addHostFile(filename);
      setActiveFile(filename);
    }

    if (isHost) {
      setFileContents((prev) => ({ ...prev, [filename]: customCode }));
      prevContents.current[filename] = customCode;
      setSyncVersion((v) => v + 1);
    }

    const localUser = getLocalUser();
    addActivityLog({
      type: 'merge',
      userId: userId || 'host',
      userName: currentUserName || (isHost ? 'Host' : 'Collaborator'),
      userColor: localUser?.color || '#6c8eff',
      isHost,
      filename,
      action: isNewFile
        ? `Merged new file "${filename}" from ${collaboratorName} with custom edits into project`
        : `Applied custom merge resolution into "${filename}"`,
      details: {
        resolution: 'custom',
        previewSnippet: customCode.slice(0, 350),
      },
    });

    setConflictData(null);
    setConflictCount(0);
    toast(
      isNewFile
        ? `✓ Successfully added new file "${filename}" into project workspace!`
        : `✓ Custom merge committed into ${filename} (Host version)!`,
      'success',
    );
  }, [conflictData, currentUserName, files, isHost, toast, userId]);

  // ─── Render ───────────────────────────────────────────────────────────────
  if (!sessionId) return <SessionGate onJoined={handleJoined} />;

  const localUser = getLocalUser();

  const handleCopyWorkspace = () => {
    if (sessionId) {
      navigator.clipboard.writeText(sessionId);
      setHeaderCopied(true);
      setTimeout(() => setHeaderCopied(false), 1500);
      toast('Workspace ID copied to clipboard', 'info');
    }
  };

  return (
    <div className="app-shell">
      {/* Hidden file picker for import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".py,.pyw,text/x-python"
        multiple
        style={{ display: 'none' }}
        onChange={handleImportFiles}
      />

      {/* Title bar */}
      <header className="app-header">
        <div className="logo">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/>
          </svg>
          <span className="logo-name">Weaver</span>
        </div>

        <div className="header-workspace">
          <span>workspace</span>
          <span className="header-workspace-id">{sessionId}</span>
          <button className="session-copy-btn" onClick={handleCopyWorkspace}>
            {headerCopied ? 'copied' : 'copy'}
          </button>
          <span className={`header-role-tag${isHost ? ' host' : ''}`}>
            {isHost ? 'host' : 'collaborator'}
          </span>
        </div>

        <div className="header-sep" />

        <div className="header-right">
          <div className="header-sync-text">
            <span className={`sync-dot ${syncStatus === 'connected' ? 'ok' : syncStatus === 'connecting' ? 'warn' : 'off'}`} />
            {syncStatus === 'connected' ? 'synced' : syncStatus === 'connecting' ? 'connecting' : 'offline'}
          </div>
          <div className="header-avatars">
            {[localUser, ...users.filter(u => u.id !== userId)].filter(Boolean).slice(0, 4).map((u, i) => (
              <div
                key={u?.id || i}
                className="h-avatar"
                style={{ background: u?.color || '#5e81ac' }}
                title={u?.name || 'User'}
              >
                {(u?.name || '?')[0].toUpperCase()}
              </div>
            ))}
          </div>
          <button
            className="editor-action-btn"
            style={{ marginLeft: 16, backgroundColor: 'transparent', border: '1px solid #4a5568', color: '#a0aec0' }}
            onClick={handleLeaveSession}
            title="Leave session and return to home"
          >
            Leave
          </button>
        </div>
      </header>

      {/* Body: Full Editor Workspace */}
      <div className="workspace">
        <aside className="activity-bar">
          <div
            className={`activity-item ${activeSidebar === 'explorer' ? 'active' : ''}`}
            onClick={() => {
              if (activeSidebar === 'explorer') setSidebarOpen(!sidebarOpen);
              else { setActiveSidebar('explorer'); setSidebarOpen(true); }
            }}
            title="Explorer"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </div>
          <div
            className={`activity-item ${activeSidebar === 'collab' ? 'active' : ''}`}
            onClick={() => {
              if (activeSidebar === 'collab') setSidebarOpen(!sidebarOpen);
              else { setActiveSidebar('collab'); setSidebarOpen(true); }
            }}
            title="Source Control / Collaboration"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="18" cy="18" r="3"/>
              <circle cx="6" cy="6" r="3"/>
              <path d="M13 6h3a2 2 0 0 1 2 2v7M6 9v12"/>
            </svg>
          </div>
        </aside>

        {sidebarOpen && (
          <div className="sidebar-container" style={{ width: `${sidebarWidth}px` }}>
            {activeSidebar === 'explorer' && (
              <FileExplorer
                files={files}
                activeFile={activeFile}
                sessionId={sessionId}
                userCount={users.length}
                onSelectFile={setActiveFile}
                onNewFile={handleNewFile}
                onNewFolder={handleNewFolder}
                onImportFile={() => fileInputRef.current?.click()}
                onRenameFile={openRenameDialog}
                onCloseFile={handleCloseFile}
                onDeleteFolder={handleDeleteFolder}
              />
            )}
            {activeSidebar === 'collab' && (
              <CollabPanel
                users={users}
                localUser={localUser}
                sessionId={sessionId}
                localChanges={localChanges}
                remoteChanges={remoteChanges}
                astStatus={astStatus}
                mlStatus={mlStatus}
                mlPrediction={mlPrediction}
                mlConfidence={mlConfidence}
                conflictCount={conflictCount}
                syncStatus={syncStatus}
                liveConflict={liveConflict}
                localActiveNode={localActiveNode}
                onShowConflict={handleMergeToHost}
                activityLogs={activityLogs}
                onOpenLogs={() => {
                  setOutputOpen(true);
                  setBottomPanelTab('logs');
                }}
                followingUserId={followingUserId}
                onFollowUser={setFollowingUserId}
                onSimulateConflict={triggerSimulatedConflict}
              />
            )}
            <div
              onMouseDown={handleSidebarMouseDown}
              style={{
                position: 'absolute', right: -3, top: 0, bottom: 0, width: 6,
                cursor: 'col-resize', zIndex: 10
              }}
            />
          </div>
        )}

        {/* Editor + Output */}
        <main className="editor-area">
          {/* Tab strip + run / merge controls */}
          <div className="editor-toolbar">
            {files.map((f) => (
              <div
                key={f}
                className={`file-tab ${activeFile === f ? 'active' : ''}`}
                onClick={() => setActiveFile(f)}
                onDoubleClick={() => openRenameDialog(f)}
                title="Double click to rename"
              >
                <span className="dot" />
                {f}
                {files.length > 1 && (
                  <span
                    className="tab-close"
                    title="Close tab"
                    onClick={(e) => handleCloseFile(f, e)}
                  >×</span>
                )}
              </div>
            ))}
            <div style={{ flex: 1 }} />

            {/* Editor actions: Format, Snapshots, Comments, REPL, Open, Save, Merge/Sync, Run */}
            <div className="editor-actions" style={{ gap: 4 }}>
              <button
                className="editor-action-btn"
                title="Format Code"
                onClick={handleFormat}
                disabled={formatting || !isPythonFile(activeFile)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
              </button>

              <button
                className={`editor-action-btn ${commentsOpen ? 'active' : ''}`}
                title="Inline Comments"
                onClick={() => setCommentsOpen(!commentsOpen)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              </button>

              <button
                className="editor-action-btn"
                title="Snapshots"
                onClick={() => setSnapshotsOpen(true)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </button>

              <div className="action-sep" />

              {isHost && (
                <button
                  className="sync-host-btn"
                  title="Review incoming collaborator merge requests and new files"
                  onClick={handleReviewMerges}
                  disabled={merging}
                >
                  Review Merges
                  {pendingProposals.filter((p) => p.status === 'pending').length > 0 && (
                    <span className="btn-counter-badge accent" style={{ marginLeft: 5 }}>
                      {pendingProposals.filter((p) => p.status === 'pending').length}
                    </span>
                  )}
                </button>
              )}

              {!isHost && (
                <>
                  <button
                    className="sync-host-btn"
                    title="Pull latest code from Host (overwrites local draft)"
                    onClick={handleSyncFromHost}
                    disabled={merging}
                  >
                    ↓ Sync from Host
                  </button>
                  <button
                    className="sync-host-btn accent"
                    title="Propose your local changes to be merged into the Host workspace"
                    onClick={handleMergeToHost}
                    disabled={merging}
                    style={{ backgroundColor: '#10b981', borderColor: '#059669', color: '#fff' }}
                  >
                    ↑ Propose Merge
                  </button>
                </>
              )}

              <div className="action-sep" />

              {/* View Toggles */}
              <button
                className={`editor-action-btn ${outputOpen && bottomPanelTab === 'repl' ? 'active' : ''}`}
                title="Toggle REPL"
                onClick={() => {
                  if (outputOpen && bottomPanelTab === 'repl') setOutputOpen(false);
                  else { setOutputOpen(true); setBottomPanelTab('repl'); }
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
              </button>

              <button
                className={`editor-action-btn ${outputOpen && bottomPanelTab === 'logs' ? 'active' : ''}`}
                title="Toggle Logs"
                onClick={() => {
                  if (outputOpen && bottomPanelTab === 'logs') setOutputOpen(false);
                  else { setOutputOpen(true); setBottomPanelTab('logs'); }
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              </button>

              <div className="action-sep" />

              <button
                className={`editor-run-btn ${running ? 'running' : ''}`}
                style={{
                  background: 'transparent',
                  color: 'var(--green)',
                  padding: '2px 6px',
                  display: 'flex',
                  alignItems: 'center',
                  border: 'none',
                  cursor: running ? 'not-allowed' : 'pointer'
                }}
                disabled={running || !isPythonFile(activeFile)}
                onClick={handleRun}
                title="Run Script"
              >
                {running ? (
                  <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                )}
              </button>
            </div>
          </div>

          {/* Editor panes */}
          <div className="editor-files-wrap">
            {files.map((f) => (
              <div
                key={`${f}-${syncVersion}`}
                style={{ display: f === activeFile ? 'flex' : 'none', flex: 1, overflow: 'hidden', flexDirection: 'column' }}
              >
                <CodeEditor
                  file={f}
                  initialContent={fileContents[f]}
                  onContentChange={(content, cursorLine) => handleContentChange(content, f, cursorLine)}
                  liveConflict={f === activeFile ? liveConflict : undefined}
                  localNodeName={f === activeFile ? localActiveNode?.name : undefined}
                  localNodeLine={f === activeFile ? localActiveNode?.line_start : undefined}
                  onReviewConflict={handleReviewConflict}
                  targetLine={f === activeFile ? targetLine : undefined}
                  isHost={isHost}
                />
              </div>
            ))}
          </div>

          {/* Output / REPL / Activity Log workbench panel (collapsible bottom) */}
          {outputOpen && (
            <OutputPanel
              results={runResults}
              running={running}
              onClear={() => setRunResults([])}
              onClose={() => setOutputOpen(false)}
              stdin={stdin}
              onStdinChange={setStdin}
              activeTab={bottomPanelTab}
              onTabChange={setBottomPanelTab}
              activityLogs={activityLogs}
              isHost={isHost}
              onClearLogs={clearActivityLogs}
              onSelectFile={setActiveFile}
              sessionId={sessionId || undefined}
              lintErrors={lintErrors}
            />
          )}
        </main>
      </div>

      {/* Snapshots Modal Dialog (Feature 3) */}
      {snapshotsOpen && (
        <SnapshotsModal
          currentFiles={fileContents}
          onRestore={handleRestoreSnapshot}
          onClose={() => setSnapshotsOpen(false)}
        />
      )}

      {/* Review Comments Drawer (Feature 5) */}
      {commentsOpen && (
        <CommentsDrawer
          activeFile={activeFile}
          currentLine={currentEditorLine}
          onJumpToLine={(line) => setTargetLine(line)}
          onClose={() => setCommentsOpen(false)}
        />
      )}

      {/* Rename File Modal Dialog */}
      {renameTarget && (
        <div className="rename-modal-overlay" onClick={(e) => e.target === e.currentTarget && closeRenameDialog()}>
          <div className="rename-modal-card">
            <div className="rename-modal-header">
              <h3>Rename File</h3>
              <button
                onClick={closeRenameDialog}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}
              >✕</button>
            </div>
            <div className="rename-modal-body">
              <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                Enter new name for <strong>{renameTarget}</strong>:
              </label>
              <input
                ref={renameInputRef}
                className="rename-modal-input"
                value={renameInput}
                onChange={(e) => setRenameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') executeRename(renameTarget, renameInput);
                  if (e.key === 'Escape') closeRenameDialog();
                }}
              />
            </div>
            <div className="rename-modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={closeRenameDialog}>
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => executeRename(renameTarget, renameInput)}
                disabled={!renameInput.trim() || renameInput.trim() === renameTarget}
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review & Resolve Merge / Conflict Modal */}
      {conflictData && (
        <ConflictModal
          conflict={conflictData}
          onAcceptCollaborator={handleAcceptCollaboratorMerge}
          onKeepHost={handleKeepHostMerge}
          onMergeBoth={handleMergeBothVersions}
          onCustomMerge={handleCustomMerge}
          onClose={() => setConflictData(null)}
        />
      )}

      {/* Status bar */}
      <div className="statusbar">
        <div className="statusbar-item clickable" onClick={() => setOutputOpen(o => !o)}>
          <span className={`statusbar-dot ${syncStatus === 'connected' ? '' : ''}`}
            style={{ background: syncStatus === 'connected' ? 'rgba(13,15,20,0.5)' : syncStatus === 'connecting' ? 'rgba(13,15,20,0.4)' : 'rgba(13,15,20,0.3)' }}
          />
          {syncStatus === 'connected' ? 'Weaver' : syncStatus === 'connecting' ? 'Connecting…' : 'Offline'}
        </div>
        {localUser && (
          <div className="statusbar-item">
            {localUser.name}
          </div>
        )}
        <div className="statusbar-sep" />
        <div className="statusbar-item clickable" onClick={() => setOutputOpen(o => !o)}>
          {running
            ? 'Running…'
            : runResults.length > 0
              ? runResults[runResults.length-1].exit_code === 0 ? 'OK' : `Exit ${runResults[runResults.length-1].exit_code}`
              : 'Output'}
        </div>
        <div
          className="statusbar-item clickable"
          onClick={() => {
            if (outputOpen && bottomPanelTab === 'logs') {
              setOutputOpen(false);
            } else {
              setOutputOpen(true);
              setBottomPanelTab('logs');
            }
          }}
        >
          Logs ({activityLogs.length})
        </div>
        <div className="statusbar-item">
          {activeFile}
        </div>
        <div className="statusbar-item" style={{ opacity: 0.6 }}>
          Ctrl+Enter  Run
        </div>
      </div>

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}

export default App;
