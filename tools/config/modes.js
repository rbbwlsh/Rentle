// The two games Rentle runs: guess the RENT, or guess the ASKING PRICE.
//
// They are the same game over a different Rightmove channel, so nothing
// downstream branches on a mode string — seed, build-corpus and prerender all
// read their paths out of this one table. The client has a mirror of the
// player-facing half in client/src/engine/modes.js.
//
// Note the rent entry deliberately keeps its ORIGINAL paths: data/corpus and
// data/order.json must not move. order.json is append-only and fixes which
// listing is "today's" — renaming it would shift every player's daily.

export const MODES = {
  rent: {
    key: 'rent',
    channel: 'RES_LET',
    searchPath: 'property-to-rent/find.html',
    corpusDir: 'data/corpus',
    orderPath: 'data/order.json',
    outDir: 'client/public/data/rent',
    configPath: 'tools/config/outcodes.json',
    routePrefix: '/p',
    homePath: '/',
    browsePath: '/browse',
    noun: 'rent',
    subject: 'rental',
  },
  buy: {
    key: 'buy',
    channel: 'RES_BUY',
    searchPath: 'property-for-sale/find.html',
    corpusDir: 'data/corpus-buy',
    orderPath: 'data/order-buy.json',
    outDir: 'client/public/data/buy',
    configPath: 'tools/config/outcodes.buy.json',
    routePrefix: '/buy/p',
    homePath: '/buy',
    browsePath: '/buy/browse',
    noun: 'asking price',
    subject: 'home for sale',
  },
};

export const MODE_KEYS = Object.keys(MODES);

export function modeOf(key) {
  const mode = MODES[String(key || 'rent').toLowerCase()];
  if (!mode) {
    throw new Error(`Unknown mode "${key}" — expected one of ${MODE_KEYS.join(', ')}`);
  }
  return mode;
}
