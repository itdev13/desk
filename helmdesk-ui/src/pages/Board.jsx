import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { ago, slaDisplay } from '../lib/format.js';
import { PriorityPill, Avatar } from '../components/ui.jsx';
import { STATUS_LABEL } from '../lib/format.js';

/**
 * Kanban board — the visual the idea-board comments asked for most. Tickets bucketed by status
 * column. Moving a card to another column changes its status (the same lifecycle as the queue).
 */
export default function Board({ onOpen }) {
  const [board, setBoard] = useState({});
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.board();
      setBoard(res.board || {});
      setColumns(res.columns || []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const drop = async (status) => {
    if (!dragId) return;
    const id = dragId;
    setDragId(null);
    // Optimistic move.
    try {
      await api.setStatus(id, status);
      load();
    } catch {
      load();
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
                className="col"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => drop(status)}
              >
                <div className="col-head">
                  <span className="ct">{STATUS_LABEL[status]}</span>
                  <span className="count" style={{ background: 'var(--line)', color: 'var(--slate)' }}>{(board[status] || []).length}</span>
                </div>
                <div className="col-body">
                  {(board[status] || []).map((t) => {
                    const sla = slaDisplay(t);
                    return (
                      <div
                        key={t._id}
                        className="kcard"
                        draggable
                        onDragStart={() => setDragId(t._id)}
                        onClick={() => onOpen(t._id)}
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
