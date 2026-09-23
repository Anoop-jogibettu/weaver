// Weaver Collaboration Store — manages Yjs CRDT state and session
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';

export interface UserInfo {
  id: string;
  name: string;
  color: string;
  isHost?: boolean;
}

export interface ChangeRecord {
  userId: string;
  opId: string;
  timestamp: number;
  file: string;
  operation: string;
  affectedText: string;
  fromLine: number;
  toLine: number;
  docVersion: number;
}

export interface ActiveNodeInfo {
  node_type: string;
  name: string;
  line_start: number;
  line_end: number;
  operation: string;
}

export interface PeerEditState {
  user: UserInfo;
  activeFile: string;
  activeLine: number;
  activeNode: ActiveNodeInfo | null;
  editing: boolean;
  lastEditTime: number;
}

export type ActivityLogType = 'merge' | 'sync' | 'conflict' | 'file' | 'presence' | 'edit';

export interface ActivityLogDetails {
  resolution?: 'accepted' | 'kept_host' | 'merged_both' | 'custom' | string;
  linesAdded?: number;
  linesRemoved?: number;
  astChanges?: string[];
  previewSnippet?: string;
  oldName?: string;
  newName?: string;
  target?: string;
}

export interface ActivityLogItem {
  id: string;
  timestamp: number;
  type: ActivityLogType;
  userId: string;
  userName: string;
  userColor: string;
  isHost?: boolean;
  filename?: string;
  action: string;
  details?: ActivityLogDetails;
}

export interface SnapshotItem {
  id: string;
  timestamp: number;
  name: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  files: Record<string, string>;
  description?: string;
}

export interface CommentReply {
  id: string;
  timestamp: number;
  authorId: string;
  authorName: string;
  authorColor: string;
  text: string;
}

export interface CodeComment {
  id: string;
  file: string;
  line: number;
  timestamp: number;
  authorId: string;
  authorName: string;
  authorColor: string;
  text: string;
  resolved: boolean;
  replies?: CommentReply[];
}

export interface MergeProposal {
  id: string;
  file: string;
  fromUserId: string;
  fromUserName: string;
  fromUserColor: string;
  draftContent: string;
  hostContent: string;
  timestamp: number;
  status: 'pending' | 'accepted' | 'rejected';
  isNewFile?: boolean;
}

const USER_COLORS = ['#6c8eff', '#4ade80', '#f87171', '#fbbf24', '#a78bfa', '#22d3ee'];
const DEFAULT_NAMES = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank'];

let _ydoc: Y.Doc | null = null;
let _provider: WebsocketProvider | null = null;
let _persistence: IndexeddbPersistence | null = null;
let _localUser: UserInfo | null = null;
let _activityArray: Y.Array<ActivityLogItem> | null = null;
const _activitySubscribers: Set<(logs: ActivityLogItem[]) => void> = new Set();
let _snapshotArray: Y.Array<SnapshotItem> | null = null;
const _snapshotSubscribers: Set<(snapshots: SnapshotItem[]) => void> = new Set();
let _commentArray: Y.Array<CodeComment> | null = null;
const _commentSubscribers: Set<(comments: CodeComment[]) => void> = new Set();
let _hostFilesArray: Y.Array<string> | null = null;
const _hostFilesSubscribers: Set<(files: string[]) => void> = new Set();
let _proposalsArray: Y.Array<MergeProposal> | null = null;
const _proposalsSubscribers: Set<(proposals: MergeProposal[]) => void> = new Set();
let _pendingChanges: ChangeRecord[] = [];
let _opCounter = 0;

