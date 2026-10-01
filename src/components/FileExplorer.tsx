import React, { useState, useRef, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

type IconSpec = { color: string; icon: string };

interface TreeFile   { type: 'file';   name: string; path: string; depth: number; }
interface TreeFolder { type: 'folder'; name: string; path: string; depth: number; children: TreeNode[]; }
type TreeNode = TreeFile | TreeFolder;

// ─── Tree builder ─────────────────────────────────────────────────────────────

function buildTree(files: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  const folderMap = new Map<string, TreeFolder>();

  const sorted = [...files].sort((a, b) => {
    const da = a.split('/').length, db = b.split('/').length;
    return da !== db ? da - db : a.localeCompare(b);
  });

  for (const filePath of sorted) {
    const parts = filePath.split('/');
    if (parts.length === 1) {
      root.push({ type: 'file', name: parts[0], path: filePath, depth: 0 });
    } else {
      for (let i = 1; i < parts.length; i++) {
        const folderPath = parts.slice(0, i).join('/');
        if (!folderMap.has(folderPath)) {
          const folder: TreeFolder = { type: 'folder', name: parts[i - 1], path: folderPath, depth: i - 1, children: [] };
          folderMap.set(folderPath, folder);
          if (i === 1) root.push(folder);
          else folderMap.get(parts.slice(0, i - 1).join('/'))?.children.push(folder);
        }
      }
      folderMap.get(parts.slice(0, -1).join('/'))?.children.push({
        type: 'file', name: parts[parts.length - 1], path: filePath, depth: parts.length - 1,
      });
    }
  }
  return root;
}

// ─── File icon helpers ────────────────────────────────────────────────────────

function getFileIcon(filename: string): IconSpec {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'py')    return { color: '#4ec9b0', icon: 'python' };
  if (ext === 'js')    return { color: '#f7df1e', icon: 'js' };
  if (ext === 'ts')    return { color: '#3178c6', icon: 'ts' };
  if (ext === 'tsx')   return { color: '#61dafb', icon: 'tsx' };
  if (ext === 'jsx')   return { color: '#f7df1e', icon: 'jsx' };
  if (ext === 'json')  return { color: '#f0a500', icon: 'json' };
  if (ext === 'css')   return { color: '#569cd6', icon: 'css' };
  if (ext === 'html')  return { color: '#e34c26', icon: 'html' };
  if (ext === 'md')    return { color: '#75beff', icon: 'md' };
  if (ext === 'sh' || ext === 'bash') return { color: '#89d185', icon: 'sh' };
  if (ext === 'yml' || ext === 'yaml') return { color: '#f48771', icon: 'yaml' };
  return { color: '#8e9aad', icon: 'file' };
}

