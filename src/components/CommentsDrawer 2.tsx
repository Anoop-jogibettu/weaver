import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  CodeComment,
  getComments,
  subscribeComments,
  addComment,
  replyComment,
  resolveComment,
  deleteComment,
} from '../collaboration/store';

interface CommentsDrawerProps {
  activeFile: string;
  currentLine?: number;
  onJumpToLine?: (line: number) => void;
  onClose: () => void;
}

export const CommentsDrawer: React.FC<CommentsDrawerProps> = ({
  activeFile,
  currentLine = 1,
  onJumpToLine,
  onClose,
}) => {
  const [comments, setComments] = useState<CodeComment[]>([]);
  const [filter, setFilter] = useState<'all' | 'open'>('open');
  const [newLine, setNewLine] = useState<number>(currentLine);
  const [newText, setNewText] = useState('');
  const [replyInputs, setReplyInputs] = useState<Record<string, string>>({});
  
  const [width, setWidth] = useState(320);
  const isDragging = useRef(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return;
    setWidth(Math.max(250, Math.min(window.innerWidth - e.clientX, window.innerWidth * 0.7)));
  }, []);
  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  useEffect(() => {
    setNewLine(currentLine || 1);
  }, [currentLine]);

  useEffect(() => {
    setComments(getComments(activeFile));
    const unsub = subscribeComments((all) => {
      setComments(all.filter((c) => c.file === activeFile));
    });
    return unsub;
  }, [activeFile]);

  const handleAddComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;
    addComment(activeFile, newLine, newText);
    setNewText('');
  };

  const handleReply = (commentId: string) => {
    const text = replyInputs[commentId]?.trim();
    if (!text) return;
    replyComment(commentId, text);
    setReplyInputs((prev) => ({ ...prev, [commentId]: '' }));
  };

  const filteredComments = comments.filter((c) => (filter === 'open' ? !c.resolved : true));

  return (
    <div className="comments-drawer" style={{ width: `${width}px` }}>
      <div 
        onMouseDown={handleMouseDown}
        style={{
          position: 'absolute', left: -3, top: 0, bottom: 0, width: 6,
          cursor: 'col-resize', zIndex: 10
        }}
      />
      <div className="comments-drawer-header">
        <div className="comments-drawer-title">
          <span className="comments-icon">💬</span>
          <span>Review Comments</span>
          <span className="comments-filename-tag">{activeFile}</span>
        </div>
        <div className="comments-header-actions">
          <div className="comments-filter-pills">
            <button
              className={`comments-filter-pill ${filter === 'open' ? 'active' : ''}`}
              onClick={() => setFilter('open')}
            >
              Open ({comments.filter((c) => !c.resolved).length})
            </button>
            <button
              className={`comments-filter-pill ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All ({comments.length})
            </button>
          </div>
          <button className="output-action-btn" onClick={onClose} title="Close drawer">
            ✕
          </button>
        </div>
      </div>

      {/* Add new comment section */}
      <form className="comments-add-box" onSubmit={handleAddComment}>
        <div className="comments-add-row">
          <span className="comments-line-label">Line:</span>
          <input
            type="number"
            min={1}
            className="comments-line-input"
            value={newLine}
            onChange={(e) => setNewLine(Math.max(1, parseInt(e.target.value) || 1))}
          />
          <input
            type="text"
            className="comments-text-input"
            placeholder="Add inline note, question or code review..."
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
          />
          <button type="submit" className="comments-post-btn" disabled={!newText.trim()}>
            Post
          </button>
        </div>
      </form>

      {/* Comments list */}
      <div className="comments-list-scroll">
        {filteredComments.length === 0 ? (
          <div className="comments-empty-state">
            {filter === 'open'
              ? 'No unresolved comments on this file.'
              : 'No comments created on this file yet.'}
          </div>
        ) : (
          filteredComments.map((c) => (
            <div key={c.id} className={`comment-card ${c.resolved ? 'resolved' : ''}`}>
              <div className="comment-card-top">
                <div className="comment-author-info">
                  <span
                    className="user-badge"
                    style={{
                      color: c.authorColor,
                      borderColor: `${c.authorColor}40`,
                      backgroundColor: `${c.authorColor}15`,
                    }}
                  >
                    {c.authorName}
                  </span>
                  <button
                    className="comment-line-badge"
                    title={`Jump to line ${c.line}`}
                    onClick={() => onJumpToLine?.(c.line)}
                  >
                    Line {c.line} ↗
                  </button>
                </div>
                <div className="comment-actions">
                  <button
                    className={`comment-resolve-btn ${c.resolved ? 'is-resolved' : ''}`}
                    onClick={() => resolveComment(c.id, !c.resolved)}
                    title={c.resolved ? 'Reopen comment' : 'Mark as resolved'}
                  >
                    {c.resolved ? 'Reopen' : '✓ Resolve'}
                  </button>
                  <button
                    className="comment-delete-btn"
                    onClick={() => deleteComment(c.id)}
                    title="Delete thread"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="comment-card-body">{c.text}</div>

              <div className="comment-card-time">
                {new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>

              {/* Replies */}
              {c.replies && c.replies.length > 0 && (
                <div className="comment-replies">
                  {c.replies.map((r) => (
                    <div key={r.id} className="comment-reply-item">
                      <div className="comment-reply-meta">
                        <span
                          className="user-badge"
                          style={{
                            color: r.authorColor,
                            borderColor: `${r.authorColor}40`,
                            backgroundColor: `${r.authorColor}15`,
                          }}
                        >
                          {r.authorName}
                        </span>
                        <span className="comment-reply-time">
                          {new Date(r.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <div className="comment-reply-text">{r.text}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Reply box */}
              <div className="comment-reply-form">
                <input
                  type="text"
                  className="comment-reply-input"
                  placeholder="Write a reply..."
                  value={replyInputs[c.id] || ''}
                  onChange={(e) =>
                    setReplyInputs((prev) => ({ ...prev, [c.id]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleReply(c.id);
                    }
                  }}
                />
                <button
                  type="button"
                  className="comment-reply-send-btn"
                  disabled={!replyInputs[c.id]?.trim()}
                  onClick={() => handleReply(c.id)}
                >
                  Reply
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
