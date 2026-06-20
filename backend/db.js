import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { filterEnterablePicks } from './pickFilters.js';
import {
  normalizeSwingPickForDisplay,
  normalizeDailyPickForDisplay,
} from './pickDisplay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'polytracker.db');

let db;

function ensureDbDirectory() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created database directory: ${dir}`);
  }
}

export function getDbPath() {
  return DB_PATH;
}

export function getDb() {
  if (!db) {
    ensureDbDirectory();
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initSchema(db);
    migrateSchema(db);
  }
  return db;
}

function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS elite_traders (
      address TEXT PRIMARY KEY,
      win_rate REAL,
      total_profit REAL,
      total_trades INTEGER,
      resolved_trades INTEGER,
      trading_days_30 INTEGER,
      last_10_win_rate REAL,
      is_cooling_off INTEGER DEFAULT 0,
      last_fetched INTEGER
    );

    CREATE TABLE IF NOT EXISTS wallet_stats (
      wallet TEXT PRIMARY KEY,
      win_rate REAL,
      total_resolved INTEGER,
      avg_roi REAL,
      last_checked INTEGER,
      status TEXT DEFAULT 'ACTIVE'
    );

    CREATE TABLE IF NOT EXISTS daily_picks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      market_id TEXT,
      market_title TEXT,
      recommended_side TEXT,
      current_price REAL,
      entry_price REAL,
      drift_pct REAL,
      potential_return REAL,
      is_late_entry INTEGER DEFAULT 0,
      is_best_value INTEGER DEFAULT 0,
      elite_trader_count INTEGER,
      avg_win_rate REAL,
      liquidity REAL,
      market_url TEXT,
      close_date TEXT,
      coordination_flag INTEGER DEFAULT 0,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS trader_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT,
      condition_id TEXT,
      market_title TEXT,
      side TEXT,
      size REAL,
      avg_price REAL,
      entry_timestamp INTEGER,
      token_id TEXT,
      fetched_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS intraday_picks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      market_id TEXT,
      market_title TEXT,
      recommended_side TEXT,
      current_price REAL,
      entry_price REAL,
      drift_pct REAL,
      potential_return REAL,
      is_late_entry INTEGER DEFAULT 0,
      is_best_value INTEGER DEFAULT 0,
      elite_trader_count INTEGER,
      avg_win_rate REAL,
      liquidity REAL,
      market_url TEXT,
      close_date TEXT,
      hours_until_close REAL,
      coordination_flag INTEGER DEFAULT 0,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS curated_wallets (
      address TEXT PRIMARY KEY,
      win_rate REAL,
      resolved_trades INTEGER,
      total_trades INTEGER,
      total_profit REAL,
      source TEXT DEFAULT 'curated',
      added_at INTEGER,
      notes TEXT
    );
  `);
}

function migrateSchema(database) {
  const dailyCols = [
    ['entry_window_close', 'INTEGER'],
    ['status', "TEXT DEFAULT 'ACTIVE'"],
    ['resolved_at', 'INTEGER'],
    ['outcome', 'TEXT'],
    ['confidence', 'REAL'],
    ['strength', 'TEXT'],
    ['token_id', 'TEXT'],
    ['signal_date', 'TEXT'],
  ];
  for (const [col, type] of dailyCols) {
    try {
      database.exec(`ALTER TABLE daily_picks ADD COLUMN ${col} ${type}`);
    } catch {
      /* column exists */
    }
  }

  const intradayCols = [
    ['entry_window_close', 'INTEGER'],
    ['status', "TEXT DEFAULT 'ACTIVE'"],
    ['resolved_at', 'INTEGER'],
    ['outcome', 'TEXT'],
    ['confidence', 'REAL'],
    ['strength', 'TEXT'],
    ['token_id', 'TEXT'],
    ['signal_date', 'TEXT'],
  ];
  for (const [col, type] of intradayCols) {
    try {
      database.exec(`ALTER TABLE intraday_picks ADD COLUMN ${col} ${type}`);
    } catch {
      /* column exists */
    }
  }

  database.exec(`
    UPDATE daily_picks SET status = 'ACTIVE' WHERE status IS NULL;
    UPDATE intraday_picks SET status = 'ACTIVE' WHERE status IS NULL;
    UPDATE daily_picks SET signal_date = date WHERE signal_date IS NULL;
    UPDATE intraday_picks SET signal_date = date WHERE signal_date IS NULL;
    INSERT OR IGNORE INTO wallet_stats (wallet, win_rate, total_resolved, avg_roi, last_checked, status)
    SELECT address, win_rate, resolved_trades, 0, last_fetched, 'ACTIVE'
    FROM elite_traders WHERE is_cooling_off = 0;
  `);
}

