import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export async function sendDailyPicksAlert(picks, kind = 'swing') {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log('Telegram not configured, skipping alert');
    return null;
  }

  const title = kind === 'intraday' ? '24h Intraday Picks' : 'Swing Picks';

  if (!picks || picks.length === 0) {
    return sendMessage(`🎯 PolyTracker ${title} — No high-confidence picks right now.`);
  }

  const date = picks[0]?.date ?? new Date().toISOString().slice(0, 10);
  const lines = picks.map((pick, i) => {
    const price = (pick.current_price * 100).toFixed(0);
    const liq = pick.liquidity >= 1000 ? `$${Math.round(pick.liquidity / 1000)}k` : `$${Math.round(pick.liquidity)}`;
    const close = pick.close_date ? new Date(pick.close_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'TBD';
    const late = pick.is_late_entry ? ' ⚠️ Late Entry' : '';
    const coord = pick.coordination_flag ? ' ⚠️ Coordinated' : '';
    const hours = pick.hours_until_close != null ? ` | Settles in ${pick.hours_until_close.toFixed(0)}h` : '';
    return `${i + 1}. ${pick.market_title} → ${pick.recommended_side} @ ${price}¢${late}${coord}\n   ${pick.elite_trader_count} elite traders | Liquidity: ${liq} | Closes: ${close}${hours}`;
  });

  const message = `🎯 PolyTracker ${title} — ${date}\n\n${lines.join('\n\n')}`;
  return sendMessage(message);
}

async function sendMessage(text) {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const { data } = await axios.post(url, {
      chat_id: CHAT_ID,
      text,
      disable_web_page_preview: true,
    });
    return data;
  } catch (err) {
    console.error('Telegram send failed:', err.message);
    return null;
  }
}

export function isTelegramConfigured() {
  return Boolean(BOT_TOKEN && CHAT_ID);
}
