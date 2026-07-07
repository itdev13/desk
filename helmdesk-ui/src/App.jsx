import React, { useEffect, useState, useCallback } from 'react';
import { api, setToken } from './lib/api.js';
import { Spinner, Icon, Toast } from './components/ui.jsx';
import { LogoMark } from './components/Logo.jsx';
import { useAutoRefresh } from './lib/useAutoRefresh.js';
import { initAnalytics, track, trackPageView } from './lib/analytics.js';
import SetupWizard from './pages/SetupWizard.jsx';
import Queue from './pages/Queue.jsx';
import Inbox from './pages/Inbox.jsx';
import Board from './pages/Board.jsx';
import TicketDetail from './pages/TicketDetail.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Settings from './pages/Settings.jsx';
import Team from './pages/Team.jsx';
import Support from './pages/Support.jsx';
import Plan from './pages/Plan.jsx';
import EnrollGate from './pages/EnrollGate.jsx';

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
  const [view, setView] = useState('inbox'); // inbox | queue | board | dashboard | team | settings
  const [queueView, setQueueView] = useState('open'); // which filter the Queue should show
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
      initAnalytics(res.analytics || {}); // start clickstream capture if the server has it enabled
      track('app_open', { role: res.user?.role, setupComplete: !!res.workspace?.setupComplete });

      // Resolve entitlement before routing: no active plan → the enrol gate, not the app.
      let subStatus = null;
      try { subStatus = await api.subscription(); setSub(subStatus); } catch { /* ignore */ }

      if (subStatus && subStatus.required && !subStatus.entitled) {
        setPhase('enroll');
      } else if (!res.workspace.setupComplete) {
        setPhase('wizard');
      } else {
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

  // Keep the sidebar counts (Open / Overdue) live while in the app — poll + focus refresh.
  useAutoRefresh(refreshCounts, { enabled: phase === 'app' });

  // Track navigation: a page_view whenever the active view (or ticket detail) changes.
  useEffect(() => {
    if (phase !== 'app') return;
    if (openTicketId) trackPageView('ticket_detail');
    else trackPageView(view === 'queue' && queueView === 'overdue' ? 'overdue' : view);
  }, [phase, view, queueView, openTicketId]);

  const finishSetup = (ws) => {
    setWorkspace(ws);
    setPhase('app');
    refreshCounts();
    track('setup_complete');
    notify('Setup complete — HelmDesk is live.');
  };

  const goTicket = (id) => { track('ticket_open', { id }); setOpenTicketId(id); };
  const closeTicket = () => { setOpenTicketId(null); refreshCounts(); };

  if (phase === 'loading') return <Spinner />;
  if (phase === 'error') return <ConnectScreen title="Something went wrong" message={errorMsg} retry={bootstrap} />;
  if (phase === 'connect') return <ConnectScreen title="Connect HelmDesk" message="Install HelmDesk from the marketplace to get started." cta />;
  if (phase === 'enroll') return <EnrollGate brand={workspace?.brand} notify={notify} onRetry={bootstrap} />;
  if (phase === 'wizard') return <SetupWizard workspace={workspace} onDone={finishSetup} notify={notify} />;

  // ── Main console ──
  return (
    <div className="shell">
      <TopNav
        workspace={workspace}
        sub={sub}
        view={view}
        queueView={queueView}
        counts={counts}
        isAdmin={user?.role === 'admin'}
        onNav={(v, qv) => { setOpenTicketId(null); setView(v); if (qv) setQueueView(qv); }}
      />
      <div className="main">
        {view === 'inbox' && !openTicketId ? (
          <Inbox user={user} notify={notify} onChange={refreshCounts} />
        ) : openTicketId ? (
          <TicketDetail id={openTicketId} onBack={closeTicket} user={user} notify={notify} onChange={refreshCounts} />
        ) : view === 'queue' ? (
          <Queue onOpen={goTicket} user={user} notify={notify} onChange={refreshCounts} viewOverride={queueView} />
        ) : view === 'board' ? (
          <Board onOpen={goTicket} />
        ) : view === 'dashboard' ? (
          <Dashboard />
        ) : view === 'support' ? (
          <Support notify={notify} user={user} />
        ) : view === 'plan' ? (
          <Plan notify={notify} />
        ) : view === 'team' && user?.role === 'admin' ? (
          <Team notify={notify} onNavPlan={() => setView('plan')} />
        ) : view === 'settings' && user?.role === 'admin' ? (
          <Settings workspace={workspace} onSaved={setWorkspace} notify={notify} onNavPlan={() => setView('plan')} />
        ) : (
          // Non-admins (or unknown view) land on the queue — Settings/Team are admin-only.
          <Queue onOpen={goTicket} user={user} notify={notify} onChange={refreshCounts} viewOverride={queueView} />
        )}
      </div>
      <Toast message={toast.message} error={toast.error} onDone={() => setToast({ message: '', error: false })} />
    </div>
  );
}

