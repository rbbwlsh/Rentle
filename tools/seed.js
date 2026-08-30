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
//   node tools/seed.js              full run from tools/config/outcodes.json
//   node tools/seed.js --city Leeds --limit 5   small smoke run
//   node tools/seed.js --refresh    re-fetch listings already in the corpus

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchListing, ListingError } from './lib/rightmove.js';
import { createSearchClient, isGameableProperty } from './lib/searchClient.js';
import { DiskCache } from './lib/diskCache.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS_DIR = path.join(ROOT, 'data', 'corpus');
const STATE_DIR = path.join(ROOT, 'data', 'state');
const CONFIG = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tools', 'config', 'outcodes.json'), 'utf8')
);

// Stop the run after this many consecutive blocked/empty responses: at that
// point Rightmove is almost certainly refusing this network, not one page.
const MAX_CONSECUTIVE_FAILURES = 3;
// Over-collect candidate ids: some turn out to be let-agreed, unparseable, or
// filtered subtypes by the time the detail page is fetched.
const OVERFETCH = 1.15;
const MAX_SEARCH_PAGES = 6;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const politeSleep = () => sleep(1100 + Math.random() * 400);

function loadExistingCorpus() {
  fs.mkdirSync(CORPUS_DIR, { recursive: true });
  const byId = new Map();
  for (const f of fs.readdirSync(CORPUS_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const listing = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, f), 'utf8'));
      byId.set(String(listing.id), listing);
    } catch {
      /* a corrupt file just gets re-fetched */
    }
  }
  return byId;
}

function saveListing(listing) {
  const file = path.join(CORPUS_DIR, `${listing.id}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(listing, null, 1));
  fs.renameSync(tmp, file);
}

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

  const cityFilter = opt('city');
  const limit = opt('limit') ? Number(opt('limit')) : Infinity;
  const refresh = flag('refresh');

  const corpus = loadExistingCorpus();
  console.log(`Corpus already holds ${corpus.size} listings.`);

  const report = { startedAt: new Date().toISOString(), cities: {}, failures: [] };
  let consecutiveFailures = 0;
  let fetchedTotal = 0;

  outer: for (const [city, { perOutcode, outcodes }] of Object.entries(CONFIG)) {
    if (cityFilter && city.toLowerCase() !== cityFilter.toLowerCase()) continue;
    const cityReport = { target: perOutcode * outcodes.length, fetched: 0, had: 0, skipped: 0 };
    report.cities[city] = cityReport;

    for (const outcode of outcodes) {
      const oid = await client.outcodeId(outcode);
      cache.save();
      if (oid == null) {
        console.error(`  ${city} ${outcode}: ${client.lastError}`);
        report.failures.push({ city, outcode, error: client.lastError });
        if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break outer;
        continue;
      }

      // How many of this outcode's quota the corpus already covers.
      const have = [...corpus.values()].filter(
        (l) => l.sourceOutcode === outcode && !refresh
      ).length;
      cityReport.had += have;
      let need = Math.max(0, perOutcode - have);
      if (!need) {
        console.log(`  ${city} ${outcode}: quota already met (${have} stored).`);
        continue;
      }

      // Collect candidate ids from search pages, newest first.
      const candidates = [];
      for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
        const cacheKey = `searchpage:${oid}:${page}`;
        let result;
        if (cache.has(cacheKey)) {
          result = cache.get(cacheKey);
        } else {
          result = await client.searchRent(oid, { page });
          if (result) cache.set(cacheKey, result);
        }
        if (!result) {
          console.error(`  ${city} ${outcode} p${page}: ${client.lastError}`);
          report.failures.push({ city, outcode, page, error: client.lastError });
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

      // Fetch each candidate's detail page until the quota is met.
      for (const id of candidates) {
        if (!need) break;
        if (fetchedTotal >= limit) break outer;
        if (corpus.has(id) && !refresh) continue;
        try {
          const listing = await fetchListing(id);
          listing.city = city;
          listing.sourceOutcode = outcode;
          listing.scrapedAt = new Date().toISOString();
          saveListing(listing);
          corpus.set(id, listing);
          consecutiveFailures = 0;
          need -= 1;
          fetchedTotal += 1;
          cityReport.fetched += 1;
          const done = perOutcode - need;
          console.log(
            `  [${city} ${outcode} ${done}/${perOutcode}] ${id} ` +
              `£${listing.priceAmount} pcm ${listing.bedrooms ?? '?'}-bed ` +
              `${listing.propertySubType}`
          );
        } catch (err) {
          if (err instanceof ListingError && err.status !== 502) {
            // A sale listing, or gone — skip it, this is expected attrition.
            cityReport.skipped += 1;
          } else {
            console.error(`  ${city} ${outcode} ${id}: ${err.message}`);
            report.failures.push({ city, outcode, id, error: err.message });
            if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break outer;
          }
        }
        await politeSleep();
      }
    }
  }

  cache.save();
  report.finishedAt = new Date().toISOString();
  report.totalStored = corpus.size;
  fs.writeFileSync(
    path.join(STATE_DIR, 'seed-report.json'),
    JSON.stringify(report, null, 2)
  );

  console.log('\n--- Seed report ---');
  for (const [city, r] of Object.entries(report.cities)) {
    console.log(
      `${city}: ${r.fetched} fetched this run, ${r.had} already stored, ` +
        `${r.skipped} skipped (sale/gone), target ${r.target}`
    );
  }
  console.log(`Corpus now holds ${corpus.size} listings.`);
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    console.error(`\nStopped after ${MAX_CONSECUTIVE_FAILURES} consecutive failures.`);
    console.error(BLOCKED_HINT);
    process.exit(2);
  }
  if (report.failures.length) {
    console.log(`${report.failures.length} failure(s) — see data/state/seed-report.json.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
