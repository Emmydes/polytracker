/** Active picks shown on Swing / Daily dashboards. */
export function isPickEnterable(pick, nowSec = Math.floor(Date.now() / 1000)) {
  if (!pick) return false;
  if (pick.status !== 'ACTIVE') return false;
  if (pick.entry_window_close != null && Number(pick.entry_window_close) <= nowSec) return false;
  return true;
}

export function filterEnterablePicks(picks) {
  return picks.filter((p) => isPickEnterable(p));
}