export function initCollaboration(
  sessionId: string,
  userId: string,
  customName?: string,
  isHost = false,
): {
  ydoc: Y.Doc;
  provider: WebsocketProvider;
  localUser: UserInfo;
} {
  // Clean up any existing session
  destroy();

  const hash = Math.abs(
    userId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  );
  const colorIndex = hash % USER_COLORS.length;
  const nameIndex = hash % DEFAULT_NAMES.length;

  const displayName = customName?.trim() || DEFAULT_NAMES[nameIndex] || 'Collaborator';

  _localUser = {
    id: userId,
    name: displayName,
    color: USER_COLORS[colorIndex] || '#6c8eff',
    isHost,
  };

  _ydoc = new Y.Doc();

  // y-websocket connection to relay server
  const wsUrl = 'ws://localhost:1234';
  _provider = new WebsocketProvider(wsUrl, `weaver-${sessionId}`, _ydoc, {
    connect: true,
  });

  // Set awareness (presence)
  _provider.awareness.setLocalStateField('user', _localUser);

  // Shared activity and merge log CRDT array
  _activityArray = _ydoc.getArray<ActivityLogItem>('weaver_activity_logs');
  _activityArray.observe(() => {
    const logs = _activityArray ? _activityArray.toArray() : [];
    _activitySubscribers.forEach((cb) => {
      try {
        cb(logs);
      } catch (err) {
        console.error('Error in activity log subscriber', err);
      }
    });
  });

  // Shared snapshots CRDT array
  _snapshotArray = _ydoc.getArray<SnapshotItem>('weaver_snapshots');
  _snapshotArray.observe(() => {
    const list = _snapshotArray ? _snapshotArray.toArray() : [];
    _snapshotSubscribers.forEach((cb) => {
      try { cb(list); } catch (err) { console.error('Snapshot subscriber error', err); }
    });
  });

  // Shared comments CRDT array
  _commentArray = _ydoc.getArray<CodeComment>('weaver_comments');
  _commentArray.observe(() => {
    const list = _commentArray ? _commentArray.toArray() : [];
    _commentSubscribers.forEach((cb) => {
      try { cb(list); } catch (err) { console.error('Comment subscriber error', err); }
    });
  });

  // Shared canonical host files CRDT array
  _hostFilesArray = _ydoc.getArray<string>('weaver_host_files');
  _hostFilesArray.observe(() => {
    const list = _hostFilesArray ? _hostFilesArray.toArray() : [];
    _hostFilesSubscribers.forEach((cb) => {
      try { cb(list); } catch (err) { console.error('Host files subscriber error', err); }
    });
  });

  // Shared merge proposals CRDT array
  _proposalsArray = _ydoc.getArray<MergeProposal>('weaver_merge_proposals');
  _proposalsArray.observe(() => {
    const list = _proposalsArray ? _proposalsArray.toArray() : [];
    _proposalsSubscribers.forEach((cb) => {
      try { cb(list); } catch (err) { console.error('Merge proposals subscriber error', err); }
    });
  });

  // IndexedDB persistence for local-first behavior
  _persistence = new IndexeddbPersistence(`weaver-${sessionId}`, _ydoc);

  return { ydoc: _ydoc, provider: _provider, localUser: _localUser };
}

/** Get canonical host Y.Text */
export function getHostYText(file: string): Y.Text {
  if (!_ydoc) throw new Error('Collaboration not initialized');
  return _ydoc.getText(`file:${file}`);
}

/**
 * Get Y.Text for current user:
 * - If host: returns canonical `file:${file}`
 * - If collaborator: returns personal working draft `draft:${userId}:${file}`
 *   and initializes it from host content if draft is empty.
 */
export function getYTextForUser(file: string, userId: string, isHost: boolean): Y.Text {
  if (!_ydoc) throw new Error('Collaboration not initialized');
  if (isHost) {
    return _ydoc.getText(`file:${file}`);
  }

  const draftKey = `draft:${userId}:${file}`;
  const draft = _ydoc.getText(draftKey);
  const host = _ydoc.getText(`file:${file}`);

  // If collaborator's draft is empty, seed it from host
  if (draft.length === 0 && host.length > 0) {
    draft.insert(0, host.toString());
  }

  return draft;
}

