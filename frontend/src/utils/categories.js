const CATEGORY_RULES = [
  {
    id: 'crypto',
    label: 'Crypto',
    keywords: [
      'bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'solana', 'sol', 'defi',
      'token', 'blockchain', 'doge', 'xrp', 'bnb', 'memecoin', 'altcoin',
    ],
  },
  {
    id: 'politics',
    label: 'Politics',
    keywords: [
      'election', 'president', 'trump', 'biden', 'congress', 'senate', 'vote',
      'governor', 'democrat', 'republican', 'primary', 'political', 'parliament',
      'mayor', 'cabinet', 'impeach', 'legislation',
    ],
  },
  {
    id: 'sports',
    label: 'Sports',
    keywords: [
      'nfl', 'nba', 'mlb', 'nhl', 'soccer', 'football', 'basketball', 'baseball',
      'tennis', 'golf', 'ufc', 'mma', 'f1', 'formula', 'championship', 'super bowl',
      'world cup', 'premier league', ' vs ', 'match', 'playoff', 'mvp',
    ],
  },
  {
    id: 'ai',
    label: 'AI',
    keywords: [
      ' ai ', 'artificial intelligence', 'openai', 'gpt', 'anthropic', 'claude',
      'llm', 'machine learning', 'deepmind', 'chatgpt', 'gemini', 'xai',
    ],
  },
  {
    id: 'science',
    label: 'Science',
    keywords: [
      'nasa', 'space', 'climate', 'vaccine', 'science', 'research', 'spacex',
      'mars', 'moon', 'fda', 'pandemic', 'virus', 'physics', 'biology',
    ],
  },
];

export const FILTER_PILLS = [
  { id: 'all', label: 'All' },
  ...CATEGORY_RULES.map(({ id, label }) => ({ id, label })),
];

export function detectCategory(title) {
  if (!title) return null;
  const lower = ` ${title.toLowerCase()} `;
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      return rule.id;
    }
  }
  return null;
}

export function enrichPick(pick) {
  return {
    ...pick,
    market_category: pick.market_category ?? detectCategory(pick.market_title),
  };
}

export function pickMatchesFilter(pick, filterId) {
  if (filterId === 'all') return true;
  return pick.market_category === filterId;
}

export function getCategoryLabel(categoryId) {
  const pill = FILTER_PILLS.find((p) => p.id === categoryId);
  return pill?.label ?? categoryId;
}