function TopNav({ workspace, sub, view, queueView, counts, isAdmin, onNav }) {
  const brand = workspace?.brand || { name: 'HelmDesk' };
  const tabs = [
    { key: 'inbox', label: 'Inbox', icon: 'inbox', count: counts.open },
    { key: 'queue', label: 'Queue', icon: 'filter' },
    { key: 'board', label: 'Board', icon: 'board' },
    { key: 'dashboard', label: 'Dashboard', icon: 'chart' }
  ];
  // Admin-only management tabs (Team / Settings). Support + Plan live on the far right.
  const manage = isAdmin ? [
    { key: 'team', label: 'Team', icon: 'users' },
    { key: 'settings', label: 'Settings', icon: 'gear' }
  ] : [];
  return (
    <nav className="topnav">
      <div className="topnav-brand">
        {(!brand.name || brand.name === 'HelmDesk')
          ? <LogoMark size={30} />
          : <div className="ws-badge" style={brand.primaryColor ? { background: brand.primaryColor } : undefined}>{brand.name[0].toUpperCase()}</div>}
        <div className="ws-name">
          {brand.name || 'HelmDesk'}
          <small>{workspace?.locationName || 'Workspace'}</small>
        </div>
      </div>

      <div className="topnav-tabs">
        {tabs.map((it) => {
          // The Queue tab is "active" only when we're on the queue AND not in the Overdue sub-view.
          const active = it.key === 'queue' ? (view === 'queue' && queueView !== 'overdue') : view === it.key;
          return (
            <button key={it.key} className={`nav-tab ${active ? 'active' : ''}`}
              onClick={() => onNav(it.key, it.key === 'queue' ? 'open' : undefined)}>
              <Icon name={it.icon} /> {it.label}
              {it.count != null && <span className="count">{it.count}</span>}
            </button>
          );
        })}
        {counts.overdue > 0 && (
          <button className={`nav-tab alert ${view === 'queue' && queueView === 'overdue' ? 'active' : ''}`}
            onClick={() => onNav('queue', 'overdue')}>
            <Icon name="alert" /> Overdue<span className="count">{counts.overdue}</span>
          </button>
        )}
        {manage.length > 0 && <span className="topnav-sep" />}
        {manage.map((it) => (
          <button key={it.key} className={`nav-tab ${view === it.key ? 'active' : ''}`} onClick={() => onNav(it.key)}>
            <Icon name={it.icon} /> {it.label}
          </button>
        ))}
      </div>

      <div className="topnav-right">
        <button className={`nav-tab ${view === 'support' ? 'active' : ''}`} onClick={() => onNav('support')}>
          <Icon name="lifebuoy" /> Support
        </button>
        <button className={`plan-pill ${view === 'plan' ? 'active' : ''}`} onClick={() => onNav('plan')}
          title="View plans &amp; billing">
          <span className="plan-pill-label">Plan</span>
          <span className="plan-pill-name">{(sub?.plan?.name || '—').replace(/\s*\(Trial\)\s*$/i, '')}</span>
          {sub?.status === 'trialing' && <span className="plan-pill-trial">Trial</span>}
        </button>
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