export function upsertEliteTrader(trader) {
  const stmt = getDb().prepare(`
    INSERT INTO elite_traders (
      address, win_rate, total_profit, total_trades, resolved_trades,
      trading_days_30, last_10_win_rate, is_cooling_off, last_fetched
    ) VALUES (
      @address, @win_rate, @total_profit, @total_trades, @resolved_trades,
      @trading_days_30, @last_10_win_rate, @is_cooling_off, @last_fetched
    )
    ON CONFLICT(address) DO UPDATE SET
      win_rate = excluded.win_rate,
      total_profit = excluded.total_profit,
      total_trades = excluded.total_trades,
      resolved_trades = excluded.resolved_trades,
      trading_days_30 = excluded.trading_days_30,
      last_10_win_rate = excluded.last_10_win_rate,
      is_cooling_off = excluded.is_cooling_off,
      last_fetched = excluded.last_fetched
  `);
  return stmt.run(trader);
}

export function upsertWalletStats(stats) {
  return getDb()
    .prepare(`
      INSERT INTO wallet_stats (wallet, win_rate, total_resolved, avg_roi, last_checked, status)
      VALUES (@wallet, @win_rate, @total_resolved, @avg_roi, @last_checked, @status)
      ON CONFLICT(wallet) DO UPDATE SET
        win_rate = excluded.win_rate,
        total_resolved = excluded.total_resolved,
        avg_roi = excluded.avg_roi,
        last_checked = excluded.last_checked,
        status = excluded.status
    `)
    .run(stats);
}

export function getWalletStats(wallet) {
  return getDb().prepare('SELECT * FROM wallet_stats WHERE wallet = ?').get(wallet);
}

export function getActiveWalletCount() {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM wallet_stats WHERE status = 'ACTIVE'")
    .get();
  return row?.n ?? 0;
}

export function getEliteTraders(includeCoolingOff = true) {
  const sql = includeCoolingOff
    ? 'SELECT * FROM elite_traders ORDER BY total_profit DESC'
    : 'SELECT * FROM elite_traders WHERE is_cooling_off = 0 ORDER BY total_profit DESC';
  return getDb().prepare(sql).all();
}

/** Active tracked wallets for signal generation (excludes DEGRADED). */
export function getActiveTrackedWallets() {
  const joined = getDb()
    .prepare(`
      SELECT et.*
      FROM elite_traders et
      INNER JOIN wallet_stats ws ON LOWER(et.address) = LOWER(ws.wallet)
      WHERE ws.status = 'ACTIVE' AND et.is_cooling_off = 0
      ORDER BY et.total_profit DESC
    `)
    .all();

  if (joined.length > 0) return joined;

  return getDb()
    .prepare('SELECT * FROM elite_traders WHERE is_cooling_off = 0 ORDER BY total_profit DESC')
    .all();
}

export function getEliteTrader(address) {
  return getDb().prepare('SELECT * FROM elite_traders WHERE address = ?').get(address);
}

export function getCachedTrader(address, maxAgeSeconds = 6 * 3600) {
  const trader = getEliteTrader(address);
  if (!trader) return null;
  const age = Math.floor(Date.now() / 1000) - trader.last_fetched;
  if (age > maxAgeSeconds) return null;
  return trader;
}

export function clearEliteTraders() {
  getDb().prepare('DELETE FROM elite_traders').run();
}

const SWING_PICK_COLUMNS = `
  date, signal_date, market_id, market_title, recommended_side, current_price,
  entry_price, drift_pct, potential_return, is_late_entry, is_best_value,
  elite_trader_count, avg_win_rate, liquidity, market_url, close_date,
  coordination_flag, created_at, entry_window_close, status, confidence, strength, token_id
`;

