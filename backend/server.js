import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './db.js';
import {
  getDailyPicks,
  getIntradayPicks,
  getOpenSwingPicks,
  getOpenDailyPicks,
  getLatestIntradayDate,
  getPositionsByMarket,
  getLatestPicksDate,
  getSwingSignalStats,
  getDailySignalHistory,
  getResults,
  getResultsStats,
} from './db.js';
import {
  startScheduler,
  runManualRefreshAsync,
  getAppStatus,
  getLastUpdated,
  getRefreshState,
  getManualRefreshState,
  bootstrapIfEmpty,
} from './scheduler.js';
import { isTelegramConfigured } from './telegram.js';
import { fetchMarketByConditionId } from './polymarketApi.js';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());

getDb();

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', telegram: isTelegramConfigured() });
});

app.get('/api/picks', (req, res) => {
  try {
    const date = req.query.date || getLatestPicksDate() || new Date().toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const picks =
      date === today && !req.query.date
        ? getOpenSwingPicks()
        : getDailyPicks(date, req.query.all !== 'true');
    res.json({
      date,
      picks,
      lastUpdated: getLastUpdated(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/picks/intraday', (req, res) => {
  try {
    const date = req.query.date || getLatestIntradayDate() || new Date().toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const picks =
      date === today && !req.query.date
        ? getOpenDailyPicks()
        : getIntradayPicks(date, req.query.all !== 'true');
    res.json({
      date,
      picks,
      horizon: 'intraday',
      lastUpdated: getLastUpdated(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/signals/stats', (_req, res) => {
  try {
    res.json(getSwingSignalStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/signals/daily/history', (req, res) => {
  try {
    const days = Math.min(Number(req.query.days) || 3, 7);
    res.json(getDailySignalHistory(days));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/results', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 200);
    res.json({
      results: getResults(limit),
      stats: getResultsStats(),
      lastUpdated: getLastUpdated(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/signals/resolved', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const data = getResults(limit);
    const stats = getResultsStats();
    res.json({
      signals: data.map((row) => ({
        id: row.id,
        market_title: row.market_title,
        recommended_side: row.side,
        entry_price: row.entry_price,
        exit_price: row.exit_price,
        profit_percent: row.profit_percent,
        status: row.outcome,
        outcome: row.outcome,
        resolved_at: row.resolved_at,
        wallet: row.wallet,
      })),
      stats,
      lastUpdated: getLastUpdated(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/market/:id', async (req, res) => {
  try {
    const conditionId = req.params.id;
    const positions = getPositionsByMarket(conditionId);
    let market = null;
    try {
      market = await fetchMarketByConditionId(conditionId);
    } catch {
      /* market metadata optional */
    }
    res.json({
      conditionId,
      market,
      positions,
      eliteCount: positions.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/status', (_req, res) => {
  res.json(getAppStatus());
});

app.get('/api/refresh/status', (_req, res) => {
  res.json(getManualRefreshState());
});

app.post('/api/refresh', (req, res) => {
  let type = req.body?.type || 'swing';
  if (type === 'all' || type === 'discovery') type = 'picks';

  const state = getRefreshState();
  if (state.running && state.source === 'manual') {
    return res.status(202).json({
      accepted: true,
      alreadyRunning: true,
      message: 'Refresh already in progress.',
      type,
      ...state,
    });
  }
  const started = runManualRefreshAsync(type);
  if (!started) {
    return res.status(429).json({ error: 'Refresh could not start', ...getRefreshState() });
  }
  res.status(202).json({
    accepted: true,
    message: 'Quick refresh started — using already-scanned wallets.',
    type,
  });
});

const frontendDist = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(frontendDist, 'index.html'), (err) => {
    if (err) next();
  });
});

app.listen(PORT, () => {
  console.log(`PolyTracker API running on http://localhost:${PORT}`);
  startScheduler();
  bootstrapIfEmpty().catch((err) => console.error('Bootstrap error:', err.message));
});
