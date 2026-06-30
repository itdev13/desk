import React, { useEffect, useState, useCallback } from 'react';
import { api, setToken } from './lib/api.js';
import { Spinner, Icon, Toast } from './components/ui.jsx';
import { LogoMark } from './components/Logo.jsx';
import SetupWizard from './pages/SetupWizard.jsx';
import Queue from './pages/Queue.jsx';
import Board from './pages/Board.jsx';
import TicketDetail from './pages/TicketDetail.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Settings from './pages/Settings.jsx';
import Team from './pages/Team.jsx';

/**
 * App root. Resolves the GHL session (SSO blob or ?locationId dev fallback), then either runs the
 * setup wizard (settings-first) or the main console. Lightweight hash-free state routing keeps the
 * iframe simple — the active view + selected ticket live in component state.
 */
export default function App() {
  const [phase, setPhase] = useState('loading'); // loading | connect | wizard | app | error
  const [workspace, setWorkspace] = useState(null);
  const [user, setUser] = useState(null);
  const [sub, setSub] = useState(null);
  const [view, setView] = useState('queue'); // queue | board | dashboard | team | settings
  const [openTicketId, setOpenTicketId] = useState(null);
  const [counts, setCounts] = useState({});
  const [toast, setToast] = useState({ message: '', error: false });
  const [errorMsg, setErrorMsg] = useState('');

  const notify = useCallback((message, error = false) => setToast({ message, error }), []);

  // Resolve the locationId: GHL posts an encrypted blob into the iframe; in dev we accept ?locationId.
  const bootstrap = useCallback(async () => {
    try {
      const params = new URLSearchParams(window.location.search);
      const devLocation = params.get('locationId');

      // Ask GHL for the encrypted user context (Custom Page SSO).
      let encryptedData = null;
      try {
        encryptedData = await requestGhlUserData();
      } catch {
        /* not embedded — dev mode */
      }

      if (!encryptedData && !devLocation) {
        setPhase('connect');
        return;
      }

      const res = await api.verify(encryptedData ? { encryptedData } : { locationId: devLocation });
      setToken(res.token);
      setWorkspace(res.workspace);
      setUser(res.user);

      api.subscription().then(setSub).catch(() => {});

      if (!res.workspace.setupComplete) setPhase('wizard');
      else {
        setPhase('app');
        refreshCounts();
      }
    } catch (err) {
      if (err.status === 403) {
        setPhase('connect');
      } else {
        setErrorMsg(err.message);
        setPhase('error');
      }
    }
  }, []);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  const refreshCounts = useCallback(async () => {
    try {
      const d = await api.dashboard();
      setCounts(d.kpis || {});
    } catch { /* ignore */ }
  }, []);

  const finishSetup = (ws) => {
    setWorkspace(ws);
    setPhase('app');
    refreshCounts();
    notify('Setup complete — HelmDesk is live.');
  };

  const goTicket = (id) => setOpenTicketId(id);
  const closeTicket = () => { setOpenTicketId(null); refreshCounts(); };

  if (phase === 'loading') return <Spinner />;
  if (phase === 'error') return <ConnectScreen title="Something went wrong" message={errorMsg} retry={bootstrap} />;
  if (phase === 'connect') return <ConnectScreen title="Connect HelmDesk" message="Install HelmDesk from the marketplace to get started." cta />;
  if (phase === 'wizard') return <SetupWizard workspace={workspace} onDone={finishSetup} notify={notify} />;

  // ── Main console ──
  return (
    <div className="shell">
      <Sidebar
        workspace={workspace}
        sub={sub}
        view={view}
        counts={counts}
        isAdmin={user?.role === 'admin'}
        onNav={(v) => { setOpenTicketId(null); setView(v); }}
      />
      <div className="main">
        {openTicketId ? (
          <TicketDetail id={openTicketId} onBack={closeTicket} user={user} notify={notify} />
        ) : view === 'queue' ? (
          <Queue onOpen={goTicket} user={user} notify={notify} onChange={refreshCounts} />
        ) : view === 'board' ? (
          <Board onOpen={goTicket} />
        ) : view === 'dashboard' ? (
          <Dashboard />
        ) : view === 'team' && user?.role === 'admin' ? (
          <Team notify={notify} />
        ) : view === 'settings' && user?.role === 'admin' ? (
          <Settings workspace={workspace} onSaved={setWorkspace} notify={notify} />
        ) : (
          // Non-admins (or unknown view) land on the queue — Settings/Team are admin-only.
          <Queue onOpen={goTicket} user={user} notify={notify} onChange={refreshCounts} />
        )}
      </div>
      <Toast message={toast.message} error={toast.error} onDone={() => setToast({ message: '', error: false })} />
    </div>
  );
}