/** Default getYText for the local user */
export function getYText(file: string): Y.Text {
  if (!_localUser) {
    if (!_ydoc) throw new Error('Collaboration not initialized');
    return _ydoc.getText(`file:${file}`);
  }
  return getYTextForUser(file, _localUser.id, _localUser.isHost ?? true);
}

/** Merge a collaborator's draft into the canonical Host version */
export function mergeDraftToHost(file: string, content: string): void {
  if (!_ydoc) throw new Error('Collaboration not initialized');
  const hostText = _ydoc.getText(`file:${file}`);
  _ydoc.transact(() => {
    hostText.delete(0, hostText.length);
    hostText.insert(0, content);
  });
}

/** Pull latest Host version into a collaborator's draft */
export function syncDraftFromHost(file: string, userId: string): string {
  if (!_ydoc) throw new Error('Collaboration not initialized');
  const hostText = _ydoc.getText(`file:${file}`);
  const draftText = _ydoc.getText(`draft:${userId}:${file}`);
  const content = hostText.toString();
  _ydoc.transact(() => {
    draftText.delete(0, draftText.length);
    draftText.insert(0, content);
  });
  return content;
}

export function getAwareness() {
  return _provider?.awareness ?? null;
}

export function subscribeAwareness(callback: () => void): () => void {
  if (!_provider?.awareness) return () => {};
  const handler = () => callback();
  _provider.awareness.on('change', handler);
  return () => {
    _provider?.awareness?.off('change', handler);
  };
}

export function getPeerState(userId: string): { activeFile?: string; activeLine?: number; name?: string } | null {
  if (!_provider?.awareness) return null;
  const states = _provider.awareness.getStates();
  for (const [, state] of states) {
    if (state?.user?.id === userId) {
      return {
        activeFile: state.editing?.activeFile,
        activeLine: state.editing?.activeLine,
        name: state.user?.name,
      };
    }
  }
  return null;
}

/** Broadcast local user's current active AST node via Yjs awareness */
export function broadcastActiveNode(
  file: string,
  activeLine: number,
  activeNode: ActiveNodeInfo | null,
  editing: boolean,
): void {
  if (!_provider) return;
  _provider.awareness.setLocalStateField('editing', {
    activeFile: file,
    activeLine,
    activeNode,
    editing,
    lastEditTime: Date.now(),
  });
}

/** Get all peers currently editing (excludes self) */
export function getPeerActiveEdits(): PeerEditState[] {
  if (!_provider || !_localUser) {
    return [];
  }

  const states = _provider.awareness.getStates();
  const peers: PeerEditState[] = [];

  states.forEach((state) => {
    if (!state?.user || state.user.id === _localUser!.id) return;
    if (!state.editing) return;
    // Only return peers that edited in last 8 seconds
    const editState = state.editing as PeerEditState;
    if (Date.now() - (editState.lastEditTime || 0) > 8000) return;
    peers.push({
      user: state.user as UserInfo,
      activeFile: editState.activeFile || '',
      activeLine: editState.activeLine || 0,
      activeNode: editState.activeNode || null,
      editing: editState.editing ?? false,
      lastEditTime: editState.lastEditTime || 0,
    });
  });

  return peers;
}

export function recordChange(
  file: string,
  operation: string,
  affectedText: string,
  fromLine: number,
  toLine: number,
): void {
  if (!_localUser) return;
  _pendingChanges.push({
    userId: _localUser.id,
    opId: `op-${++_opCounter}`,
    timestamp: Date.now(),
    file,
    operation,
    affectedText,
    fromLine,
    toLine,
    docVersion: _opCounter,
  });
}

export function getRecentChanges(n = 5): ChangeRecord[] {
  return _pendingChanges.slice(-n);
}

export function getConnectedUsers(): UserInfo[] {
  if (!_provider) return [];
  const states = _provider.awareness.getStates();
  const users: UserInfo[] = [];
  states.forEach((state) => {
    if (state?.user) users.push(state.user as UserInfo);
  });
  return users;
}

