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

async function pollRefreshStatus(maxWait = 90 * 1000) {
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, 500));
    const res = await fetch('/api/refresh/status');
    const status = await res.json();
    if (!status.running) {
      if (status.error) throw new Error(status.error);
      return status.results;
    }
  }
  throw new Error('Refresh timed out — try again in a moment');
}

export default function App() {
  const location = useLocation();
  const [refreshing, setRefreshing] = useState(false);
  const [signalsVersion, setSignalsVersion] = useState(0);
  const lastCounts = useRef({ picks: null, intraday: null });
  const isRefreshingRef = useRef(false);

  const pollAppStatus = useCallback(async () => {
    if (isRefreshingRef.current) return;

    try {
      const res = await fetch('/api/status');
      if (!res.ok) return;
      const data = await res.json();

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
    const id = setInterval(pollAppStatus, 5000);
    return () => clearInterval(id);
  }, [pollAppStatus]);

  const handleRefresh = useCallback(async () => {
    isRefreshingRef.current = true;
    setRefreshing(true);
    try {
      const onToday = location.pathname === '/today';
      const refreshType = onToday ? 'intraday' : 'swing';

      const res = await fetch('/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: refreshType }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 202 && (data.accepted || data.alreadyRunning)) {
        await pollRefreshStatus(90 * 1000);
      } else if (!res.ok) {
        throw new Error(data.error || 'Refresh failed to start');
      }

      setSignalsVersion((v) => v + 1);
      await pollAppStatus();
    } catch (err) {
      console.error(err.message);
      setSignalsVersion((v) => v + 1);
    } finally {
      isRefreshingRef.current = false;
      setRefreshing(false);
    }
  }, [location.pathname, pollAppStatus]);

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
        <Routes>
          <Route
            path="/"
            element={
              <Home
                onRefresh={handleRefresh}
                refreshing={refreshing}
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