export function saveDailyPicks(date, picks) {
  const dbConn = getDb();
  const existingActive = dbConn
    .prepare(
      "SELECT id, market_id, recommended_side FROM daily_picks WHERE date = ? AND status = 'ACTIVE'"
    )
    .all(date);
  const activeKeys = new Set(existingActive.map((r) => `${r.market_id}:${r.recommended_side}`));

  const insertStmt = dbConn.prepare(`
    INSERT INTO daily_picks (${SWING_PICK_COLUMNS})
    VALUES (
      @date, @signal_date, @market_id, @market_title, @recommended_side, @current_price,
      @entry_price, @drift_pct, @potential_return, @is_late_entry, @is_best_value,
      @elite_trader_count, @avg_win_rate, @liquidity, @market_url, @close_date,
      @coordination_flag, @created_at, @entry_window_close, @status, @confidence, @strength, @token_id
    )
  `);

  const updateStmt = dbConn.prepare(`
    UPDATE daily_picks SET
      current_price = @current_price, entry_price = @entry_price, drift_pct = @drift_pct,
      potential_return = @potential_return, is_late_entry = @is_late_entry,
      is_best_value = @is_best_value, elite_trader_count = @elite_trader_count,
      avg_win_rate = @avg_win_rate, liquidity = @liquidity, market_url = @market_url,
      close_date = @close_date, coordination_flag = @coordination_flag,
      confidence = @confidence, strength = @strength, token_id = @token_id,
      created_at = @created_at
    WHERE id = @id
  `);

  const tx = dbConn.transaction(() => {
    for (const pick of picks) {
      const key = `${pick.market_id}:${pick.recommended_side}`;
      const row = existingActive.find(
        (r) => `${r.market_id}:${r.recommended_side}` === key
      );
      const payload = {
        ...pick,
        date,
        signal_date: pick.signal_date ?? date,
        status: pick.status ?? 'ACTIVE',
        entry_window_close: pick.entry_window_close ?? null,
      };
      if (row) {
        updateStmt.run({ ...payload, id: row.id });
      } else if (!activeKeys.has(key)) {
        insertStmt.run(payload);
        activeKeys.add(key);
      }
    }
  });
  tx();
}

export function getDailyPicks(date, activeOnly = false) {
  const sql = activeOnly
    ? "SELECT * FROM daily_picks WHERE date = ? AND status = 'ACTIVE' ORDER BY confidence DESC, elite_trader_count DESC"
    : 'SELECT * FROM daily_picks WHERE date = ? ORDER BY elite_trader_count DESC, avg_win_rate DESC';
  return getDb().prepare(sql).all(date);
}

export function getActiveSwingSignals() {
  return getDb()
    .prepare(`
      SELECT * FROM daily_picks
      WHERE status IN ('ACTIVE', 'EXPIRED')
        AND COALESCE(outcome, '') NOT IN ('WON', 'LOST')
      ORDER BY created_at DESC
    `)
    .all();
}

