const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
// DATA_DIR lets a host mount a persistent volume for the vote file + admin key
// (e.g. DATA_DIR=/data on Fly.io / Railway). Defaults to the project folder.
const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const ADMIN_KEY_FILE = path.join(DATA_DIR, 'admin_key.txt');

// ---- config ----
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
if (!Array.isArray(config.activities) || config.activities.length < 2) {
  console.error('config.json must have at least 2 activities.');
  process.exit(1);
}

// ---- admin key (auto-generated once, reused across restarts) ----
let ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY) {
  if (fs.existsSync(ADMIN_KEY_FILE)) {
    ADMIN_KEY = fs.readFileSync(ADMIN_KEY_FILE, 'utf8').trim();
  } else {
    ADMIN_KEY = crypto.randomBytes(9).toString('base64url');
    fs.writeFileSync(ADMIN_KEY_FILE, ADMIN_KEY);
  }
}

// ---- tiny JSON "database" with a write queue so concurrent submits don't clobber each other ----
function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { responses: {} };
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { responses: {} };
  }
}
let writeQueue = Promise.resolve();
function saveData(data) {
  writeQueue = writeQueue.then(() =>
    fs.promises.writeFile(DATA_FILE, JSON.stringify(data, null, 2))
  );
  return writeQueue;
}

function isValidRanking(ranking) {
  if (!Array.isArray(ranking)) return false;
  if (ranking.length !== config.activities.length) return false;
  const setA = new Set(config.activities);
  const setB = new Set(ranking);
  if (setB.size !== ranking.length) return false; // no duplicates
  if (setA.size !== setB.size) return false;
  for (const item of ranking) if (!setA.has(item)) return false; // only known activities
  return true;
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({
    title: config.title,
    description: config.description,
    dateLabel: config.dateLabel || null,
    activities: config.activities,
    submissionsCloseAt: config.submissionsCloseAt || null,
    event: config.event || null,
  });
});

// Fetch an existing response by token, so a returning respondent can edit it.
app.get('/api/vote/:token', (req, res) => {
  const data = loadData();
  const entry = data.responses[req.params.token];
  if (!entry) return res.status(404).json({ error: 'not_found' });
  res.json({ ranking: entry.ranking, updatedAt: entry.updatedAt });
});

// Create or overwrite a response for a token.
app.post('/api/vote', async (req, res) => {
  const { token, ranking } = req.body || {};
  if (typeof token !== 'string' || token.length < 8 || token.length > 128) {
    return res.status(400).json({ error: 'invalid_token' });
  }
  if (!isValidRanking(ranking)) {
    return res.status(400).json({ error: 'invalid_ranking' });
  }
  if (config.submissionsCloseAt) {
    const closeMs = Date.parse(config.submissionsCloseAt); // server-local if no timezone given
    if (!Number.isNaN(closeMs) && Date.now() > closeMs) {
      return res.status(403).json({ error: 'submissions_closed' });
    }
  }
  const data = loadData();
  const isNew = !data.responses[token];
  data.responses[token] = { ranking, updatedAt: new Date().toISOString() };
  await saveData(data);
  res.json({ ok: true, created: isNew });
});

// Let someone remove their own anonymous response.
app.delete('/api/vote/:token', async (req, res) => {
  const data = loadData();
  if (data.responses[req.params.token]) {
    delete data.responses[req.params.token];
    await saveData(data);
  }
  res.json({ ok: true });
});

// Public aggregate summary — Borda points per activity only, no per-response data,
// so respondents can see the group's overall ranking without the admin key.
app.get('/api/summary', (req, res) => {
  const data = loadData();
  const responses = Object.values(data.responses);
  const n = config.activities.length;
  const points = {};
  config.activities.forEach((a) => { points[a] = 0; });
  for (const r of responses) {
    r.ranking.forEach((activity, idx) => { points[activity] += (n - idx); });
  }
  const leaderboard = config.activities
    .map((a) => ({ activity: a, points: points[a] }))
    .sort((a, b) => b.points - a.points);
  res.json({ totalResponses: responses.length, leaderboard });
});

// Aggregated results — requires the admin key (?key=... or x-admin-key header).
app.get('/api/results', (req, res) => {
  const key = req.query.key || req.headers['x-admin-key'];
  if (key !== ADMIN_KEY) return res.status(403).json({ error: 'forbidden' });

  const data = loadData();
  const responses = Object.values(data.responses);
  const n = config.activities.length;

  // Borda count: top rank gets n points, last rank gets 1 point.
  const points = {};
  const rankCounts = {}; // activity -> [count at rank1, count at rank2, ...]
  config.activities.forEach(a => {
    points[a] = 0;
    rankCounts[a] = new Array(n).fill(0);
  });

  for (const r of responses) {
    r.ranking.forEach((activity, idx) => {
      points[activity] += (n - idx);
      rankCounts[activity][idx] += 1;
    });
  }

  const leaderboard = config.activities
    .map(a => ({
      activity: a,
      points: points[a],
      averageRank: responses.length
        ? (rankCounts[a].reduce((sum, c, idx) => sum + c * (idx + 1), 0) / responses.length).toFixed(2)
        : null,
      rankCounts: rankCounts[a],
    }))
    .sort((a, b) => b.points - a.points);

  res.json({
    totalResponses: responses.length,
    activities: config.activities,
    leaderboard,
  });
});

app.listen(PORT, () => {
  console.log(`Birthday ranker running at http://localhost:${PORT}`);
  console.log(`Admin results page: http://localhost:${PORT}/results.html?key=${ADMIN_KEY}`);
  console.log(`(Admin key also saved in admin_key.txt)`);
});
