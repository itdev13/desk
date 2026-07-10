import React, { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../lib/api.js';
import { ago, slaDisplay } from '../lib/format.js';
import { PriorityPill, Avatar } from '../components/ui.jsx';
import { STATUS_LABEL } from '../lib/format.js';
import { useAutoRefresh } from '../lib/useAutoRefresh.js';

/**
 * Kanban board — the visual the idea-board comments asked for most. Tickets bucketed by status
 * column. Moving a card to another column changes its status (the same lifecycle as the queue).
 */
export default function Board({ onOpen }) {
  const [board, setBoard] = useState({});
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null); // column currently hovered while dragging
  const draggedRef = useRef(false); // true when a real drag happened, to suppress the trailing click

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const res = await api.board();
      setBoard(res.board || {});
      setColumns(res.columns || []);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  // Don't poll mid-drag (would fight the optimistic move); otherwise poll + focus refresh.
  useAutoRefresh(useCallback(() => { if (!dragId) load({ silent: true }); }, [load, dragId]));

  const drop = async (status) => {
    const id = dragId;
    setOverCol(null);
    setDragId(null);
    if (!id) return;

    // Find the card and its current column; no-op if dropped in the same column.
    let from = null, card = null;
    for (const [col, list] of Object.entries(board)) {
      const found = (list || []).find((t) => t._id === id);
      if (found) { from = col; card = found; break; }
    }
    if (!card || from === status) return;

    // Optimistic move: update UI immediately so the card visibly jumps to the new column,
    // then confirm with the API in the background (revert on failure).
    setBoard((b) => ({
      ...b,
      [from]: (b[from] || []).filter((t) => t._id !== id),
      [status]: [{ ...card, status }, ...(b[status] || [])]
    }));
    try {
      await api.setStatus(id, status);
      load({ silent: true });
    } catch {
      load(); // revert to server truth
    }
  };

  return (
    <>
      <div className="topbar"><h1>Board</h1><span className="sub">Drag a ticket to change its status</span></div>
      <div className="page">
        {loading ? (
          <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div>
        ) : (
          <div className="board">
            {columns.map((status) => (
              <div
                key={status}
                className={`col ${overCol === status && dragId ? 'drag-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); if (overCol !== status) setOverCol(status); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOverCol((c) => (c === status ? null : c)); }}
                onDrop={() => drop(status)}
              >
                <div className="col-head">
                  <span className="ct">{STATUS_LABEL[status]}</span>
                  <span className="col-count">{(board[status] || []).length}</span>
                </div>
                <div className="col-body">
                  {(board[status] || []).map((t) => {
                    const sla = slaDisplay(t);
                    return (
                      <div
                        key={t._id}
                        className={`kcard ${dragId === t._id ? 'dragging' : ''}`}
                        draggable
                        onDragStart={(e) => { draggedRef.current = true; setDragId(t._id); e.dataTransfer.effectAllowed = 'move'; }}
                        onDragEnd={() => { setDragId(null); setOverCol(null); setTimeout(() => { draggedRef.current = false; }, 0); }}
                        onClick={() => { if (!draggedRef.current) onOpen(t._id); }}
                      >
                        <div className="kref">{t.ref}</div>
                        <div className="ksub">{t.subject}</div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                          <PriorityPill priority={t.priority} />
                          {t.assigneeName ? <Avatar name={t.assigneeName} size={24} /> : null}
                        </div>
                        <div className={`sla ${sla.tone}`} style={{ marginTop: 8, fontSize: 11 }}>{sla.text} {sla.sub && `· ${sla.sub}`}</div>
                        <div style={{ fontSize: 11, color: 'var(--slate)', marginTop: 4 }}>{t.contactName || 'Unknown'} · {ago(t.lastActivityAt)}</div>
                      </div>
                    );
                  })}
                  {(board[status] || []).length === 0 && <div style={{ color: 'var(--slate-2)', fontSize: 12, textAlign: 'center', padding: 20 }}>Empty</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