export function updateSwingSignal(id, fields) {
  const allowed = [
    'status', 'entry_window_close', 'current_price', 'drift_pct',
    'outcome', 'resolved_at',
  ];
  const sets = [];
  const params = { id };
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = @${key}`);
      params[key] = fields[key];
    }
  }
  if (sets.length === 0) return;
  getDb().prepare(`UPDATE daily_picks SET ${sets.join(', ')} WHERE id = @id`).run(params);
}

export function getLatestPicksDate() {
  const row = getDb()
    .prepare("SELECT date FROM daily_picks WHERE status = 'ACTIVE' ORDER BY date DESC LIMIT 1")
    .get();
  if (row?.date) return row.date;
  const fallback = getDb().prepare('SELECT date FROM daily_picks ORDER BY date DESC LIMIT 1').get();
  return fallback?.date ?? null;
}

export function reviveOpenSwingPicks() {
  getDb()
    .prepare(`
      UPDATE daily_picks
      SET status = 'ACTIVE', entry_window_close = NULL, outcome = NULL
      WHERE status = 'EXPIRED'
        AND COALESCE(outcome, '') NOT IN ('WON', 'LOST')
        AND (
          close_date IS NULL
          OR close_date = ''
          OR julianday(replace(substr(close_date, 1, 19), 'T', ' ')) > julianday('now')
          OR (hours_until_close IS NOT NULL AND hours_until_close > 0)
        )
    `)
    .run();
}

export function getOpenSwingPicks() {
  reviveOpenSwingPicks();
  return getDb()
    .prepare(`
      SELECT * FROM daily_picks
      WHERE status IN ('ACTIVE', 'EXPIRED')
        AND COALESCE(outcome, '') NOT IN ('WON', 'LOST')
      ORDER BY created_at DESC, confidence DESC
    `)
    .all()
    .map(normalizeSwingPickForDisplay);
}

export function getTodaysPicks() {
  const today = new Date().toISOString().slice(0, 10);
  let picks = getDailyPicks(today, true);
  if (picks.length === 0) {
    const latest = getLatestPicksDate();
    if (latest) picks = getDailyPicks(latest, true);
  }
  return filterEnterablePicks(picks);
}

export function getSwingSignalStats() {
  const rows = getDb()
    .prepare(`
      SELECT strength, status, outcome, potential_return, entry_price, current_price
      FROM daily_picks
      WHERE status IN ('WON', 'LOST')
    `)
    .all();

  const won = rows.filter((r) => r.status === 'WON' || r.outcome === 'WON').length;
  const lost = rows.filter((r) => r.status === 'LOST' || r.outcome === 'LOST').length;
  const decided = won + lost;

  let roiSum = 0;
  let roiCount = 0;
  for (const r of rows) {
    const entry = r.entry_price ?? 0;
    const exit = r.status === 'WON' ? 1 : 0;
    if (entry > 0) {
      roiSum += (exit - entry) / entry;
      roiCount++;
    }
  }

  const byStrength = {};
  for (const tier of ['STRONG', 'MODERATE', 'WEAK']) {
    const tierRows = rows.filter((r) => (r.strength ?? 'MODERATE') === tier);
    const tWon = tierRows.filter((r) => r.status === 'WON').length;
    const tLost = tierRows.filter((r) => r.status === 'LOST').length;
    const tDec = tWon + tLost;
    byStrength[tier] = {
      total: tierRows.length,
      win_rate: tDec > 0 ? tWon / tDec : 0,
    };
  }

  return {
    total: rows.length,
    won,
    lost,
    win_rate: decided > 0 ? won / decided : 0,
    avg_roi: roiCount > 0 ? roiSum / roiCount : 0,
    by_strength: byStrength,
  };
}

export function upsertTraderPositions(address, positions) {
  const dbConn = getDb();
  const deleteStmt = dbConn.prepare('DELETE FROM trader_positions WHERE address = ?');
  const insertStmt = dbConn.prepare(`
    INSERT INTO trader_positions (
      address, condition_id, market_title, side, size, avg_price,
      entry_timestamp, token_id, fetched_at
    ) VALUES (
      @address, @condition_id, @market_title, @side, @size, @avg_price,
      @entry_timestamp, @token_id, @fetched_at
    )
  `);

  const tx = dbConn.transaction(() => {
    deleteStmt.run(address);
    for (const pos of positions) {
      insertStmt.run({ address, ...pos });
    }
  });
  tx();
}

export function getPositionsByMarket(conditionId) {
  return getDb()
    .prepare(`
      SELECT tp.*, et.win_rate, et.total_profit, et.is_cooling_off, ws.status AS wallet_status
      FROM trader_positions tp
      JOIN elite_traders et ON tp.address = et.address
      LEFT JOIN wallet_stats ws ON LOWER(tp.address) = LOWER(ws.wallet)
      WHERE tp.condition_id = ?
        AND (ws.status IS NULL OR ws.status = 'ACTIVE')
      ORDER BY tp.size DESC
    `)
    .all(conditionId);
}

export function getPositionsForTrader(address) {
  return getDb()
    .prepare('SELECT * FROM trader_positions WHERE address = ? ORDER BY size DESC')
    .all(address);
}

const DAILY_PICK_COLUMNS = `
  date, signal_date, market_id, market_title, recommended_side, current_price,
  entry_price, drift_pct, potential_return, is_late_entry, is_best_value,
  elite_trader_count, avg_win_rate, liquidity, market_url, close_date,
  hours_until_close, coordination_flag, created_at, entry_window_close, status,
  confidence, strength, token_id
`;

export function saveIntradayPicks(date, picks) {
  const dbConn = getDb();
  const existingActive = dbConn
    .prepare(
      "SELECT id, market_id, recommended_side FROM intraday_picks WHERE signal_date = ? AND status = 'ACTIVE'"
    )
    .all(date);

  const insertStmt = dbConn.prepare(`
    INSERT INTO intraday_picks (${DAILY_PICK_COLUMNS})
    VALUES (
      @date, @signal_date, @market_id, @market_title, @recommended_side, @current_price,
      @entry_price, @drift_pct, @potential_return, @is_late_entry, @is_best_value,
      @elite_trader_count, @avg_win_rate, @liquidity, @market_url, @close_date,
      @hours_until_close, @coordination_flag, @created_at, @entry_window_close, @status,
      @confidence, @strength, @token_id
    )
  `);

  const updateStmt = dbConn.prepare(`
    UPDATE intraday_picks SET
      current_price = @current_price, drift_pct = @drift_pct, potential_return = @potential_return,
      elite_trader_count = @elite_trader_count, confidence = @confidence, strength = @strength,
      hours_until_close = @hours_until_close, created_at = @created_at
    WHERE id = @id
  `);

  const tx = dbConn.transaction(() => {
    for (const pick of picks) {
      const row = existingActive.find(
        (r) => r.market_id === pick.market_id && r.recommended_side === pick.recommended_side
      );
      const payload = {
        ...pick,
        date,
        signal_date: pick.signal_date ?? date,
        status: pick.status ?? 'ACTIVE',
        entry_window_close: pick.entry_window_close ?? null,
      };
      if (row) {
        updateStmt.run({ ...payload, id: row.id });
      } else {
        insertStmt.run(payload);
      }
    }
  });
  tx();
}

export function getIntradayPicks(date, activeOnly = false) {
  const sql = activeOnly
    ? "SELECT * FROM intraday_picks WHERE signal_date = ? AND status = 'ACTIVE' ORDER BY confidence DESC, hours_until_close ASC"
    : 'SELECT * FROM intraday_picks WHERE signal_date = ? ORDER BY hours_until_close ASC, elite_trader_count DESC';
  return getDb().prepare(sql).all(date);
}

export function getActiveDailySignals() {
  return getDb()
    .prepare(`
      SELECT * FROM intraday_picks
      WHERE status IN ('ACTIVE', 'EXPIRED')
        AND COALESCE(outcome, '') NOT IN ('WON', 'LOST')
      ORDER BY created_at DESC
    `)
    .all();
}

export function updateDailySignal(id, fields) {
  const allowed = [
    'status', 'entry_window_close', 'current_price', 'drift_pct',
    'outcome', 'resolved_at', 'hours_until_close',
  ];
  const sets = [];
  const params = { id };
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = @${key}`);
      params[key] = fields[key];
    }
  }
  if (sets.length === 0) return;
  getDb().prepare(`UPDATE intraday_picks SET ${sets.join(', ')} WHERE id = @id`).run(params);
}

