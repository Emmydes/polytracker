# PolyTracker

PolyTracker monitors top-performing Polymarket traders and surfaces daily high-confidence bet recommendations based on elite trader consensus.

## Features

- **Elite trader discovery** — Filters leaderboard wallets by win rate (85%+), resolved trades (50+), profit ($500+), 30-day activity, and recency (last 10 trades)
- **Daily picks engine** — Consensus-based recommendations with manipulation guards (portfolio size, liquidity, coordinated entry detection, price drift)
- **Dashboard** — Today's picks, elite leaderboard, per-market trader breakdown
- **Scheduled jobs** — Trader discovery at midnight, picks generation at 7AM
- **Telegram alerts** — Optional daily pick notifications

## Tech Stack

- Backend: Node.js + Express
- Frontend: React + Tailwind CSS
- Database: SQLite (better-sqlite3)
- Scheduler: node-cron
- HTTP: axios

## Quick Start

### 1. Environment

```bash
cp .env.example .env
```

Edit `.env` if needed. Telegram vars are optional.

### 2. Backend

```bash
cd backend
npm install
npm start
```

API runs at `http://localhost:3001`.

### 3. Frontend (development)

```bash
cd frontend
npm install
npm run dev
```

UI at `http://localhost:5173` (proxies `/api` to backend).

### 4. Production build

```bash
cd frontend && npm run build
cd ../backend && npm start
```

The backend serves the built frontend from `frontend/dist`.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/picks` | Today's (or latest) daily picks |
| GET | `/api/traders` | Elite trader list |
| GET | `/api/market/:id` | Elite traders in a market |
| GET | `/api/status` | Last update timestamps |
| POST | `/api/refresh` | Manual discovery + picks (`{ "type": "all" \| "discovery" \| "picks" }`) |

## Cron Schedule

- **Midnight** — Fetch leaderboard, evaluate wallets, update `elite_traders`
- **7AM** — Generate daily picks with final live price check, optional Telegram alert

## Filters & Rules

### Trader Qualification
- `resolvedTrades >= 50`
- `winRate >= 0.85`
- `totalProfit >= $500`
- Active in last 30 days, 18+ trading days
- Last 10 resolved trades win rate >= 60% (otherwise "cooling off")

### Recommendation Guards
- 3+ elite traders on same market side
- Position size <= 40% of portfolio
- Market liquidity > $10,000
- Market closes in >= 48 hours
- Price between 1¢ and 89¢
- Entry drift < 25% (15–25% flagged as late entry)

## Project Structure

```
polytracker/
  backend/
    server.js
    polymarketApi.js
    traderScorer.js
    recommender.js
    db.js
    scheduler.js
    telegram.js
  frontend/
    src/
      App.jsx
      pages/
      components/
  .env.example
  README.md
```

### Data API Notes

Polymarket's public Data API uses:
- `GET /v1/leaderboard` (not `/leaderboard`) with `timePeriod=MONTH` for ~30-day rankings
- `GET /closed-positions` as fallback when `/pnl` is unavailable — stats are computed from resolved positions


This tool is for informational purposes only. Not financial advice. Polymarket trading involves risk.