function Sidebar({ workspace, sub, view, counts, isAdmin, onNav }) {
  const brand = workspace?.brand || { name: 'HelmDesk' };
  const items = [
    { key: 'queue', label: 'Queue', icon: 'inbox', count: counts.open },
    { key: 'board', label: 'Board', icon: 'board' },
    { key: 'dashboard', label: 'Dashboard', icon: 'chart' }
  ];
  const manage = [
    { key: 'team', label: 'Team', icon: 'users' },
    { key: 'settings', label: 'Settings', icon: 'gear' }
  ];
  return (
    <nav className="sidebar">
      <div className="ws-head">
        {(!brand.name || brand.name === 'HelmDesk')
          ? <LogoMark size={30} />
          : <div className="ws-badge" style={brand.primaryColor ? { background: brand.primaryColor } : undefined}>{brand.name[0].toUpperCase()}</div>}
        <div className="ws-name">
          {brand.name || 'HelmDesk'}
          <small>{workspace?.locationName || 'Workspace'}</small>
        </div>
      </div>

      <div className="nav-label">Support</div>
      {items.map((it) => (
        <button key={it.key} className={`nav-item ${view === it.key ? 'active' : ''}`} onClick={() => onNav(it.key)}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Icon name={it.icon} /> {it.label}</span>
          {it.count != null && <span className="count">{it.count}</span>}
        </button>
      ))}
      {counts.overdue > 0 && (
        <button className="nav-item" onClick={() => onNav('queue')} style={{ color: '#e88' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Icon name="alert" /> Overdue</span>
          <span className="count" style={{ background: '#d64545', color: '#fff' }}>{counts.overdue}</span>
        </button>
      )}

      {/* Manage section is admin-only — agents can't change Team or Settings/branding. */}
      {isAdmin && (
        <>
          <div className="nav-label">Manage</div>
          {manage.map((it) => (
            <button key={it.key} className={`nav-item ${view === it.key ? 'active' : ''}`} onClick={() => onNav(it.key)}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Icon name={it.icon} /> {it.label}</span>
            </button>
          ))}
        </>
      )}

      <div className="nav-spacer" />
      <div className="sidebar-foot">
        Plan: <span className="plan">{sub?.plan?.name || '—'}</span>
        {sub?.status === 'trialing' && ' (trial)'}
      </div>
    </nav>
  );
}

function ConnectScreen({ title, message, cta, retry }) {
  return (
    <div className="wizard-wrap">
      <div className="card" style={{ maxWidth: 440, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}><LogoMark size={48} /></div>
        <h3 style={{ fontSize: 20 }}>{title}</h3>
        <p className="muted" style={{ margin: '8px 0 20px' }}>{message}</p>
        {cta && <a className="btn btn-accent" href={api.authorizeUrl()}>Connect your account</a>}
        {retry && <button className="btn btn-ghost" onClick={retry}>Try again</button>}
      </div>
    </div>
  );
}

/**
 * Ask the GHL parent frame for the encrypted user context. GHL listens for a postMessage of
 * { message: 'REQUEST_USER_DATA' } and replies with { message: 'REQUEST_USER_DATA_RESPONSE', payload }.
 * Resolves null quickly when not embedded.
 */
function requestGhlUserData() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { window.removeEventListener('message', handler); reject(new Error('no parent')); }, 1500);
    function handler(e) {
      if (e.data?.message === 'REQUEST_USER_DATA_RESPONSE') {
        clearTimeout(timer);
        window.removeEventListener('message', handler);
        resolve(e.data.payload);
      }
    }
    window.addEventListener('message', handler);
    window.parent?.postMessage({ message: 'REQUEST_USER_DATA' }, '*');
  });
}