export function getLatestIntradayDate() {
  const row = getDb()
    .prepare("SELECT signal_date FROM intraday_picks WHERE status = 'ACTIVE' ORDER BY signal_date DESC LIMIT 1")
    .get();
  if (row?.signal_date) return row.signal_date;
  const fallback = getDb().prepare('SELECT signal_date FROM intraday_picks ORDER BY signal_date DESC LIMIT 1').get();
  return fallback?.signal_date ?? null;
}

export function getOpenDailyPicks() {
  return getDb()
    .prepare(`
      SELECT * FROM intraday_picks
      WHERE status IN ('ACTIVE', 'EXPIRED')
        AND COALESCE(outcome, '') NOT IN ('WON', 'LOST')
      ORDER BY created_at DESC, confidence DESC
    `)
    .all()
    .map(normalizeDailyPickForDisplay);
}

export function getTodaysIntradayPicks() {
  const today = new Date().toISOString().slice(0, 10);
  let picks = getIntradayPicks(today, true);
  if (picks.length === 0) {
    const latest = getLatestIntradayDate();
    if (latest) picks = getIntradayPicks(latest, true);
  }
  return filterEnterablePicks(picks);
}

export function getResolvedSignals(horizon = 'all', limit = 50, decidedOnly = false) {
  const out = [];
  const statusFilter = decidedOnly
    ? "(status IN ('WON', 'LOST') OR outcome IN ('WON', 'LOST'))"
    : "(status IN ('WON', 'LOST', 'EXPIRED') OR outcome IN ('WON', 'LOST', 'EXPIRED'))";

  if (horizon === 'all' || horizon === 'swing') {
    out.push(
      ...getDb()
        .prepare(`
          SELECT *, 'swing' AS horizon FROM daily_picks
          WHERE ${statusFilter}
          ORDER BY COALESCE(resolved_at, created_at) DESC
          LIMIT ?
        `)
        .all(limit)
    );
  }

  if (horizon === 'all' || horizon === 'intraday' || horizon === 'daily') {
    out.push(
      ...getDb()
        .prepare(`
          SELECT *, 'intraday' AS horizon FROM intraday_picks
          WHERE ${statusFilter}
          ORDER BY COALESCE(resolved_at, created_at) DESC
          LIMIT ?
        `)
        .all(limit)
    );
  }

  const normalized = out.map((row) => ({
    ...row,
    status:
      row.status === 'WON' || row.status === 'LOST'
        ? row.status
        : row.outcome === 'WON' || row.outcome === 'LOST'
          ? row.outcome
          : row.status,
  }));

  normalized.sort(
    (a, b) => (b.resolved_at ?? b.created_at ?? 0) - (a.resolved_at ?? a.created_at ?? 0)
  );
  return normalized
    .filter((row) => !decidedOnly || row.status === 'WON' || row.status === 'LOST')
    .slice(0, limit);
}

