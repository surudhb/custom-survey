// Regenerate the README screenshots.
//
//   1. start the app on :3000            (npm start)
//   2. node scripts/screenshots.mjs
//
// Drives the local system Chrome via puppeteer-core and writes PNGs to
// docs/screenshots/. Seeds a few throwaway votes so the results / winner
// views have data; clears them again at the end.
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;

const CHROME =
  process.env.CHROME_PATH ||
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
   '/Applications/Chromium.app/Contents/MacOS/Chromium',
   '/usr/bin/google-chrome',
   '/usr/bin/chromium'].find((p) => existsSync(p));

if (!CHROME) throw new Error('No Chrome/Chromium found — set CHROME_PATH');

const SEED_VOTES = [
  ['Arcade bar', 'Karaoke night', 'Escape room', 'Bowling', 'Mini golf', 'Paint & sip studio'],
  ['Karaoke night', 'Arcade bar', 'Paint & sip studio', 'Escape room', 'Bowling', 'Mini golf'],
  ['Escape room', 'Arcade bar', 'Karaoke night', 'Mini golf', 'Paint & sip studio', 'Bowling'],
  ['Arcade bar', 'Escape room', 'Bowling', 'Karaoke night', 'Paint & sip studio', 'Mini golf'],
  ['Karaoke night', 'Escape room', 'Arcade bar', 'Paint & sip studio', 'Bowling', 'Mini golf'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function seed(tokens) {
  for (let i = 0; i < SEED_VOTES.length; i++) {
    const token = `screenshot-seed-${i}-aaaaaaaa`;
    tokens.push(token);
    await fetch(`${BASE}/api/vote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, ranking: SEED_VOTES[i] }),
    });
  }
}
async function unseed(tokens) {
  for (const token of tokens) {
    await fetch(`${BASE}/api/vote/${encodeURIComponent(token)}`, { method: 'DELETE' });
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const seededTokens = [];
  await seed(seededTokens);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 430, height: 940, deviceScaleFactor: 2 },
    args: ['--hide-scrollbars', '--force-color-profile=srgb'],
  });
  const page = await browser.newPage();
  const shot = async (name, sel = 'main.invite') => {
    const el = await page.$(sel);
    await el.screenshot({ path: `${OUT}${name}.png` });
  };
  const shotFull = (name, height = 940) =>
    page.screenshot({ path: `${OUT}${name}.png`, clip: { x: 0, y: 0, width: 430, height } });
  const fresh = async () => {
    await page.evaluateOnNewDocument(() => {
      localStorage.removeItem('ranker_token');
      localStorage.removeItem('ranker_theme');
    });
    await page.goto(BASE, { waitUntil: 'networkidle0' });
  };

  // 1 — ranking view
  await fresh();
  await page.waitForSelector('#rank-list .rank-item');
  await sleep(900); // let the intro stagger settle
  await shot('01-vote');

  // 2 — mid-drag (real mouse press + move, screenshot before release)
  {
    const items = await page.$$('#rank-list .rank-item');
    const a = await items[0].boundingBox();
    const b = await items[3].boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    for (let s = 1; s <= 6; s++) {
      await page.mouse.move(
        a.x + a.width / 2,
        a.y + a.height / 2 + ((b.y - a.y) * s) / 6,
      );
      await sleep(40);
    }
    await sleep(200);
    await shot('02-drag');
    await page.mouse.up();
  }

  // 3 — thank-you view
  await fresh();
  await page.waitForSelector('#submit-btn');
  await page.click('#submit-btn');
  await page.waitForSelector('#thanks-view:not([hidden])');
  seededTokens.push(await page.evaluate(() => localStorage.getItem('ranker_token')));
  await sleep(2800); // let the submit confetti finish falling
  await shot('03-thanks');

  // 4 — "see what others picked"
  await page.click('#others-btn');
  await page.waitForSelector('#others-panel:not([hidden]) .res-row');
  await sleep(700);
  await shot('04-results');

  // 5 — a different colour theme
  await fresh();
  await page.waitForSelector('#theme-btn');
  for (let i = 0; i < 6; i++) { await page.click('#theme-btn'); await sleep(120); }
  await sleep(300);
  await shot('05-theme');

  // 6 — post-deadline drumroll
  await fresh();
  await page.waitForSelector('#reveal-view');
  await page.evaluate(() => {
    document.getElementById('vote-view').hidden = true;
    document.getElementById('thanks-view').hidden = true;
    document.getElementById('reveal-view').hidden = false;
  });
  await page.evaluate(() => {
    const s = document.getElementById('drum-slider');
    [12, 30, 48].forEach((v) => { s.value = v; s.dispatchEvent(new Event('input', { bubbles: true })); });
  });
  await sleep(500);
  await shot('06-drumroll');

  // 7 — winner revealed
  await page.evaluate(() => {
    const s = document.getElementById('drum-slider');
    s.value = 100;
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForSelector('#winner:not([hidden])');
  await sleep(900); // catch the confetti still falling
  await shotFull('07-winner', 860);

  await browser.close();
  await unseed(seededTokens);
  console.log(`wrote screenshots to ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
