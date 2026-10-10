// Weaver Collaboration Store — Yjs CRDT + host-failover
// Architecture: ALL members edit the SAME shared Y.Text (no draft copies).
// Host is a UI role; when the host disconnects the server elects the next
// oldest joiner and broadcasts a `host-transfer` message.
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { WebrtcProvider } from 'y-webrtc';
import { IndexeddbPersistence } from 'y-indexeddb';

// ─── Public Types ─────────────────────────────────────────────────────────────

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

// ─── Module-level state ───────────────────────────────────────────────────────

const USER_COLORS = ['#6c8eff', '#4ade80', '#f87171', '#fbbf24', '#a78bfa', '#22d3ee'];
const DEFAULT_NAMES = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank'];

let _ydoc: Y.Doc | null = null;
let _provider: WebsocketProvider | null = null;
let _webrtcProvider: any = null;
let _persistence: IndexeddbPersistence | null = null;
let _localUser: UserInfo | null = null;
let _rawWs: WebSocket | null = null;   // direct WS for host-transfer messages

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

// Host-transfer subscribers — App.tsx hooks into this to update isHost state
const _hostTransferSubscribers: Set<(newHostUserId: string, newHostUserName: string) => void> = new Set();

let _pendingChanges: ChangeRecord[] = [];
let _opCounter = 0;

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initCollaboration(
  sessionId: string,
  userId: string,
  customName?: string,
  isHost = false,
): { ydoc: Y.Doc; provider: WebsocketProvider; localUser: UserInfo } {
  destroy();

  const hash = Math.abs(userId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0));
  const displayName = customName?.trim() || DEFAULT_NAMES[hash % DEFAULT_NAMES.length] || 'Collaborator';

  _localUser = {
    id: userId,
    name: displayName,
    color: USER_COLORS[hash % USER_COLORS.length] || '#6c8eff',
    isHost,
  };

  _ydoc = new Y.Doc();

  const wsUrl = `ws://${window.location.hostname}:1234`;
  _provider = new WebsocketProvider(wsUrl, `weaver-${sessionId}`, _ydoc, { connect: true });

  _webrtcProvider = new WebrtcProvider(`weaver-${sessionId}`, _ydoc, {
    signaling: ['wss://signaling.yjs.dev', 'wss://y-webrtc-signaling-eu.herokuapp.com']
  });

  // Presence
  _provider.awareness.setLocalStateField('user', _localUser);
  _webrtcProvider.awareness.setLocalStateField('user', _localUser);

  // ── Register identity with the server so it can track join order ──
  // We send a 'register' message once the WS is open.
  const providerWs = (_provider as any).ws as WebSocket | null;
  const sendRegister = () => {
    const ws = (_provider as any).ws as WebSocket | null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          type: 'register',
          userId,
          userName: displayName,
          isHost,
          sessionId,
        }));
      } catch { /* ignore */ }
    }
  };

  // y-websocket reconnects automatically; hook into its ws each time
  _provider.on('status', (event: any) => {
    if (event.status === 'connected') {
      const ws = (_provider as any).ws as WebSocket | null;
      if (!ws) return;
      
      sendRegister();
      
      // Listen for host-transfer / host-assign messages
      ws.addEventListener('message', (ev: MessageEvent) => {
        if (typeof ev.data !== 'string') return;
        let msg: any;
        try { msg = JSON.parse(ev.data); } catch { return; }

        if (msg.type === 'host-transfer') {
          const { newHostUserId, newHostUserName } = msg;
          // Update local user if we are the new host
          if (_localUser && newHostUserId === _localUser.id) {
            _localUser = { ..._localUser, isHost: true };
            _provider?.awareness.setLocalStateField('user', _localUser);
            console.log('[collab] Promoted to host');
          } else if (_localUser) {
            _localUser = { ..._localUser, isHost: false };
            _provider?.awareness.setLocalStateField('user', _localUser);
          }
          _hostTransferSubscribers.forEach(cb => {
            try { cb(newHostUserId, newHostUserName); } catch { /* ignore */ }
          });
        }

        if (msg.type === 'host-assign') {
          // Server tells us our role on first connect
          const serverSaysHost = msg.isHost === true;
          if (_localUser && serverSaysHost !== _localUser.isHost) {
            _localUser = { ..._localUser, isHost: serverSaysHost };
            _provider?.awareness.setLocalStateField('user', _localUser);
          }
        }
      });
    }
  });

  // Shared CRDT arrays
  _activityArray = _ydoc.getArray<ActivityLogItem>('weaver_activity_logs');
  _activityArray.observe(() => {
    const logs = _activityArray!.toArray();
    _activitySubscribers.forEach(cb => { try { cb(logs); } catch { /* ignore */ } });
  });

  _snapshotArray = _ydoc.getArray<SnapshotItem>('weaver_snapshots');
  _snapshotArray.observe(() => {
    const list = _snapshotArray!.toArray();
    _snapshotSubscribers.forEach(cb => { try { cb(list); } catch { /* ignore */ } });
  });

  _commentArray = _ydoc.getArray<CodeComment>('weaver_comments');
  _commentArray.observe(() => {
    const list = _commentArray!.toArray();
    _commentSubscribers.forEach(cb => { try { cb(list); } catch { /* ignore */ } });
  });

  _hostFilesArray = _ydoc.getArray<string>('weaver_host_files');
  _hostFilesArray.observe(() => {
    const list = _hostFilesArray!.toArray();
    _hostFilesSubscribers.forEach(cb => { try { cb(list); } catch { /* ignore */ } });
  });

  _proposalsArray = _ydoc.getArray<MergeProposal>('weaver_merge_proposals');
  _proposalsArray.observe(() => {
    const list = _proposalsArray!.toArray();
    _proposalsSubscribers.forEach(cb => { try { cb(list); } catch { /* ignore */ } });
  });

  _persistence = new IndexeddbPersistence(`weaver-${sessionId}`, _ydoc);

  return { ydoc: _ydoc, provider: _provider, localUser: _localUser };
}