export function getLocalUser(): UserInfo | null {
  return _localUser;
}

export function getSyncStatus(): 'connected' | 'connecting' | 'disconnected' {
  if (!_provider) return 'disconnected';
  if (_provider.wsconnected) return 'connected';
  if (_provider.wsconnecting) return 'connecting';
  return 'disconnected';
}

export function getActivityLogs(): ActivityLogItem[] {
  if (!_activityArray) return [];
  return _activityArray.toArray();
}

export function subscribeActivityLogs(callback: (logs: ActivityLogItem[]) => void): () => void {
  _activitySubscribers.add(callback);
  if (_activityArray) {
    try {
      callback(_activityArray.toArray());
    } catch { /* ignore */ }
  }
  return () => {
    _activitySubscribers.delete(callback);
  };
}

export function addActivityLog(item: Omit<ActivityLogItem, 'id' | 'timestamp'>): ActivityLogItem | null {
  if (!_activityArray) return null;
  const entry: ActivityLogItem = {
    ...item,
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  };
  if (_ydoc) {
    _ydoc.transact(() => {
      _activityArray!.push([entry]);
    });
  } else {
    _activityArray.push([entry]);
  }
  return entry;
}

export function clearActivityLogs(): void {
  if (!_activityArray || !_ydoc) return;
  _ydoc.transact(() => {
    _activityArray!.delete(0, _activityArray!.length);
  });
}

// ─── Snapshots API ────────────────────────────────────────────────────────────
export function getSnapshots(): SnapshotItem[] {
  if (!_snapshotArray) return [];
  return _snapshotArray.toArray();
}

export function subscribeSnapshots(callback: (snapshots: SnapshotItem[]) => void): () => void {
  _snapshotSubscribers.add(callback);
  if (_snapshotArray) {
    try {
      callback(_snapshotArray.toArray());
    } catch { /* ignore */ }
  }
  return () => {
    _snapshotSubscribers.delete(callback);
  };
}

export function createSnapshot(
  name: string,
  files: Record<string, string>,
  description?: string,
): SnapshotItem | null {
  if (!_snapshotArray || !_localUser) return null;
  const item: SnapshotItem = {
    id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    name: name.trim() || `Snapshot ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    authorId: _localUser.id,
    authorName: _localUser.name,
    authorColor: _localUser.color,
    files: { ...files },
    description,
  };
  if (_ydoc) {
    _ydoc.transact(() => {
      _snapshotArray!.push([item]);
    });
  } else {
    _snapshotArray.push([item]);
  }
  return item;
}

export function deleteSnapshot(id: string): void {
  if (!_snapshotArray || !_ydoc) return;
  const arr = _snapshotArray.toArray();
  const idx = arr.findIndex((s) => s.id === id);
  if (idx !== -1) {
    _ydoc.transact(() => {
      _snapshotArray!.delete(idx, 1);
    });
  }
}

// ─── Comments API ─────────────────────────────────────────────────────────────
export function getComments(file?: string): CodeComment[] {
  if (!_commentArray) return [];
  const all = _commentArray.toArray();
  return file ? all.filter((c) => c.file === file) : all;
}

export function subscribeComments(callback: (comments: CodeComment[]) => void): () => void {
  _commentSubscribers.add(callback);
  if (_commentArray) {
    try {
      callback(_commentArray.toArray());
    } catch { /* ignore */ }
  }
  return () => {
    _commentSubscribers.delete(callback);
  };
}

export function addComment(file: string, line: number, text: string): CodeComment | null {
  if (!_commentArray || !_localUser || !text.trim()) return null;
  const comment: CodeComment = {
    id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    file,
    line,
    timestamp: Date.now(),
    authorId: _localUser.id,
    authorName: _localUser.name,
    authorColor: _localUser.color,
    text: text.trim(),
    resolved: false,
    replies: [],
  };
  if (_ydoc) {
    _ydoc.transact(() => {
      _commentArray!.push([comment]);
    });
  } else {
    _commentArray.push([comment]);
  }
  return comment;
}

export function replyComment(commentId: string, text: string): void {
  if (!_commentArray || !_ydoc || !_localUser || !text.trim()) return;
  const arr = _commentArray.toArray();
  const idx = arr.findIndex((c) => c.id === commentId);
  if (idx === -1) return;
  const current = arr[idx];
  const reply: CommentReply = {
    id: `reply-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    authorId: _localUser.id,
    authorName: _localUser.name,
    authorColor: _localUser.color,
    text: text.trim(),
  };
  const updated: CodeComment = {
    ...current,
    replies: [...(current.replies || []), reply],
  };
  _ydoc.transact(() => {
    _commentArray!.delete(idx, 1);
    _commentArray!.insert(idx, [updated]);
  });
}

