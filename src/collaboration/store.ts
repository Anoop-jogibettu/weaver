// Weaver Collaboration Store — manages Yjs CRDT state and session
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';

export interface UserInfo {
  id: string;
  name: string;
  color: string;
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

const USER_COLORS = ['#6c8eff', '#4ade80', '#f87171', '#fbbf24', '#a78bfa', '#22d3ee'];
const USER_NAMES = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank'];

let _ydoc: Y.Doc | null = null;
let _provider: WebsocketProvider | null = null;
let _persistence: IndexeddbPersistence | null = null;
let _localUser: UserInfo | null = null;
let _pendingChanges: ChangeRecord[] = [];
let _opCounter = 0;

export function initCollaboration(sessionId: string, userId: string): {
  ydoc: Y.Doc;
  provider: WebsocketProvider;
  localUser: UserInfo;
} {
  // Clean up any existing session
  destroy();

  const userIndex = parseInt(userId.slice(-1) || '0', 16) % USER_COLORS.length;
  _localUser = {
    id: userId,
    name: USER_NAMES[userIndex],
    color: USER_COLORS[userIndex],
  };

  _ydoc = new Y.Doc();

  // y-websocket connection to relay server
  const wsUrl = 'ws://localhost:1234';
  _provider = new WebsocketProvider(wsUrl, `weaver-${sessionId}`, _ydoc, {
    connect: true,
  });

  // Set awareness (presence)
  _provider.awareness.setLocalStateField('user', _localUser);

  // IndexedDB persistence for local-first behavior
  _persistence = new IndexeddbPersistence(`weaver-${sessionId}`, _ydoc);

  return { ydoc: _ydoc, provider: _provider, localUser: _localUser };
}

export function getYText(file: string): Y.Text {
  if (!_ydoc) throw new Error('Collaboration not initialized');
  return _ydoc.getText(`file:${file}`);
}

export function recordChange(
  file: string,
  operation: string,
  affectedText: string,
  fromLine: number,
  toLine: number,
): ChangeRecord {
  if (!_localUser || !_ydoc) throw new Error('Collaboration not initialized');
  const record: ChangeRecord = {
    userId: _localUser.id,
    opId: `${_localUser.id}-${Date.now()}-${_opCounter++}`,
    timestamp: Date.now(),
    file,
    operation,
    affectedText,
    fromLine,
    toLine,
    docVersion: _ydoc.clientID,
  };
  _pendingChanges.push(record);
  if (_pendingChanges.length > 50) _pendingChanges.shift(); // cap
  return record;
}

export function getRecentChanges(n = 10): ChangeRecord[] {
  return _pendingChanges.slice(-n);
}

export function getConnectedUsers(): UserInfo[] {
  if (!_provider) return [];
  const states = _provider.awareness.getStates();
  const users: UserInfo[] = [];
  states.forEach((state, clientId) => {
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

export function destroy() {
  _provider?.destroy();
  _persistence?.destroy();
  _ydoc?.destroy();
  _ydoc = null;
  _provider = null;
  _persistence = null;
  _localUser = null;
  _pendingChanges = [];
}