// ─── Host transfer subscription ───────────────────────────────────────────────

/**
 * Subscribe to host-transfer events from the server.
 * Fires when the host disconnects and a new host is elected.
 * Returns an unsubscribe function.
 */
export function subscribeHostTransfer(
  callback: (newHostUserId: string, newHostUserName: string) => void,
): () => void {
  _hostTransferSubscribers.add(callback);
  return () => _hostTransferSubscribers.delete(callback);
}

// ─── Shared Y.Text for files (ALL users edit the same text) ──────────────────

/**
 * Every user reads/writes the SAME shared Y.Text.
 * No drafts, no copies — real-time collaborative editing like Google Docs.
 */
export function getYText(file: string): Y.Text {
  if (!_ydoc) throw new Error('Collaboration not initialized');
  return _ydoc.getText(`file:${file}`);
}

/** Alias kept for backward compatibility with calls that used getHostYText */
export function getHostYText(file: string): Y.Text {
  return getYText(file);
}

/** Alias kept for backward compat */
export function getYTextForUser(file: string, _userId: string, _isHost: boolean): Y.Text {
  return getYText(file);
}

/** Write content to the shared Y.Text (replaces entire content transactionally) */
export function setFileContent(file: string, content: string): void {
  if (!_ydoc) return;
  const text = _ydoc.getText(`file:${file}`);
  _ydoc.transact(() => {
    text.delete(0, text.length);
    text.insert(0, content);
  });
}

/** Kept for backward compat — writes to shared text (same as setFileContent) */
export function mergeDraftToHost(file: string, content: string): void {
  setFileContent(file, content);
}

/** Kept for backward compat — reads from shared text */
export function syncDraftFromHost(file: string, _userId: string): string {
  return getYText(file).toString();
}

/** Sync all host files to local state — reads shared CRDT */
export function syncAllFilesFromHost(_userId: string): { files: string[]; contents: Record<string, string> } {
  if (!_ydoc || !_hostFilesArray) return { files: [], contents: {} };
  const files = _hostFilesArray.toArray();
  const contents: Record<string, string> = {};
  files.forEach(file => {
    contents[file] = _ydoc!.getText(`file:${file}`).toString();
  });
  return { files, contents };
}

// ─── Awareness / Presence ─────────────────────────────────────────────────────

export function getAwareness() { return _provider?.awareness ?? null; }