function FileIconSvg({ spec, size = 14 }: { spec: IconSpec; size?: number }) {
  const { icon, color } = spec;
  if (icon === 'python') return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path d="M15.885 2.1c-7.3 0-6.85 3.168-6.85 3.168l.008 3.281h6.973v.985H6.042S2 8.998 2 16.351c0 7.354 4.52 7.09 4.52 7.09h2.699v-3.412s-.145-4.52 4.446-4.52h7.669s4.303.07 4.303-4.16V6.333s.652-4.233-9.752-4.233zm-3.808 2.443a1.243 1.243 0 110 2.487 1.243 1.243 0 010-2.487z" fill={color}/>
      <path d="M16.115 29.9c7.3 0 6.85-3.168 6.85-3.168l-.008-3.281h-6.973v-.985h9.974S30 23.003 30 15.649c0-7.354-4.52-7.09-4.52-7.09H22.78v3.412s.145 4.52-4.446 4.52H10.666s-4.303-.07-4.303 4.16v6.996s-.652 4.233 9.752 4.233zm3.808-2.443a1.243 1.243 0 110-2.487 1.243 1.243 0 010 2.487z" fill="#3776ab"/>
    </svg>
  );
  if (icon === 'ts') return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" fill={color}/><text x="2.5" y="12" fill="#fff" fontSize="7.5" fontWeight="bold" fontFamily="monospace">TS</text></svg>;
  if (icon === 'tsx') return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" fill={color}/><text x="1" y="12" fill="#1e1e2e" fontSize="6.5" fontWeight="bold" fontFamily="monospace">TSX</text></svg>;
  if (icon === 'js' || icon === 'jsx') return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" fill={color}/><text x="2.5" y="12" fill="#1e1e2e" fontSize="7.5" fontWeight="bold" fontFamily="monospace">JS</text></svg>;
  if (icon === 'json') return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke={color} strokeWidth="1.5"/><text x="2" y="12" fill={color} fontSize="8" fontWeight="bold" fontFamily="monospace">{'{}'}</text></svg>;
  if (icon === 'css') return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><path d="M2 2l1 10 5 1.5L13 12 14 2z" fill={color} fillOpacity=".2" stroke={color} strokeWidth="1.2"/><text x="4" y="11" fill={color} fontSize="6" fontWeight="bold" fontFamily="monospace">CSS</text></svg>;
  if (icon === 'html') return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><path d="M2 2l1 10 5 1.5L13 12 14 2z" fill={color} fillOpacity=".2" stroke={color} strokeWidth="1.2"/><text x="2.5" y="11" fill={color} fontSize="5.5" fontWeight="bold" fontFamily="monospace">HTML</text></svg>;
  if (icon === 'md') return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="14" height="12" rx="2" fill="none" stroke={color} strokeWidth="1.2"/><path d="M4 11V5l2.5 3 2.5-3v6M11 11V5M12.5 8H11" stroke={color} strokeWidth="1.2" strokeLinecap="round"/></svg>;
  if (icon === 'sh') return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" fill={color} fillOpacity=".15" stroke={color} strokeWidth="1.2"/><path d="M4 6l3 3-3 3M9 12h3" stroke={color} strokeWidth="1.3" strokeLinecap="round"/></svg>;
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><path d="M4 1h5.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill={color} fillOpacity=".15" stroke={color} strokeWidth="1.2"/><path d="M9 1v4h4" stroke={color} strokeWidth="1.2" strokeLinecap="round"/></svg>;
}

function FolderIconSvg({ open, size = 14 }: { open: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      {open
        ? <path d="M1 5a1 1 0 011-1h4.586a1 1 0 01.707.293l1.414 1.414A1 1 0 009.414 6H14a1 1 0 011 1v7a1 1 0 01-1 1H2a1 1 0 01-1-1V5z" fill="#dcb67a" fillOpacity=".9"/>
        : <path d="M1 4a1 1 0 011-1h4.586a1 1 0 01.707.293l1.414 1.414A1 1 0 009.414 5H14a1 1 0 011 1v8a1 1 0 01-1 1H2a1 1 0 01-1-1V4z" fill="#dcb67a" fillOpacity=".75"/>
      }
    </svg>
  );
}

// ─── Context Menu ─────────────────────────────────────────────────────────────

interface CtxMenuItem {
  label: string;
  icon: React.ReactNode;
  action: () => void;
  danger?: boolean;
  divider?: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  target: { type: 'folder' | 'file' | 'root'; path: string };
}

function ContextMenu({ menu, items, onClose }: {
  menu: ContextMenuState;
  items: CtxMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', keyHandler); };
  }, [onClose]);

  // Adjust position so it never overflows viewport
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    setPos({
      x: menu.x + rect.width > vw ? menu.x - rect.width : menu.x,
      y: menu.y + rect.height > vh ? menu.y - rect.height : menu.y,
    });
  }, [menu.x, menu.y]);

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={e => e.preventDefault()}
    >
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {item.divider && <div className="ctx-menu-divider" />}
          <button
            className={`ctx-menu-item${item.danger ? ' danger' : ''}`}
            onClick={() => { item.action(); onClose(); }}
          >
            <span className="ctx-menu-icon">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Inline input ─────────────────────────────────────────────────────────────

