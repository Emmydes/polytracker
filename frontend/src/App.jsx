import { useCallback, useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Intraday from './pages/Intraday.jsx';
import Results from './pages/Results.jsx';
import MarketDetail from './pages/MarketDetail.jsx';

const navClass = ({ isActive }) =>
  `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
    isActive ? 'bg-accent text-white' : 'text-gray-400 hover:text-white hover:bg-navy'
  }`;

async function pollRefreshStatus(onProgress, maxWait = 10 * 60 * 1000) {
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, 800));
    const res = await fetch('/api/refresh/status');
    const status = await res.json();
    if (status.phase) onProgress?.(status.phase);
    if (!status.running) {
      if (status.error) throw new Error(status.error);
      return status.results;
    }
  }
  throw new Error('Refresh timed out — try again in a moment');
}

function BootstrapBanner({ phase }) {
  if (!phase) return null;

  return (
    <div className="mb-6 flex items-start gap-3 p-4 bg-accent/10 border border-accent/30 rounded-[12px] text-sm">
      <svg
        className="w-5 h-5 shrink-0 text-accent animate-spin mt-0.5"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
      <div>
        <p className="font-medium text-gray-100">Initial setup in progress</p>
        <p className="text-gray-400 mt-0.5">{phase}</p>
        <p className="text-gray-500 text-xs mt-1">
          Scanning top leaderboard traders only on first deploy — usually 2–4 minutes.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const location = useLocation();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshPhase, setRefreshPhase] = useState('');
  const [bootstrapPhase, setBootstrapPhase] = useState('');

  const pollAppStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) return;
      const data = await res.json();
      const refresh = data.refresh;
      if (refresh?.running && refresh?.source === 'bootstrap') {
        setBootstrapPhase(refresh.phase || 'Starting wallet scan…');
      } else {
        setBootstrapPhase('');
      }
    } catch {
      /* optional */
    }
  }, []);

  useEffect(() => {
    pollAppStatus();
    const id = setInterval(pollAppStatus, 2000);
    return () => clearInterval(id);
  }, [pollAppStatus]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshPhase('Starting…');
    try {
      const statusRes = await fetch('/api/status');
      const statusData = await statusRes.json();
      const onToday = location.pathname === '/today';
      const refresh = statusData.refresh;

      if (refresh?.running && refresh?.source === 'bootstrap') {
        setRefreshPhase(refresh.phase || 'Initial scan in progress…');
        await pollRefreshStatus(setRefreshPhase, 12 * 60 * 1000);
        setRefreshPhase('Done');
        await pollAppStatus();
        return;
      }

      let refreshType = 'intraday';
      if (!onToday) refreshType = 'swing';
      if ((statusData.activeWalletCount ?? 0) === 0) refreshType = 'all';

      const res = await fetch('/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: refreshType }),
      });
      const data = await res.json();

      if (res.status === 202 && (data.accepted || data.alreadyRunning)) {
        const label =
          data.alreadyRunning || data.source === 'bootstrap'
            ? data.phase || 'Scan in progress…'
            : refreshType === 'all'
              ? 'Full scan (first run)…'
              : refreshType === 'intraday'
                ? 'Updating daily signals…'
                : 'Updating swing signals…';
        setRefreshPhase(label);

        const maxWait = refreshType === 'all' ? 15 * 60 * 1000 : 10 * 60 * 1000;
        const results = await pollRefreshStatus(setRefreshPhase, maxWait);
        const parts = [];
        if (results?.picksCount != null) parts.push(`${results.picksCount} swing`);
        if (results?.intradayCount != null) parts.push(`${results.intradayCount} daily`);
        if (parts.length) setRefreshPhase(`Done — ${parts.join(', ')}`);
        else setRefreshPhase('Done');
        await pollAppStatus();
        return;
      }

      if (!res.ok) throw new Error(data.error || 'Refresh failed to start');
    } catch (err) {
      setRefreshPhase(err.message);
    } finally {
      setTimeout(() => {
        setRefreshing(false);
        setRefreshPhase('');
      }, 1200);
    }
  };

  const showBootstrap = Boolean(bootstrapPhase) && !refreshing;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-xl font-display font-bold tracking-tight">
              <span className="text-accent">Poly</span>Tracker
            </span>
            <span className="text-xs text-gray-500 hidden sm:inline">Elite wallet signals</span>
          </div>
          <nav className="flex gap-2 flex-wrap">
            <NavLink to="/" end className={navClass}>
              Swing
            </NavLink>
            <NavLink to="/today" className={navClass}>
              Daily (24h)
            </NavLink>
            <NavLink to="/results" className={navClass}>
              Results
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {showBootstrap ? <BootstrapBanner phase={bootstrapPhase} /> : null}
        <Routes>
          <Route
            path="/"
            element={
              <Home onRefresh={handleRefresh} refreshing={refreshing} refreshPhase={refreshPhase} />
            }
          />
          <Route
            path="/today"
            element={
              <Intraday onRefresh={handleRefresh} refreshing={refreshing} refreshPhase={refreshPhase} />
            }
          />
          <Route path="/results" element={<Results />} />
          <Route path="/market/:id" element={<MarketDetail />} />
        </Routes>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-gray-600">
        PolyTracker · Not financial advice · Data from Polymarket public APIs
      </footer>
    </div>
  );
}
