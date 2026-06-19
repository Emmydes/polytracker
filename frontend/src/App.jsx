import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Intraday from './pages/Intraday.jsx';
import Results from './pages/Results.jsx';
import MarketDetail from './pages/MarketDetail.jsx';

const navClass = ({ isActive }) =>
  `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
    isActive ? 'bg-accent text-white' : 'text-gray-400 hover:text-white hover:bg-navy'
  }`;

async function pollBootstrapStatus(onProgress, maxWait = 8 * 60 * 1000) {
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, 800));
    const res = await fetch('/api/status');
    const data = await res.json();
    const refresh = data.refresh;
    if (refresh?.phase) onProgress?.(refresh.phase);
    if (!refresh?.running || refresh?.source !== 'bootstrap') {
      if (refresh?.error) throw new Error(refresh.error);
      return;
    }
  }
  throw new Error('Initial setup timed out — background scan will continue');
}

async function pollRefreshStatus(onProgress, maxWait = 60 * 1000) {
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, 400));
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

function SetupBanner({ phase, title, hint }) {
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
        <p className="font-medium text-gray-100">{title}</p>
        <p className="text-gray-400 mt-0.5">{phase}</p>
        {hint ? <p className="text-gray-500 text-xs mt-1">{hint}</p> : null}
      </div>
    </div>
  );
}

function DiscoveryBanner({ phase }) {
  if (!phase) return null;

  return (
    <div className="mb-6 flex items-center gap-3 p-3 bg-navy/60 border border-border rounded-[12px] text-sm">
      <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" />
      <div>
        <p className="text-gray-300">{phase}</p>
        <p className="text-gray-500 text-xs mt-0.5">
          New signals appear automatically. Refresh now uses already-scanned wallets (a few seconds).
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
  const [discoveryPhase, setDiscoveryPhase] = useState('');
  const [signalsVersion, setSignalsVersion] = useState(0);
  const lastCounts = useRef({ picks: null, intraday: null });

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

      const bg = data.backgroundDiscovery;
      if (bg?.running && bg?.phase) {
        setDiscoveryPhase(bg.phase);
      } else if (bg?.complete && bg?.phase) {
        setDiscoveryPhase('');
      } else {
        setDiscoveryPhase('');
      }

      const picks = data.picksCount ?? null;
      const intraday = data.intradayCount ?? null;
      if (
        lastCounts.current.picks !== null &&
        (lastCounts.current.picks !== picks || lastCounts.current.intraday !== intraday)
      ) {
        setSignalsVersion((v) => v + 1);
      }
      lastCounts.current = { picks, intraday };
    } catch {
      /* optional */
    }
  }, []);

  useEffect(() => {
    pollAppStatus();
    const id = setInterval(pollAppStatus, 3000);
    return () => clearInterval(id);
  }, [pollAppStatus]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshPhase('Refreshing…');
    try {
      const statusRes = await fetch('/api/status');
      const statusData = await statusRes.json();
      const onToday = location.pathname === '/today';
      const refresh = statusData.refresh;

      if (refresh?.running && refresh?.source === 'bootstrap') {
        setRefreshPhase(refresh.phase || 'Initial scan in progress…');
        await pollBootstrapStatus(setRefreshPhase, 8 * 60 * 1000);
        setRefreshPhase('Done');
        setSignalsVersion((v) => v + 1);
        await pollAppStatus();
        return;
      }

      const refreshType = onToday ? 'intraday' : 'swing';

      const res = await fetch('/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: refreshType }),
      });
      const data = await res.json();

      if (res.status === 202 && (data.accepted || data.alreadyRunning)) {
        setRefreshPhase(onToday ? 'Updating daily signals…' : 'Updating swing signals…');
        const results = await pollRefreshStatus(setRefreshPhase, 60 * 1000);
        const parts = [];
        if (results?.picksCount != null) parts.push(`${results.picksCount} swing`);
        if (results?.intradayCount != null) parts.push(`${results.intradayCount} daily`);
        if (parts.length) setRefreshPhase(`Done — ${parts.join(', ')}`);
        else setRefreshPhase('Done');
        setSignalsVersion((v) => v + 1);
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
      }, 800);
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
        {showBootstrap ? (
          <SetupBanner
            phase={bootstrapPhase}
            title="Initial setup in progress"
            hint="First ~60 wallets scanned for quick signals, then full scan continues in background."
          />
        ) : null}
        {!showBootstrap && discoveryPhase ? <DiscoveryBanner phase={discoveryPhase} /> : null}
        <Routes>
          <Route
            path="/"
            element={
              <Home
                onRefresh={handleRefresh}
                refreshing={refreshing}
                refreshPhase={refreshPhase}
                signalsVersion={signalsVersion}
              />
            }
          />
          <Route
            path="/today"
            element={
              <Intraday
                onRefresh={handleRefresh}
                refreshing={refreshing}
                refreshPhase={refreshPhase}
                signalsVersion={signalsVersion}
              />
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