function InlineInput({ depth, icon, placeholder, onConfirm, onCancel }: {
  depth: number; icon: 'file' | 'folder'; placeholder: string;
  onConfirm: (v: string) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const confirm = () => { const t = value.trim(); if (t) onConfirm(t); else onCancel(); };

  return (
    <div className="explorer-inline-input-row" style={{ paddingLeft: 8 + depth * 12 }}>
      <div className="explorer-inline-input-icon">
        {icon === 'folder'
          ? <FolderIconSvg open={false} size={13} />
          : <svg width={13} height={13} viewBox="0 0 16 16" fill="none"><path d="M4 1h5.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#8e9aad" fillOpacity=".3" stroke="#8e9aad" strokeWidth="1.2"/><path d="M9 1v4h4" stroke="#8e9aad" strokeWidth="1.2" strokeLinecap="round"/></svg>
        }
      </div>
      <input
        ref={ref}
        className="explorer-inline-input"
        value={value}
        placeholder={placeholder}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') onCancel(); }}
        onBlur={confirm}
      />
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface FileExplorerProps {
  files: string[];
  activeFile: string;
  sessionId: string | null;
  userCount: number;
  onSelectFile: (name: string) => void;
  onNewFile: (explicitPath?: string) => void;
  onNewFolder: (folderPath: string) => void;
  onImportFile: () => void;
  onRenameFile: (name: string) => void;
  onCloseFile: (name: string, e: React.MouseEvent) => void;
  onDeleteFolder: (folderPath: string) => void;
}

// ─── Recursive tree renderer ──────────────────────────────────────────────────

function TreeRenderer({
  nodes, files, activeFile, openFolders, toggleFolder,
  hoveredNode, setHoveredNode, creatingIn, creatingType,
  onSelectFile, onRenameFile, onCloseFile,
  onNewFileInFolder, onNewFolderIn,
  onInlineConfirm, onInlineCancel, onContextMenu,
}: {
  nodes: TreeNode[]; files: string[]; activeFile: string;
  openFolders: Set<string>; toggleFolder: (p: string) => void;
  hoveredNode: string | null; setHoveredNode: (v: string | null) => void;
  creatingIn: string | null; creatingType: 'file' | 'folder' | null;
  onSelectFile: (n: string) => void; onRenameFile: (n: string) => void;
  onCloseFile: (n: string, e: React.MouseEvent) => void;
  onNewFileInFolder: (p: string) => void; onNewFolderIn: (p: string) => void;
  onInlineConfirm: (v: string) => void; onInlineCancel: () => void;
  onContextMenu: (e: React.MouseEvent, target: ContextMenuState['target']) => void;
}) {
  return (
    <>
      {nodes.map(node => {
        if (node.type === 'folder') {
          const isOpen   = openFolders.has(node.path);
          const isHovered = hoveredNode === `folder:${node.path}`;
          const indentPx  = 8 + node.depth * 12;

          return (
            <React.Fragment key={node.path}>
              {/* ── Folder row ── */}
              <div
                className={`explorer-folder-row${isHovered ? ' hovered' : ''}`}
                style={{ paddingLeft: indentPx }}
                onClick={() => toggleFolder(node.path)}
                onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, { type: 'folder', path: node.path }); }}
                onMouseEnter={() => setHoveredNode(`folder:${node.path}`)}
                onMouseLeave={() => setHoveredNode(null)}
                title={`${node.path} — right-click for options`}
              >
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none" className="explorer-chevron"
                  style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.13s ease', flexShrink: 0 }}>
                  <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <FolderIconSvg open={isOpen} size={14} />
                <span className="explorer-folder-row-name">{node.name}</span>

                {/* Hover quick-action buttons */}
                <div className={`explorer-file-actions${isHovered ? ' visible' : ''}`}>
                  <button className="explorer-file-btn" title="New file in this folder"
                    onClick={e => { e.stopPropagation(); onNewFileInFolder(node.path); }}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                      <path d="M4 1h5.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" fill="none"/>
                      <path d="M9 1v4h4M8 9v4M6 11h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                    </svg>
                  </button>
                  <button className="explorer-file-btn" title="New subfolder"
                    onClick={e => { e.stopPropagation(); onNewFolderIn(node.path); }}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                      <path d="M1 4a1 1 0 011-1h4.586a1 1 0 01.707.293l1.414 1.414A1 1 0 009.414 5H14a1 1 0 011 1v8a1 1 0 01-1 1H2a1 1 0 01-1-1V4z" fill="#dcb67a" fillOpacity=".7"/>
                      <path d="M8 9v4M6 11h4" stroke="white" strokeWidth="1.3" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              </div>

              {/* Inline creation row inside this folder */}
              {isOpen && creatingIn === node.path && creatingType && (
                <InlineInput
                  depth={node.depth + 1}
                  icon={creatingType}
                  placeholder={creatingType === 'folder' ? 'folder-name' : 'filename.py'}
                  onConfirm={onInlineConfirm}
                  onCancel={onInlineCancel}
                />
              )}

              {/* Recurse children */}
              {isOpen && node.children.length > 0 && (
                <TreeRenderer nodes={node.children} files={files} activeFile={activeFile}
                  openFolders={openFolders} toggleFolder={toggleFolder}
                  hoveredNode={hoveredNode} setHoveredNode={setHoveredNode}
                  creatingIn={creatingIn} creatingType={creatingType}
                  onSelectFile={onSelectFile} onRenameFile={onRenameFile} onCloseFile={onCloseFile}
                  onNewFileInFolder={onNewFileInFolder} onNewFolderIn={onNewFolderIn}
                  onInlineConfirm={onInlineConfirm} onInlineCancel={onInlineCancel}
                  onContextMenu={onContextMenu}
                />
              )}

              {/* Empty folder placeholder */}
              {isOpen && node.children.length === 0 && creatingIn !== node.path && (
                <div
                  className="explorer-empty-folder"
                  style={{ paddingLeft: 8 + (node.depth + 1) * 12 }}
                  onClick={() => onNewFileInFolder(node.path)}
                >
                  + New file
                </div>
              )}
            </React.Fragment>
          );
        }

        // ── File row ──
        const isActive  = node.path === activeFile;
        const isHovered = hoveredNode === `file:${node.path}`;
        const spec      = getFileIcon(node.name);
        const indentPx  = 8 + node.depth * 12;

        return (
          <div
            key={node.path}
            className={`explorer-file-item${isActive ? ' active' : ''}`}
            style={{ paddingLeft: indentPx }}
            onClick={() => onSelectFile(node.path)}
            onDoubleClick={e => { e.stopPropagation(); onRenameFile(node.path); }}
            onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, { type: 'file', path: node.path }); }}
            onMouseEnter={() => setHoveredNode(`file:${node.path}`)}
            onMouseLeave={() => setHoveredNode(null)}
            title={`${node.path} — right-click for options`}
          >
            <div className="explorer-indent-line" />
            <span className="explorer-file-icon"><FileIconSvg spec={spec} size={14} /></span>
            <span className="explorer-file-name">{node.name}</span>
            <div className={`explorer-file-actions${(isHovered || isActive) ? ' visible' : ''}`}>
              <button className="explorer-file-btn" title="Rename" onClick={e => { e.stopPropagation(); onRenameFile(node.path); }}>
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M9.5 2.5l2 2L5 11H3V9L9.5 2.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
              </button>
              {files.length > 1 && (
                <button className="explorer-file-btn danger" title="Close" onClick={e => onCloseFile(node.path, e)}>
                  <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3L3 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                </button>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function FileExplorer({
  files, activeFile, sessionId, userCount,
  onSelectFile, onNewFile, onNewFolder, onImportFile,
  onRenameFile, onCloseFile, onDeleteFolder,
}: FileExplorerProps) {
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [hoveredNode,  setHoveredNode]  = useState<string | null>(null);
  const [openFolders,  setOpenFolders]  = useState<Set<string>>(new Set());

  // Inline creation state
  const [creatingIn,   setCreatingIn]   = useState<string | null>(null);
  const [creatingType, setCreatingType] = useState<'file' | 'folder' | null>(null);

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);

  const tree = buildTree(files);

  // Auto-expand folders containing the active file
  useEffect(() => {
    const parts = activeFile.split('/');
    if (parts.length > 1) {
      setOpenFolders(prev => {
        const next = new Set(prev);
        for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join('/'));
        return next;
      });
    }
  }, [activeFile]);

  const toggleFolder = (path: string) => {
    setOpenFolders(prev => { const n = new Set(prev); n.has(path) ? n.delete(path) : n.add(path); return n; });
  };

  const openFolder = (path: string) => {
    setOpenFolders(prev => { const n = new Set(prev); n.add(path); return n; });
  };

  const startCreate = (parentPath: string, type: 'file' | 'folder') => {
    if (parentPath !== '__root__') openFolder(parentPath);
    setCreatingIn(parentPath);
    setCreatingType(type);
  };

  const handleInlineConfirm = (value: string) => {
    const parent = creatingIn === '__root__' ? '' : creatingIn!;
    const fullPath = parent ? `${parent}/${value}` : value;
    if (creatingType === 'folder') onNewFolder(fullPath);
    else onNewFile(fullPath);
    setCreatingIn(null);
    setCreatingType(null);
  };

  const handleInlineCancel = () => { setCreatingIn(null); setCreatingType(null); };

  // Context menu items based on target type
  const getCtxItems = useCallback((target: ContextMenuState['target']): CtxMenuItem[] => {
    if (target.type === 'folder') {
      return [
        {
          label: 'New File',
          icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 1h5.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M9 1v4h4M8 9v4M6 11h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
          action: () => startCreate(target.path, 'file'),
        },
        {
          label: 'New Folder',
          icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M1 4a1 1 0 011-1h4.586a1 1 0 01.707.293l1.414 1.414A1 1 0 009.414 5H14a1 1 0 011 1v8a1 1 0 01-1 1H2a1 1 0 01-1-1V4z" fill="#dcb67a" fillOpacity=".8"/><path d="M8 9v4M6 11h4" stroke="white" strokeWidth="1.3" strokeLinecap="round"/></svg>,
          action: () => startCreate(target.path, 'folder'),
        },
        {
          label: 'Delete Folder',
          icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M6 2h4M2 4h12M5 4v9a1 1 0 001 1h4a1 1 0 001-1V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
          action: () => onDeleteFolder(target.path),
          danger: true, divider: true,
        },
      ];
    }
    if (target.type === 'file') {
      // Determine parent folder from path
      const parts = target.path.split('/');
      const parentFolder = parts.length > 1 ? parts.slice(0, -1).join('/') : '__root__';
      return [
        {
          label: 'New File Here',
          icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 1h5.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M9 1v4h4M8 9v4M6 11h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
          action: () => startCreate(parentFolder, 'file'),
        },
        {
          label: 'New Folder Here',
          icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M1 4a1 1 0 011-1h4.586a1 1 0 01.707.293l1.414 1.414A1 1 0 009.414 5H14a1 1 0 011 1v8a1 1 0 01-1 1H2a1 1 0 01-1-1V4z" fill="#dcb67a" fillOpacity=".8"/><path d="M8 9v4M6 11h4" stroke="white" strokeWidth="1.3" strokeLinecap="round"/></svg>,
          action: () => startCreate(parentFolder, 'folder'),
        },
        {
          label: 'Rename',
          icon: <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M9.5 2.5l2 2L5 11H3V9L9.5 2.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
          action: () => onRenameFile(target.path),
          divider: true,
        },
        {
          label: 'Close File',
          icon: <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3L3 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
          action: () => onCloseFile(target.path, { stopPropagation: () => {} } as any),
          danger: true,
        },
      ];
    }
    // root
    return [
      {
        label: 'New File',
        icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 1h5.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M9 1v4h4M8 9v4M6 11h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
        action: () => startCreate('__root__', 'file'),
      },
      {
        label: 'New Folder',
        icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M1 4a1 1 0 011-1h4.586a1 1 0 01.707.293l1.414 1.414A1 1 0 009.414 5H14a1 1 0 011 1v8a1 1 0 01-1 1H2a1 1 0 01-1-1V4z" fill="#dcb67a" fillOpacity=".8"/><path d="M8 9v4M6 11h4" stroke="white" strokeWidth="1.3" strokeLinecap="round"/></svg>,
        action: () => startCreate('__root__', 'folder'),
      },
      {
        label: 'Import from disk',
        icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 2v9M5 5L8 2l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 13h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
        action: onImportFile,
      },
    ];
  }, [onDeleteFolder, onRenameFile, onCloseFile, onImportFile, files]);

  const handleContextMenu = useCallback((e: React.MouseEvent, target: ContextMenuState['target']) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, target });
  }, []);

  return (
    <aside
      className="explorer-sidebar"
      onContextMenu={e => { e.preventDefault(); handleContextMenu(e, { type: 'root', path: '' }); }}
    >
      {/* ── Top label bar ── */}
      <div className="explorer-topbar" onContextMenu={e => e.stopPropagation()}>
        <span className="explorer-title">EXPLORER</span>
        <div className="explorer-topbar-actions">
          <button className="explorer-action-icon" title="New file (at root)" onClick={() => startCreate('__root__', 'file')}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M4 1h5.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" fill="none"/>
              <path d="M9 1v4h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M8 9v4M6 11h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <button className="explorer-action-icon" title="New folder (at root)" onClick={() => startCreate('__root__', 'folder')}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M1 4a1 1 0 011-1h4.586a1 1 0 01.707.293l1.414 1.414A1 1 0 009.414 5H14a1 1 0 011 1v8a1 1 0 01-1 1H2a1 1 0 01-1-1V4z" fill="#dcb67a" fillOpacity=".8"/>
              <path d="M8 9v4M6 11h4" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
          <button className="explorer-action-icon" title="Import file(s) from disk" onClick={onImportFile}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 2v9M5 5L8 2l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── Project root folder header ── */}
      <div
        className="explorer-folder-header"
        onClick={() => setExplorerOpen(o => !o)}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); handleContextMenu(e, { type: 'root', path: '' }); }}
      >
        <svg className="explorer-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none"
          style={{ transform: explorerOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }}>
          <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <FolderIconSvg open={explorerOpen} size={14} />
        <span className="explorer-folder-name">PROJECT</span>
        <span className="explorer-file-count">{files.length}</span>
      </div>

      {/* ── Tree ── */}
      {explorerOpen && (
        <div
          className="explorer-file-list"
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); handleContextMenu(e, { type: 'root', path: '' }); }}
        >
          {/* Root-level inline creation row */}
          {creatingIn === '__root__' && creatingType && (
            <InlineInput
              depth={0}
              icon={creatingType}
              placeholder={creatingType === 'folder' ? 'folder-name' : 'filename.py'}
              onConfirm={handleInlineConfirm}
              onCancel={handleInlineCancel}
            />
          )}

          <TreeRenderer
            nodes={tree} files={files} activeFile={activeFile}
            openFolders={openFolders} toggleFolder={toggleFolder}
            hoveredNode={hoveredNode} setHoveredNode={setHoveredNode}
            creatingIn={creatingIn} creatingType={creatingType}
            onSelectFile={onSelectFile} onRenameFile={onRenameFile} onCloseFile={onCloseFile}
            onNewFileInFolder={p => startCreate(p, 'file')}
            onNewFolderIn={p => startCreate(p, 'folder')}
            onInlineConfirm={handleInlineConfirm}
            onInlineCancel={handleInlineCancel}
            onContextMenu={handleContextMenu}
          />
        </div>
      )}

      {/* ── Footer: workspace info ── */}
      <div className="explorer-footer">
        {sessionId && (
          <div className="explorer-workspace-card">
            <div className="explorer-workspace-row">
              <span className="explorer-workspace-label">Workspace</span>
              <span className={`explorer-online-dot${userCount > 0 ? ' online' : ''}`} />
            </div>
            <div className="explorer-workspace-id">{sessionId}</div>
            <div className="explorer-workspace-users">
              {userCount + 1} collaborator{userCount !== 0 ? 's' : ''} active
            </div>
          </div>
        )}
      </div>

      {/* ── Context Menu (portal) ── */}
      {ctxMenu && (
        <ContextMenu
          menu={ctxMenu}
          items={getCtxItems(ctxMenu.target)}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </aside>
  );
}
