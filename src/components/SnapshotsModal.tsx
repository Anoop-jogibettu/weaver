import React, { useState, useEffect } from 'react';
import {
  SnapshotItem,
  getSnapshots,
  subscribeSnapshots,
  createSnapshot,
  deleteSnapshot,
} from '../collaboration/store';

interface SnapshotsModalProps {
  currentFiles: Record<string, string>;
  onRestore: (files: Record<string, string>, snapshotName: string) => void;
  onClose: () => void;
}

export const SnapshotsModal: React.FC<SnapshotsModalProps> = ({
  currentFiles,
  onRestore,
  onClose,
}) => {
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedSnapshot, setSelectedSnapshot] = useState<SnapshotItem | null>(null);
  const [previewFile, setPreviewFile] = useState<string>('');

  useEffect(() => {
    setSnapshots(getSnapshots());
    const unsub = subscribeSnapshots((list) => {
      setSnapshots(list);
    });
    return unsub;
  }, []);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const created = createSnapshot(name, currentFiles, description);
    if (created) {
      setName('');
      setDescription('');
    }
  };

  const handleSelectSnapshot = (snap: SnapshotItem) => {
    if (selectedSnapshot?.id === snap.id) {
      setSelectedSnapshot(null);
      setPreviewFile('');
    } else {
      setSelectedSnapshot(snap);
      const files = Object.keys(snap.files);
      setPreviewFile(files[0] || '');
    }
  };

  const handleRestore = (snap: SnapshotItem) => {
    if (window.confirm(`Restore project files to snapshot "${snap.name}"? Current edits will be replaced.`)) {
      onRestore(snap.files, snap.name);
      onClose();
    }
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Delete this snapshot?')) {
      deleteSnapshot(id);
      if (selectedSnapshot?.id === id) {
        setSelectedSnapshot(null);
      }
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="snapshots-modal" onClick={(e) => e.stopPropagation()}>
        <div className="snapshots-modal-header">
          <div className="snapshots-modal-title">
            <span className="snapshots-icon">⏱</span>
            <span>Project Snapshots &amp; Time Travel</span>
            <span className="snapshots-count-pill">{snapshots.length} saved</span>
          </div>
          <button className="output-action-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="snapshots-modal-body">
          {/* Create new snapshot section */}
          <form className="snapshot-create-form" onSubmit={handleCreate}>
            <div className="snapshot-form-row">
              <input
                type="text"
                className="snapshot-input"
                placeholder="Snapshot name (e.g., Before refactoring parser)"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                type="text"
                className="snapshot-input desc"
                placeholder="Optional description / changelog"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <button
                type="submit"
                className="action-btn primary snapshot-save-btn"
                disabled={!name.trim()}
              >
                + Capture Snapshot
              </button>
            </div>
            <div className="snapshot-form-hint">
              Captures all {Object.keys(currentFiles).length} files across the project into the shared CRDT history.
            </div>
          </form>

          {/* List and preview split */}
          <div className="snapshots-content-grid">
            <div className="snapshots-list">
              {snapshots.length === 0 ? (
                <div className="snapshots-empty-state">
                  No snapshots recorded yet. Capture a snapshot above to save a restore point.
                </div>
              ) : (
                snapshots.map((snap) => {
                  const isSelected = selectedSnapshot?.id === snap.id;
                  const fileCount = Object.keys(snap.files).length;
                  return (
                    <div
                      key={snap.id}
                      className={`snapshot-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleSelectSnapshot(snap)}
                    >
                      <div className="snapshot-card-top">
                        <span className="snapshot-card-name">{snap.name}</span>
                        <div className="snapshot-card-actions">
                          <button
                            className="snapshot-restore-btn"
                            title="Restore this snapshot"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRestore(snap);
                            }}
                          >
                            Restore
                          </button>
                          <button
                            className="snapshot-delete-btn"
                            title="Delete snapshot"
                            onClick={(e) => handleDelete(snap.id, e)}
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      {snap.description && (
                        <div className="snapshot-card-desc">{snap.description}</div>
                      )}

                      <div className="snapshot-card-meta">
                        <span
                          className="user-badge"
                          style={{
                            color: snap.authorColor,
                            borderColor: `${snap.authorColor}40`,
                            backgroundColor: `${snap.authorColor}15`,
                          }}
                        >
                          {snap.authorName}
                        </span>
                        <span className="snapshot-file-count">{fileCount} files</span>
                        <span className="snapshot-time">
                          {new Date(snap.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Snapshot Preview Pane */}
            <div className="snapshots-preview-pane">
              {selectedSnapshot ? (
                <div className="snapshot-preview-container">
                  <div className="snapshot-preview-header">
                    <span className="snapshot-preview-title">
                      Snapshot: <strong>{selectedSnapshot.name}</strong>
                    </span>
                    <div className="snapshot-file-tabs">
                      {Object.keys(selectedSnapshot.files).map((fname) => (
                        <button
                          key={fname}
                          className={`snapshot-tab ${previewFile === fname ? 'active' : ''}`}
                          onClick={() => setPreviewFile(fname)}
                        >
                          {fname}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="snapshot-code-view">
                    <pre className="snapshot-code-pre">
                      {selectedSnapshot.files[previewFile] ?? '// File not found in this snapshot'}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="snapshots-preview-empty">
                  Select any snapshot from the timeline to inspect its file contents or restore it.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