export function resolveComment(commentId: string, resolved = true): void {
  if (!_commentArray || !_ydoc) return;
  const arr = _commentArray.toArray();
  const idx = arr.findIndex((c) => c.id === commentId);
  if (idx === -1) return;
  const current = arr[idx];
  const updated: CodeComment = { ...current, resolved };
  _ydoc.transact(() => {
    _commentArray!.delete(idx, 1);
    _commentArray!.insert(idx, [updated]);
  });
}

export function deleteComment(commentId: string): void {
  if (!_commentArray || !_ydoc) return;
  const arr = _commentArray.toArray();
  const idx = arr.findIndex((c) => c.id === commentId);
  if (idx !== -1) {
    _ydoc.transact(() => {
      _commentArray!.delete(idx, 1);
    });
  }
}

// ─── Host Canonical Files API ────────────────────────────────────────────────
export function getHostFiles(): string[] {
  if (!_hostFilesArray) return [];
  return _hostFilesArray.toArray();
}

export function subscribeHostFiles(callback: (files: string[]) => void): () => void {
  _hostFilesSubscribers.add(callback);
  if (_hostFilesArray) {
    try { callback(_hostFilesArray.toArray()); } catch { /* ignore */ }
  }
  return () => {
    _hostFilesSubscribers.delete(callback);
  };
}

export function addHostFile(filename: string): void {
  if (!_hostFilesArray || !_ydoc) return;
  const current = _hostFilesArray.toArray();
  if (!current.includes(filename)) {
    _ydoc.transact(() => {
      _hostFilesArray!.push([filename]);
    });
  }
}

export function removeHostFile(filename: string): void {
  if (!_hostFilesArray || !_ydoc) return;
  const current = _hostFilesArray.toArray();
  const idx = current.indexOf(filename);
  if (idx !== -1) {
    _ydoc.transact(() => {
      _hostFilesArray!.delete(idx, 1);
    });
  }
}

export function renameHostFile(oldName: string, newName: string): void {
  if (!_hostFilesArray || !_ydoc) return;
  const current = _hostFilesArray.toArray();
  const idx = current.indexOf(oldName);
  if (idx !== -1) {
    _ydoc.transact(() => {
      _hostFilesArray!.delete(idx, 1);
      _hostFilesArray!.insert(idx, [newName]);
      const oldText = _ydoc!.getText(`file:${oldName}`);
      const newText = _ydoc!.getText(`file:${newName}`);
      if (newText.length === 0 && oldText.length > 0) {
        newText.insert(0, oldText.toString());
      }
    });
  }
}

export function initHostFiles(defaultFiles: string[]): void {
  if (!_hostFilesArray || !_ydoc) return;
  if (_hostFilesArray.length === 0) {
    _ydoc.transact(() => {
      _hostFilesArray!.push(defaultFiles);
    });
  }
}

