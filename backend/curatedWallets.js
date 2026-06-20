/**
 * Fixed list of elite wallets — no automatic discovery.
 * Criteria: 85%+ win rate, 100+ resolved trades, sorted by volume.
 * Refresh positions only; stats are seeded from this list on startup.
 */
export const CURATED_CRITERIA = {
  minWinRate: 0.85,
  minResolvedTrades: 100,
  maxWallets: 25,
};

/** @type {Array<{ address: string, win_rate: number, resolved_trades: number, total_profit: number, total_trades: number }>} */
export const CURATED_WALLET_LIST = [
  { address: '0x8245ea0d5a476678cb354b69e136908f0757ebed', win_rate: 0.9883, resolved_trades: 600, total_trades: 600, total_profit: 0 },
  { address: '0x6ffb4354cbe6e0f9989e3b55564ec5fb8646a834', win_rate: 0.9415, resolved_trades: 600, total_trades: 600, total_profit: 0 },
  { address: '0xfb1388292ea54f8541efdd18c417a51b59075946', win_rate: 0.94, resolved_trades: 600, total_trades: 600, total_profit: 0 },
  { address: '0x134a63b764ac7b008356e8db1857db94e6b09e42', win_rate: 0.936, resolved_trades: 600, total_trades: 600, total_profit: 0 },
  { address: '0x72361923300983fc1ba06dc5798e1082917aea53', win_rate: 0.9317, resolved_trades: 600, total_trades: 600, total_profit: 0 },
  { address: '0x87da2f16cf98af9b3e2f6ba6d9c4c470815b53d1', win_rate: 0.9283, resolved_trades: 600, total_trades: 600, total_profit: 0 },
  { address: '0x21c52a310ce110d58270e2d5a9676c217a5e3533', win_rate: 0.9267, resolved_trades: 600, total_trades: 600, total_profit: 0 },
  { address: '0xf2f6af4f27ec2dcf4072095ab804016e14cd5817', win_rate: 0.9197, resolved_trades: 600, total_trades: 600, total_profit: 0 },
  { address: '0x04a53c192a3615b10466b1d64209a11cc3dfd093', win_rate: 0.9117, resolved_trades: 600, total_trades: 600, total_profit: 0 },
  { address: '0xd6966eb1ae7b52320ba7ab1016680198c9e08a49', win_rate: 0.8995, resolved_trades: 600, total_trades: 600, total_profit: 0 },
  { address: '0x9d84ce0306f8551e02efef1680475fc0f1dc1344', win_rate: 0.8883, resolved_trades: 600, total_trades: 600, total_profit: 0 },
  { address: '0xcd65c3279408a33866a9129bed6943064cb6ee96', win_rate: 0.928, resolved_trades: 378, total_trades: 378, total_profit: 0 },
  { address: '0xe16d3f2a5807999b358affd9445c3a09e45e5e30', win_rate: 0.9783, resolved_trades: 369, total_trades: 369, total_profit: 0 },
  { address: '0xc84f7e76ec28ef20e7773b7b4926bfb7378be0c5', win_rate: 0.865, resolved_trades: 241, total_trades: 241, total_profit: 0 },
  { address: '0xfb64650bccbf4804c9db00b10abb7fb205db5e23', win_rate: 0.85, resolved_trades: 240, total_trades: 240, total_profit: 0 },
  { address: '0x0c72796a4d12855bb14d83cd54071a6434f49925', win_rate: 0.9735, resolved_trades: 226, total_trades: 226, total_profit: 0 },
  { address: '0xa022ba0a68e11a78348382ff168601012d4d77f8', win_rate: 0.9064, resolved_trades: 212, total_trades: 212, total_profit: 0 },
  { address: '0xeb4b9d7d76681c8a14fb8f525cb5ba4c06a69f92', win_rate: 0.8719, resolved_trades: 203, total_trades: 203, total_profit: 0 },
  { address: '0xf3812afac2dafbc4b5a0a52b3ab1f0c3a17e8eee', win_rate: 0.9603, resolved_trades: 151, total_trades: 151, total_profit: 0 },
  { address: '0xe13aeb88f81109fa4137f5bb50e8fb73d134ee7a', win_rate: 0.9441, resolved_trades: 143, total_trades: 143, total_profit: 0 },
  { address: '0x4bff30af91642dc7d2b19a8664378fe55c45fc26', win_rate: 0.8714, resolved_trades: 140, total_trades: 140, total_profit: 0 },
  { address: '0xcdcd9ed5ae32795f91109bb48d1edcb7907f3cca', win_rate: 0.9044, resolved_trades: 138, total_trades: 138, total_profit: 0 },
  { address: '0xcfdbb918eb32cf44f345a4adec0ac011ba7f1548', win_rate: 0.8889, resolved_trades: 137, total_trades: 137, total_profit: 0 },
  { address: '0x5b1c69a0e3559bf85a7f22020a3509c3b2528895', win_rate: 0.9104, resolved_trades: 136, total_trades: 136, total_profit: 0 },
  { address: '0x6baff38cdfd473d041b21c4b737c6dd3c80ceba7', win_rate: 0.8788, resolved_trades: 136, total_trades: 136, total_profit: 0 },
];

export function isWalletDiscoveryEnabled() {
  return process.env.ENABLE_WALLET_DISCOVERY === 'true';
}

export function getCuratedWalletAddresses() {
  return CURATED_WALLET_LIST.map((w) => w.address.toLowerCase());
}