export function getDailySignalHistory(days = 3) {
  const rows = getDb()
    .prepare(`
      SELECT DISTINCT signal_date AS date FROM intraday_picks
      WHERE signal_date IS NOT NULL
      ORDER BY signal_date DESC
      LIMIT ?
    `)
    .all(days);

  return rows.map(({ date }) => {
    const signals = getIntradayPicks(date, false);
    const won = signals.filter((s) => s.status === 'WON' || s.outcome === 'WON').length;
    const lost = signals.filter((s) => s.status === 'LOST' || s.outcome === 'LOST').length;
    const pending = signals.filter((s) => s.status === 'ACTIVE' || s.status === 'EXPIRED').length;
    const decided = won + lost;
    return {
      date,
      signals,
      win_rate: decided > 0 ? won / decided : 0,
      won,
      lost,
      pending,
    };
  });
}

export function setMeta(key, value) {
  getDb()
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

export function getMeta(key) {
  const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row?.value ?? null;
}

export function upsertCuratedWallet(wallet) {
  const now = Math.floor(Date.now() / 1000);
  getDb()
    .prepare(`
      INSERT INTO curated_wallets (
        address, win_rate, resolved_trades, total_trades, total_profit, source, added_at, notes
      ) VALUES (
        @address, @win_rate, @resolved_trades, @total_trades, @total_profit, @source, @added_at, @notes
      )
      ON CONFLICT(address) DO UPDATE SET
        win_rate = excluded.win_rate,
        resolved_trades = excluded.resolved_trades,
        total_trades = excluded.total_trades,
        total_profit = excluded.total_profit,
        source = excluded.source,
        notes = COALESCE(excluded.notes, curated_wallets.notes)
    `)
    .run({
      source: 'curated',
      added_at: now,
      notes: null,
      total_profit: 0,
      ...wallet,
      address: wallet.address.toLowerCase(),
    });
}

export function getCuratedWallets() {
  return getDb()
    .prepare('SELECT * FROM curated_wallets ORDER BY resolved_trades DESC, win_rate DESC')
    .all();
}

/** Seed curated_wallets table and sync elite_traders + wallet_stats for signal generation. */
export function ensureCuratedWalletsInDb(wallets) {
  const now = Math.floor(Date.now() / 1000);
  let inserted = 0;
  const curatedAddresses = new Set(wallets.map((w) => w.address.toLowerCase()));

  const tx = getDb().transaction(() => {
    const staleElite = getDb().prepare('SELECT address FROM elite_traders').all();
    for (const row of staleElite) {
      const addr = row.address.toLowerCase();
      if (!curatedAddresses.has(addr)) {
        getDb().prepare('DELETE FROM trader_positions WHERE LOWER(address) = ?').run(addr);
        getDb().prepare('DELETE FROM wallet_stats WHERE LOWER(wallet) = ?').run(addr);
        getDb().prepare('DELETE FROM elite_traders WHERE LOWER(address) = ?').run(addr);
      }
    }

    for (const w of wallets) {
      const address = w.address.toLowerCase();
      upsertCuratedWallet({ ...w, address });

      upsertEliteTrader({
        address,
        win_rate: w.win_rate,
        total_profit: w.total_profit ?? 0,
        total_trades: w.total_trades ?? w.resolved_trades,
        resolved_trades: w.resolved_trades,
        trading_days_30: w.trading_days_30 ?? 20,
        last_10_win_rate: w.last_10_win_rate ?? w.win_rate,
        is_cooling_off: 0,
        last_fetched: now,
      });

      upsertWalletStats({
        wallet: address,
        win_rate: w.win_rate,
        total_resolved: w.resolved_trades,
        avg_roi: w.avg_roi ?? 0,
        last_checked: now,
        status: 'ACTIVE',
      });
      inserted++;
    }
  });
  tx();
  return inserted;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
