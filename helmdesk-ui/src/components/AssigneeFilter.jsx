import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Select, Icon } from './ui.jsx';

/**
 * Shared "filter by agent" control for the ticket views (Board, Queue, Inbox).
 *
 * Admin-only — non-admins already see only their own tickets (server-enforced), so there's nothing to
 * filter. Renders a Select of the active agents plus "Unassigned". `value` is the chosen ghlUserId,
 * 'none' for unassigned, or '' for everyone; `onChange(value)` reports changes.
 *
 * Fetches the agent roster itself (cached per mount) so each view doesn't have to.
 */
export default function AssigneeFilter({ value, onChange, isAdmin }) {
  const [agents, setAgents] = useState([]);
  useEffect(() => {
    if (!isAdmin) return;
    api.agents().then((r) => setAgents(r.agents || [])).catch(() => {});
  }, [isAdmin]);

  if (!isAdmin) return null;

  const options = [
    { value: '', label: 'All agents' },
    { value: 'none', label: 'Unassigned' },
    ...agents
      .filter((a) => !a.deleted)
      .map((a) => ({ value: a.ghlUserId, label: a.name || a.email || 'Agent' }))
  ];

  return (
    <div className="assignee-filter">
      {/* title lives on the icon, not the wrapper — a wrapper-level title shows a native tooltip over
          the open dropdown's options. */}
      <span title="Filter tickets by who they're assigned to" style={{ display: 'inline-flex' }}>
        <Icon name="users" size={14} />
      </span>
      <Select value={value || ''} onChange={onChange} options={options} placeholder="All agents" searchable />
    </div>
  );
}