export function syncAllFilesFromHost(userId: string): { files: string[]; contents: Record<string, string> } {
  if (!_ydoc || !_hostFilesArray) return { files: [], contents: {} };
  const files = _hostFilesArray.toArray();
  const contents: Record<string, string> = {};

  _ydoc.transact(() => {
    files.forEach((file) => {
      const hostText = _ydoc!.getText(`file:${file}`);
      const draftText = _ydoc!.getText(`draft:${userId}:${file}`);
      const val = hostText.toString();
      contents[file] = val;
      draftText.delete(0, draftText.length);
      draftText.insert(0, val);
    });
  });

  return { files, contents };
}

// ─── Merge Proposals API ──────────────────────────────────────────────────────
export function getMergeProposals(): MergeProposal[] {
  if (!_proposalsArray) return [];
  return _proposalsArray.toArray();
}

export function subscribeMergeProposals(callback: (proposals: MergeProposal[]) => void): () => void {
  _proposalsSubscribers.add(callback);
  if (_proposalsArray) {
    try { callback(_proposalsArray.toArray()); } catch { /* ignore */ }
  }
  return () => {
    _proposalsSubscribers.delete(callback);
  };
}

export function createMergeProposal(
  file: string,
  draftContent: string,
  hostContent = '',
  isNewFile = false,
): MergeProposal | null {
  if (!_proposalsArray || !_ydoc || !_localUser) return null;
  const currentProps = _proposalsArray.toArray();
  const existingPendingIdx = currentProps.findIndex(
    (p) => p.file === file && p.fromUserId === _localUser!.id && p.status === 'pending'
  );
  if (existingPendingIdx !== -1) {
    const existing = currentProps[existingPendingIdx];
    const updated: MergeProposal = {
      ...existing,
      draftContent,
      hostContent,
      timestamp: Date.now(),
      isNewFile: isNewFile || existing.isNewFile,
    };
    _ydoc.transact(() => {
      _proposalsArray!.delete(existingPendingIdx, 1);
      _proposalsArray!.insert(existingPendingIdx, [updated]);
    });
    return updated;
  }

  const proposal: MergeProposal = {
    id: `prop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    file,
    fromUserId: _localUser.id,
    fromUserName: _localUser.name,
    fromUserColor: _localUser.color,
    draftContent,
    hostContent,
    timestamp: Date.now(),
    status: 'pending',
    isNewFile,
  };
  _ydoc.transact(() => {
    _proposalsArray!.push([proposal]);
  });
  return proposal;
}

export function resolveMergeProposal(
  proposalId: string,
  status: 'accepted' | 'rejected',
  resolvedContent?: string,
): void {
  if (!_proposalsArray || !_ydoc) return;
  const arr = _proposalsArray.toArray();
  const idx = arr.findIndex((p) => p.id === proposalId);
  if (idx === -1) return;
  const current = arr[idx];
  const updated: MergeProposal = {
    ...current,
    status,
  };

  _ydoc.transact(() => {
    _proposalsArray!.delete(idx, 1);
    _proposalsArray!.insert(idx, [updated]);

    if (status === 'accepted') {
      const contentToApply = resolvedContent !== undefined ? resolvedContent : current.draftContent;
      // 1. Write to canonical Host version
      const hostText = _ydoc!.getText(`file:${current.file}`);
      hostText.delete(0, hostText.length);
      hostText.insert(0, contentToApply);

      // 2. If new file, ensure it is in the Host canonical file list
      if (_hostFilesArray) {
        const files = _hostFilesArray.toArray();
        if (!files.includes(current.file)) {
          _hostFilesArray.push([current.file]);
        }
      }
    }
  });
}

export function destroy() {
  _activitySubscribers.clear();
  _activityArray = null;
  _snapshotSubscribers.clear();
  _snapshotArray = null;
  _commentSubscribers.clear();
  _commentArray = null;
  _hostFilesSubscribers.clear();
  _hostFilesArray = null;
  _proposalsSubscribers.clear();
  _proposalsArray = null;
  _provider?.destroy();
  _persistence?.destroy();
  _ydoc?.destroy();
  _ydoc = null;
  _provider = null;
  _persistence = null;
  _localUser = null;
  _pendingChanges = [];
  _opCounter = 0;
}