export function subscribeAwareness(callback: () => void): () => void {
  if (!_provider?.awareness) return () => {};
  const handler = () => callback();
  _provider.awareness.on('change', handler);
  return () => _provider?.awareness?.off('change', handler);
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

export function getPeerActiveEdits(): PeerEditState[] {
  if (!_provider || !_localUser) return [];
  const states = _provider.awareness.getStates();
  const peers: PeerEditState[] = [];
  states.forEach(state => {
    if (!state?.user || state.user.id === _localUser!.id) return;
    if (!state.editing) return;
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

export function getConnectedUsers(): UserInfo[] {
  if (!_provider) return [];
  const users: UserInfo[] = [];
  _provider.awareness.getStates().forEach(state => {
    if (state?.user) users.push(state.user as UserInfo);
  });
  return users;
}

export function getLocalUser(): UserInfo | null { return _localUser; }

export function getSyncStatus(): 'connected' | 'connecting' | 'disconnected' {
  if (!_provider) return 'disconnected';
  if (_provider.wsconnected) return 'connected';
  if (_provider.wsconnecting) return 'connecting';
  return 'disconnected';
}

// ─── Change tracking ──────────────────────────────────────────────────────────

export function recordChange(
  file: string, operation: string, affectedText: string, fromLine: number, toLine: number,
): void {
  if (!_localUser) return;
  _pendingChanges.push({
    userId: _localUser.id,
    opId: `op-${++_opCounter}`,
    timestamp: Date.now(),
    file, operation, affectedText, fromLine, toLine,
    docVersion: _opCounter,
  });
}

export function getRecentChanges(n = 5): ChangeRecord[] { return _pendingChanges.slice(-n); }

// ─── Activity Logs ────────────────────────────────────────────────────────────

export function getActivityLogs(): ActivityLogItem[] { return _activityArray?.toArray() ?? []; }

export function subscribeActivityLogs(callback: (logs: ActivityLogItem[]) => void): () => void {
  _activitySubscribers.add(callback);
  if (_activityArray) { try { callback(_activityArray.toArray()); } catch { /* ignore */ } }
  return () => _activitySubscribers.delete(callback);
}

export function addActivityLog(item: Omit<ActivityLogItem, 'id' | 'timestamp'>): ActivityLogItem | null {
  if (!_activityArray) return null;
  const entry: ActivityLogItem = {
    ...item,
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  };
  if (_ydoc) _ydoc.transact(() => _activityArray!.push([entry]));
  else _activityArray.push([entry]);
  return entry;
}

export function clearActivityLogs(): void {
  if (!_activityArray || !_ydoc) return;
  _ydoc.transact(() => _activityArray!.delete(0, _activityArray!.length));
}

// ─── Snapshots ────────────────────────────────────────────────────────────────

export function getSnapshots(): SnapshotItem[] { return _snapshotArray?.toArray() ?? []; }

export function subscribeSnapshots(callback: (snapshots: SnapshotItem[]) => void): () => void {
  _snapshotSubscribers.add(callback);
  if (_snapshotArray) { try { callback(_snapshotArray.toArray()); } catch { /* ignore */ } }
  return () => _snapshotSubscribers.delete(callback);
}

export function createSnapshot(name: string, files: Record<string, string>, description?: string): SnapshotItem | null {
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
  if (_ydoc) _ydoc.transact(() => _snapshotArray!.push([item]));
  else _snapshotArray!.push([item]);
  return item;
}

export function deleteSnapshot(id: string): void {
  if (!_snapshotArray || !_ydoc) return;
  const idx = _snapshotArray.toArray().findIndex(s => s.id === id);
  if (idx !== -1) _ydoc.transact(() => _snapshotArray!.delete(idx, 1));
}

// ─── Comments ─────────────────────────────────────────────────────────────────

export function getComments(file?: string): CodeComment[] {
  const all = _commentArray?.toArray() ?? [];
  return file ? all.filter(c => c.file === file) : all;
}

export function subscribeComments(callback: (comments: CodeComment[]) => void): () => void {
  _commentSubscribers.add(callback);
  if (_commentArray) { try { callback(_commentArray.toArray()); } catch { /* ignore */ } }
  return () => _commentSubscribers.delete(callback);
}

export function addComment(file: string, line: number, text: string): CodeComment | null {
  if (!_commentArray || !_localUser || !text.trim()) return null;
  const comment: CodeComment = {
    id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    file, line, timestamp: Date.now(),
    authorId: _localUser.id, authorName: _localUser.name, authorColor: _localUser.color,
    text: text.trim(), resolved: false, replies: [],
  };
  if (_ydoc) _ydoc.transact(() => _commentArray!.push([comment]));
  else _commentArray!.push([comment]);
  return comment;
}

export function replyComment(commentId: string, text: string): void {
  if (!_commentArray || !_ydoc || !_localUser || !text.trim()) return;
  const arr = _commentArray.toArray();
  const idx = arr.findIndex(c => c.id === commentId);
  if (idx === -1) return;
  const updated: CodeComment = {
    ...arr[idx],
    replies: [...(arr[idx].replies || []), {
      id: `reply-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      authorId: _localUser.id, authorName: _localUser.name, authorColor: _localUser.color,
      text: text.trim(),
    }],
  };
  _ydoc.transact(() => { _commentArray!.delete(idx, 1); _commentArray!.insert(idx, [updated]); });
}

export function resolveComment(commentId: string, resolved = true): void {
  if (!_commentArray || !_ydoc) return;
  const arr = _commentArray.toArray();
  const idx = arr.findIndex(c => c.id === commentId);
  if (idx === -1) return;
  const updated: CodeComment = { ...arr[idx], resolved };
  _ydoc.transact(() => { _commentArray!.delete(idx, 1); _commentArray!.insert(idx, [updated]); });
}

export function deleteComment(commentId: string): void {
  if (!_commentArray || !_ydoc) return;
  const idx = _commentArray.toArray().findIndex(c => c.id === commentId);
  if (idx !== -1) _ydoc.transact(() => _commentArray!.delete(idx, 1));
}

// ─── Host Files (shared file list) ───────────────────────────────────────────

export function getHostFiles(): string[] { return _hostFilesArray?.toArray() ?? []; }

export function subscribeHostFiles(callback: (files: string[]) => void): () => void {
  _hostFilesSubscribers.add(callback);
  if (_hostFilesArray) { try { callback(_hostFilesArray.toArray()); } catch { /* ignore */ } }
  return () => _hostFilesSubscribers.delete(callback);
}

export function addHostFile(filename: string): void {
  if (!_hostFilesArray || !_ydoc) return;
  if (!_hostFilesArray.toArray().includes(filename)) {
    _ydoc.transact(() => _hostFilesArray!.push([filename]));
  }
}

export function removeHostFile(filename: string): void {
  if (!_hostFilesArray || !_ydoc) return;
  const idx = _hostFilesArray.toArray().indexOf(filename);
  if (idx !== -1) _ydoc.transact(() => _hostFilesArray!.delete(idx, 1));
}

export function renameHostFile(oldName: string, newName: string): void {
  if (!_hostFilesArray || !_ydoc) return;
  const idx = _hostFilesArray.toArray().indexOf(oldName);
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
    _ydoc.transact(() => _hostFilesArray!.push(defaultFiles));
  }
}

// ─── Merge Proposals ─────────────────────────────────────────────────────────

export function getMergeProposals(): MergeProposal[] { return _proposalsArray?.toArray() ?? []; }

export function subscribeMergeProposals(callback: (proposals: MergeProposal[]) => void): () => void {
  _proposalsSubscribers.add(callback);
  if (_proposalsArray) { try { callback(_proposalsArray.toArray()); } catch { /* ignore */ } }
  return () => _proposalsSubscribers.delete(callback);
}

export function createMergeProposal(
  file: string, draftContent: string, hostContent = '', isNewFile = false,
): MergeProposal | null {
  if (!_proposalsArray || !_ydoc || !_localUser) return null;
  const existing = _proposalsArray.toArray();
  const existingIdx = existing.findIndex(
    p => p.file === file && p.fromUserId === _localUser!.id && p.status === 'pending'
  );
  if (existingIdx !== -1) {
    const updated: MergeProposal = {
      ...existing[existingIdx], draftContent, hostContent,
      timestamp: Date.now(), isNewFile: isNewFile || existing[existingIdx].isNewFile,
    };
    _ydoc.transact(() => { _proposalsArray!.delete(existingIdx, 1); _proposalsArray!.insert(existingIdx, [updated]); });
    return updated;
  }
  const proposal: MergeProposal = {
    id: `prop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    file, fromUserId: _localUser.id, fromUserName: _localUser.name,
    fromUserColor: _localUser.color, draftContent, hostContent,
    timestamp: Date.now(), status: 'pending', isNewFile,
  };
  _ydoc.transact(() => _proposalsArray!.push([proposal]));
  return proposal;
}

export function resolveMergeProposal(
  proposalId: string, status: 'accepted' | 'rejected', resolvedContent?: string,
): void {
  if (!_proposalsArray || !_ydoc) return;
  const arr = _proposalsArray.toArray();
  const idx = arr.findIndex(p => p.id === proposalId);
  if (idx === -1) return;
  const current = arr[idx];
  _ydoc.transact(() => {
    _proposalsArray!.delete(idx, 1);
    _proposalsArray!.insert(idx, [{ ...current, status }]);
    if (status === 'accepted') {
      const content = resolvedContent ?? current.draftContent;
      // Write to shared Y.Text so all collaborators see it immediately
      const text = _ydoc!.getText(`file:${current.file}`);
      text.delete(0, text.length);
      text.insert(0, content);
      if (_hostFilesArray && !_hostFilesArray.toArray().includes(current.file)) {
        _hostFilesArray.push([current.file]);
      }
    }
  });
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

export function destroy() {
  _activitySubscribers.clear(); _activityArray = null;
  _snapshotSubscribers.clear(); _snapshotArray = null;
  _commentSubscribers.clear();  _commentArray = null;
  _hostFilesSubscribers.clear(); _hostFilesArray = null;
  _proposalsSubscribers.clear(); _proposalsArray = null;
  _hostTransferSubscribers.clear();
  _provider?.destroy();
  if (_webrtcProvider) {
    _webrtcProvider.disconnect();
    _webrtcProvider.destroy();
    _webrtcProvider = null;
  }
  _persistence?.destroy();
  _ydoc?.destroy();
  _ydoc = null; _provider = null; _persistence = null; _localUser = null;
  _rawWs = null; _pendingChanges = []; _opCounter = 0;
}
