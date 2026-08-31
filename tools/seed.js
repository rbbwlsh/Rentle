// Seed the corpus: search Rightmove around each configured outcode, then fetch
// and normalize every candidate listing into data/corpus/<id>.json.
//
// Designed to be run rarely, politely and resumably:
//   * ~1.1-1.5s sleep after every Rightmove request, retry/backoff on 429/5xx.
//   * A listing already in data/corpus/ is never re-fetched (delete the file,
//     or pass --refresh, to force). Search pages and outcode-id probes are
//     cached in data/state/, so a re-run only pays for what's missing.
//   * Three consecutive blocked-looking responses abort the run with state
//     saved — rerun later, or from a residential IP (see the README).
//
// Usage:
//   node tools/seed.js --check      preflight: is Rightmove reachable from here?
//   node tools/seed.js              full rent run from tools/config/outcodes.json
//   node tools/seed.js --mode buy   full for-sale run from outcodes.buy.json
//   node tools/seed.js --mode buy --city Leeds --limit 5   small smoke run
//   node tools/seed.js --refresh    re-fetch listings already in the corpus

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchListing, ListingError } from './lib/rightmove.js';
import { createSearchClient, isGameableProperty } from './lib/searchClient.js';
import { DiskCache } from './lib/diskCache.js';
import { modeOf } from './config/modes.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = path.join(ROOT, 'data', 'state');

// Stop the run after this many consecutive blocked/empty responses: at that
// point Rightmove is almost certainly refusing this network, not one page.
const MAX_CONSECUTIVE_FAILURES = 3;
// Over-collect candidate ids: some turn out to be let-agreed, unparseable, or
// filtered subtypes by the time the detail page is fetched.
const OVERFETCH = 1.15;
const MAX_SEARCH_PAGES = 6;
// Keep trophy assets out of the buy corpus: above this the guess stops being a
// read of the market and becomes a coin flip, and the slider loses all its
// resolution at the end where most of the corpus actually lives.
const BUY_MAX_SEARCH_PRICE = 1500000;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const politeSleep = () => sleep(1100 + Math.random() * 400);

function loadExistingCorpus(corpusDir) {
  fs.mkdirSync(corpusDir, { recursive: true });
  const byId = new Map();
  for (const f of fs.readdirSync(corpusDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const listing = JSON.parse(fs.readFileSync(path.join(corpusDir, f), 'utf8'));
      byId.set(String(listing.id), listing);
    } catch {
      /* a corrupt file just gets re-fetched */
    }
  }
  return byId;
}

