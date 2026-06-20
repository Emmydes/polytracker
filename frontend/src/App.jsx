import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Intraday from './pages/Intraday.jsx';
import Results from './pages/Results.jsx';
import MarketDetail from './pages/MarketDetail.jsx';
import { AUTO_REFRESH_MS, STATUS_POLL_MS, getServerRefreshToken } from './utils/autoRefresh.js';

const navClass = ({ isActive }) =>
  `flex flex-col items-center justify-center gap-0.5 flex-1 py-2 text-[11px] font-medium transition-colors ${
    isActive ? 'text-accent' : 'text-gray-500'
  }`;

const desktopNavClass = ({ isActive }) =>
  `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
    isActive ? 'bg-accent text-white' : 'text-gray-400 hover:text-white hover:bg-navy'
  }`;

function NavIcon({ name, active }) {
  const stroke = active ? '#6366f1' : '#9ca3af';
  if (name === 'swing') {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.75">
        <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'daily') {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.75">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.75">
      <path d="M9 11l3 3L22 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function App() {
  const [signalsVersion, setSignalsVersion] = useState(0);
  const lastRefreshToken = useRef(null);

  const bumpSignals = useCallback(() => {
    setSignalsVersion((v) => v + 1);
  }, []);

  const pollServerUpdates = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) return;
      const data = await res.json();
      const token = getServerRefreshToken(data);
      if (lastRefreshToken.current !== null && lastRefreshToken.current !== token) {
        bumpSignals();
      }
      lastRefreshToken.current = token;
    } catch {
      /* silent */
    }
  }, [bumpSignals]);

  useEffect(() => {
    pollServerUpdates();
    const statusId = setInterval(pollServerUpdates, STATUS_POLL_MS);
    const refreshId = setInterval(bumpSignals, AUTO_REFRESH_MS);
    return () => {
      clearInterval(statusId);
      clearInterval(refreshId);
    };
  }, [pollServerUpdates, bumpSignals]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-background sticky top-0 z-20 safe-top">
        <div className="app-shell flex items-center justify-between py-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg font-display font-bold tracking-tight truncate">
              <span className="text-accent">Poly</span>Tracker
            </span>
            <span className="text-[10px] text-gray-500 hidden xs:inline truncate">Elite signals</span>
          </div>
          <nav className="hidden md:flex gap-2 shrink-0">
            <NavLink to="/" end className={desktopNavClass}>
              Swing
            </NavLink>
            <NavLink to="/today" className={desktopNavClass}>
              Daily
            </NavLink>
            <NavLink to="/results" className={desktopNavClass}>
              Results
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="flex-1 app-shell py-4 pb-24 md:pb-8">
        <Routes>
          <Route path="/" element={<Home signalsVersion={signalsVersion} />} />
          <Route path="/today" element={<Intraday signalsVersion={signalsVersion} />} />
          <Route path="/results" element={<Results />} />
          <Route path="/market/:id" element={<MarketDetail />} />
        </Routes>
      </main>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-20 border-t border-border bg-background/95 backdrop-blur safe-bottom">
        <div className="app-shell flex items-stretch">
          <NavLink to="/" end className={navClass}>
            {({ isActive }) => (
              <>
                <NavIcon name="swing" active={isActive} />
                <span>Swing</span>
              </>
            )}
          </NavLink>
          <NavLink to="/today" className={navClass}>
            {({ isActive }) => (
              <>
                <NavIcon name="daily" active={isActive} />
                <span>Daily</span>
              </>
            )}
          </NavLink>
          <NavLink to="/results" className={navClass}>
            {({ isActive }) => (
              <>
                <NavIcon name="results" active={isActive} />
                <span>Results</span>
              </>
            )}
          </NavLink>
        </div>
      </nav>

      <footer className="hidden md:block border-t border-border py-5 text-center text-xs text-gray-600">
        PolyTracker · Not financial advice · Data from Polymarket public APIs
      </footer>
    </div>
  );
}