function saveListing(listing, corpusDir) {
  const file = path.join(corpusDir, `${listing.id}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(listing, null, 1));
  fs.renameSync(tmp, file);
}


// Flatten a mode's config into the unit of work: one (city, outcode, bedroom
// stratum) cell with a quota. Rent cells have no bedroom filter — the rent
// corpus is a per-outcode sample; buy cells are stratified by bedroom count
// (0 = studio) because a UK-wide sale sample has to cover studios through
// 3-beds rather than whatever a city centre happens to be listing.
//
// Buy cells come back round-robined across towns, so stopping early (--limit,
// or a block) leaves a geographically even sample instead of a complete north
// and an empty south.
export function planCells(mode, config) {
  const cells = [];
  for (const [city, cfg] of Object.entries(config)) {
    if (city.startsWith('_')) continue;
    if (mode === 'rent') {
      for (const outcode of cfg.outcodes) {
        cells.push({ city, outcode, beds: null, need: cfg.perOutcode });
      }
      continue;
    }
    for (const [bedsKey, quota] of Object.entries(cfg.beds || {})) {
      const n = Number(bedsKey);
      const { outcodes } = cfg;
      for (let i = 0; i < outcodes.length; i++) {
        // Spread a town's stratum quota over its outcodes as evenly as it goes.
        const need =
          Math.floor(quota / outcodes.length) + (i < quota % outcodes.length ? 1 : 0);
        if (need > 0) cells.push({ city, outcode: outcodes[i], beds: [n, n], need });
      }
    }
  }
  return mode === 'buy' ? roundRobinByCity(cells) : cells;
}

function roundRobinByCity(cells) {
  const byCity = new Map();
  for (const c of cells) {
    if (!byCity.has(c.city)) byCity.set(c.city, []);
    byCity.get(c.city).push(c);
  }
  const queues = [...byCity.values()];
  const out = [];
  while (queues.some((q) => q.length)) {
    for (const q of queues) if (q.length) out.push(q.shift());
  }
  return out;
}

// How much of a cell's quota the corpus already covers.
function alreadyHave(corpus, cell) {
  let n = 0;
  for (const l of corpus.values()) {
    if (l.sourceOutcode !== cell.outcode) continue;
    if (cell.beds && l.bedrooms !== cell.beds[0]) continue;
    n += 1;
  }
  return n;
}

const cellLabel = (cell) =>
  cell.beds ? `${cell.outcode} ${cell.beds[0]}-bed` : cell.outcode;

const BLOCKED_HINT =
  'Rightmove appears to be blocking this network (datacenter IPs often are).\n' +
  'Progress is saved — rerun `npm run seed` later, or run the scrape from a\n' +
  'residential connection (e.g. your Mac): clone the repo, `npm install`,\n' +
  '`npm run seed`, then commit data/ from there. Nothing is lost by retrying.';

async function preflightCheck(client) {
  console.log('Preflight: fetching one Rightmove search page…');
  const name = await client.outcodeAt(1);
  if (name) {
    console.log(`OK — Rightmove is reachable (OUTCODE^1 resolves to ${name}).`);
    return true;
  }
  console.error(`BLOCKED — ${client.lastError}`);
  console.error(BLOCKED_HINT);
  return false;
}

async function main() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const cache = new DiskCache(path.join(STATE_DIR, 'rightmove-cache.json'));
  const client = createSearchClient({ cache });
  const saveState = () => cache.save();
  process.on('exit', saveState);

  if (flag('check')) {
    const ok = await preflightCheck(client);
    process.exit(ok ? 0 : 2);
  }

  const mode = modeOf(opt('mode') || 'rent');
  const CORPUS_DIR = path.join(ROOT, mode.corpusDir);
  const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, mode.configPath), 'utf8'));

  const cityFilter = opt('city');
  const limit = opt('limit') ? Number(opt('limit')) : Infinity;
  const refresh = flag('refresh');

  const corpus = loadExistingCorpus(CORPUS_DIR);
  console.log(
    `Mode: ${mode.key} (${mode.noun}). Corpus already holds ${corpus.size} listings.`
  );

  const cells = planCells(mode.key, CONFIG).filter(
    (c) => !cityFilter || c.city.toLowerCase() === cityFilter.toLowerCase()
  );
  console.log(`${cells.length} cells to work through.`);

  const report = {
    mode: mode.key,
    startedAt: new Date().toISOString(),
    cities: {},
    failures: [],
  };
  let consecutiveFailures = 0;
  let fetchedTotal = 0;

  outer: for (const cell of cells) {
    const cityReport = (report.cities[cell.city] ||= {
      target: 0,
      fetched: 0,
      had: 0,
      skipped: 0,
    });
    cityReport.target += cell.need;

    // Quota first: resolving an outcode id costs a handful of live probes, so
    // a cell the corpus already covers must not pay for one.
    const have = refresh ? 0 : alreadyHave(corpus, cell);
    cityReport.had += have;
    let need = Math.max(0, cell.need - have);
    if (!need) {
      console.log(`  ${cell.city} ${cellLabel(cell)}: quota already met (${have} stored).`);
      continue;
    }

    const oid = await client.outcodeId(cell.outcode);
    cache.save();
    if (oid == null) {
      console.error(`  ${cell.city} ${cellLabel(cell)}: ${client.lastError}`);
      report.failures.push({ ...cell, error: client.lastError });
      if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break outer;
      continue;
    }

    // Collect candidate ids from search pages, newest first.
    const candidates = [];
    for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
      const cacheKey = `searchpage:${mode.key}:${oid}:${cell.beds ? cell.beds.join('-') : 'any'}:${page}`;
      let result;
      if (cache.has(cacheKey)) {
        result = cache.get(cacheKey);
      } else {
        result = await client.search(oid, {
          channel: mode.key,
          page,
          beds: cell.beds,
          maxPrice: mode.key === 'buy' ? BUY_MAX_SEARCH_PRICE : null,
        });
        if (result) cache.set(cacheKey, result);
      }
      if (!result) {
        console.error(`  ${cell.city} ${cellLabel(cell)} p${page}: ${client.lastError}`);
        report.failures.push({ ...cell, page, error: client.lastError });
        if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break outer;
        break;
      }
      consecutiveFailures = 0;
      for (const prop of result.properties) {
        if (isGameableProperty(prop)) candidates.push(String(prop.id));
      }
      if (
        candidates.length >= need * OVERFETCH ||
        (page + 1) * 25 >= result.resultCount
      ) {
        break;
      }
    }
    cache.save();

    // Fetch each candidate's detail page until the cell's quota is met.
    for (const id of candidates) {
      if (!need) break;
      if (fetchedTotal >= limit) break outer;
      if (corpus.has(id) && !refresh) continue;
      try {
        const listing = await fetchListing(id, {
          mode: mode.key,
          bedsHint: cell.beds ? cell.beds[0] : null,
        });
        listing.city = cell.city;
        listing.sourceOutcode = cell.outcode;
        listing.scrapedAt = new Date().toISOString();
        saveListing(listing, CORPUS_DIR);
        corpus.set(id, listing);
        consecutiveFailures = 0;
        need -= 1;
        fetchedTotal += 1;
        cityReport.fetched += 1;
        console.log(
          `  [${cell.city} ${cellLabel(cell)} ${cell.need - need}/${cell.need}] ${id} ` +
            `${listing.priceLabel} ${listing.bedrooms ?? '?'}-bed ${listing.propertySubType}`
        );
      } catch (err) {
        if (err instanceof ListingError && err.status !== 502) {
          // Wrong channel, gone, or a subtype the game can't price — expected
          // attrition, especially on the buy side where auction lots, shared
          // ownership and POA listings all get rejected at the detail page.
          cityReport.skipped += 1;
        } else {
          console.error(`  ${cell.city} ${cellLabel(cell)} ${id}: ${err.message}`);
          report.failures.push({ ...cell, id, error: err.message });
          if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break outer;
        }
      }
      await politeSleep();
    }
  }

  cache.save();
  report.finishedAt = new Date().toISOString();
  report.totalStored = corpus.size;
  fs.writeFileSync(
    path.join(STATE_DIR, `seed-report-${mode.key}.json`),
    JSON.stringify(report, null, 2)
  );

  console.log('\n--- Seed report ---');
  for (const [city, r] of Object.entries(report.cities)) {
    console.log(
      `${city}: ${r.fetched} fetched this run, ${r.had} already stored, ` +
        `${r.skipped} skipped (wrong channel/gone/unpriceable), target ${r.target}`
    );
  }
  console.log(`Corpus now holds ${corpus.size} listings.`);
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    console.error(`\nStopped after ${MAX_CONSECUTIVE_FAILURES} consecutive failures.`);
    console.error(BLOCKED_HINT);
    process.exit(2);
  }
  if (report.failures.length) {
    console.log(
      `${report.failures.length} failure(s) — see data/state/seed-report-${mode.key}.json.`
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
