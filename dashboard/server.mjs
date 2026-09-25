// Crazy Night dashboard — runs Claude Code (skill crazynight-video) from the web and tracks plan, goals and stats.
// Run: npm run dashboard  →  http://localhost:4321
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const DATA = path.join(HERE, 'data');
const VIDEOS = path.join(os.homedir(), 'Downloads/crazy_night_videa');
const CARDS_FILE = path.join(REPO, 'marketing/cards.json');
const CARD_TYPES = ['Otázka', 'Úkol', 'Bonus'];
const PORT = Number(process.env.PORT || 4321);
fs.mkdirSync(DATA, { recursive: true });

// ---------- persistence ----------
const DB_FILE = path.join(DATA, 'db.json');
const DEFAULTS = {
  jobs: [], posted: {}, nextId: 1,
  stats: { snapshots: [] },
  // Two posts a day, each cross-posted to TikTok and Instagram Reels: lunch break and evening are the
  // strongest windows for Czech audiences, weekends run later. Editable in the Plan tab.
  plan: {
    slots: [1, 2, 3, 4, 5, 6, 0].map((dow) => ({ dow, times: dow === 6 || dow === 0 ? ['11:00', '20:00'] : ['12:30', '19:00'], on: true })),
    schedule: {}, // "YYYY-MM-DD#slotIndex" -> video file name
  },
  goals: [
    { id: 'emails', label: 'E-maily zájemců', metric: 'emails', target: 200, deadline: '2026-10-31' },
    { id: 'followers', label: 'Sledující na TikToku', metric: 'followers', target: 1000, deadline: '2026-10-31' },
    { id: 'followers_ig', label: 'Sledující na Instagramu', metric: 'followers_ig', target: 500, deadline: '2026-10-31' },
    { id: 'posted', label: 'Zveřejněná videa (2 denně)', metric: 'posted', target: 70, deadline: '2026-10-31' },
    { id: 'views', label: 'Zhlédnutí celkem', metric: 'views', target: 100000, deadline: '2026-10-31' },
    { id: 'preorders', label: 'Předprodeje (early bird)', metric: 'manual', target: 50, value: 0, deadline: '2026-11-30' },
  ],
  // Month-one plan from "Crazy Night — přehled projektu.pdf".
  checklist: [
    ['Týden 1', 'Dotáhnout produkt podle zpětné vazby z testování'],
    ['Týden 1', 'Tisk malé zkušební série (20–30 ks)'],
    ['Týden 1', 'Spustit landing page se sběrem e-mailů', true],
    ['Týden 1', 'První 3 videa', true],
    ['Týden 2', 'Veřejné testování na cizích lidech (FB skupiny, Discordy)'],
    ['Týden 2', 'Denní publikování obsahu'],
    ['Týden 2', 'Sledovat konverzi views → kliky → e-maily'],
    ['Týden 3', 'Early bird nabídka (prvních 50 ks)'],
    ['Týden 3', 'Tlak na první platby/zálohy'],
    ['Týden 3', 'Víc formátů a vyšší frekvence'],
    ['Týden 4', 'Vyhodnotit zájemce, platby a konverzi'],
    ['Týden 4', 'Rozhodnout o tisku finální série'],
  ].map(([week, text, done], i) => ({ id: i + 1, week, text, done: !!done })),
  potential: { views: 50000, profileCtr: 2, signupRate: 25, buyRate: 15, price: 449, cost: 150 },
};
const db = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : {};
for (const [k, v] of Object.entries(DEFAULTS)) if (db[k] === undefined) db[k] = structuredClone(v);
// Older data shapes: one time per day, one platform, day-keyed schedule.
for (const sl of db.plan.slots) if (!sl.times) { sl.times = [sl.time || '19:00']; delete sl.time; }
for (const [k, v] of Object.entries(db.posted)) if (typeof v === 'string') db.posted[k] = { tiktok: v };
for (const k of Object.keys(db.plan.schedule)) if (!k.includes('#')) { db.plan.schedule[k + '#0'] = db.plan.schedule[k]; delete db.plan.schedule[k]; }
const PLATFORMS = ['tiktok', 'instagram'];
for (const j of db.jobs) if (j.status === 'běží') { j.status = 'chyba'; j.events.push(ev('error', 'Přerušeno restartem dashboardu.')); }
function save() {
  fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db, null, 1));
  fs.renameSync(DB_FILE + '.tmp', DB_FILE);
}
function ev(kind, text) { return { t: new Date().toISOString(), kind, text }; }

// ---------- Claude Code runner ----------
const API_HELP = `Dashboard běží na http://localhost:${PORT} a má API (volej přes curl, JSON):
- GET /api/state — videa, plán, cíle, statistiky, zájemci
- POST /api/schedule {"date":"YYYY-MM-DD","slot":0|1,"video":"NN_nazev.mp4" | null} — naplánuje video do slotu dne
  (postuje se 2× denně, každé video na TikTok i Instagram Reels; časy slotů jsou v plan.slots[].times)
- POST /api/goals {"goals":[...]} — přepíše cíle (stejný tvar jako v /api/state)
- POST /api/cards {"action":"add","type":"Otázka|Úkol|Bonus","text":"…"} — přidá kartu do balíčku (marketing/cards.json)
  (také {"action":"update","id":N,"type":…,"text":…} a {"action":"delete","id":N})
- POST /api/stats {"followers":{"tiktok":N,"instagram":N},"videos":[{"platform":"tiktok|instagram","title":"…","date":"YYYY-MM-DD","views":N,"likes":N,"comments":N,"shares":N}]}`;

const STATS_INSTRUCTION = `Aktualizuj statistiky Crazy Night z TikToku a Instagramu do dashboardu.
1. TikTok (@dyos_app): v Chrome otevři nový tab https://www.tiktok.com/tiktokstudio/content. Zjisti počet sledujících a pro každé
   video popisek (max 60 znaků), datum zveřejnění, zhlédnutí, lajky, komentáře, sdílení.
2. Instagram: otevři https://www.instagram.com/ a přes profil přihlášeného účtu Crazy Night zjisti sledující a u každého reelu
   totéž (zhlédnutí/přehrání, lajky, komentáře, sdílení — co je vidět v přehledech/insights).
   Když na některé síti uživatel přihlášený není nebo účet Crazy Night neexistuje, tu síť přeskoč a napiš to v reportu.
3. Ulož to do JSON souboru ve scratchpadu a pošli: curl -s -X POST http://localhost:${PORT}/api/stats -H 'content-type: application/json' --data-binary @soubor.json
   Tvar: {"followers":{"tiktok":N,"instagram":N},"videos":[{"platform":"tiktok","title":"…","date":"YYYY-MM-DD","views":N,"likes":N,"comments":N,"shares":N}]}
   (síť, kterou jsi nenačetl, v followers vynech)
4. Nic neměň, nepostuj, nelajkuj ani nekomentuj. Taby zavři. Na konci napiš 2–3 věty česky: jak si účty vedou a co z čísel plyne.`;

const FREE_INSTRUCTION = (prompt) => `Jsi marketingový manažer párty karetní hry Crazy Night (TikTok @dyos_app + Instagram Reels, postuje se 2× denně, web https://crazynight.vercel.app, zapsaní dostanou 10% slevu).
Repo projektu je v aktuální složce, plán projektu v ~/Downloads/Crazy Night — přehled projektu.pdf.
${API_HELP}
Když úkol znamená vyrobit video, použij skill crazynight-video. Na TikTok ani Instagram nikdy nepostuj.
Běžíš bez obsluhy z webového dashboardu: na nic se neptej, rozhoduj sám. Na konci napiš krátký report česky.

Úkol: ${prompt}`;

const INSTRUCTION = (prompt) => `Použij skill crazynight-video a udělej podle něj celý postup až po hotové video.
Zadání od uživatele: ${prompt || '(bez zadání — vyber kartu a scénu sám)'}

Běžíš bez obsluhy z webového dashboardu: na nic se neptej, rozhoduj sám. Prohlížeč používej jen pro Gemini.
Na konci napiš krátký report česky: název souboru videa, karta, co se ve videu děje, popisek.`;

const TOOL_LABELS = {
  Skill: 'Načítá postup',
  Read: 'Čte soubor',
  Write: 'Ukládá soubor',
  Edit: 'Upravuje soubor',
  'mcp__claude-in-chrome__tabs_create_mcp': 'Otevírá nový tab',
  'mcp__claude-in-chrome__navigate': 'Otevírá Gemini',
  'mcp__claude-in-chrome__file_upload': 'Nahrává referenci karty',
  'mcp__claude-in-chrome__find': 'Hledá na stránce',
  'mcp__claude-in-chrome__get_page_text': 'Čte stránku',
  'mcp__claude-in-chrome__read_page': 'Čte stránku',
  'mcp__claude-in-chrome__javascript_tool': 'Připravuje stránku',
  'mcp__claude-in-chrome__tabs_close_mcp': 'Zavírá tab',
  'mcp__claude-in-chrome__tabs_context_mcp': 'Připojuje se k Chrome',
};
const COMPUTER_LABELS = {
  screenshot: 'Kouká na obrazovku', left_click: 'Kliká', type: 'Píše prompt do Gemini', wait: 'Čeká na Gemini',
  key: 'Mačká klávesu', scroll: 'Scrolluje', zoom: 'Kouká zblízka', hover: 'Najíždí myší',
};

function describeTool(name, input = {}) {
  if (name === 'ToolSearch' || name === 'TodoWrite') return null;
  if (name === 'mcp__claude-in-chrome__computer') return COMPUTER_LABELS[input.action] || 'Ovládá prohlížeč';
  if (name === 'mcp__claude-in-chrome__browser_batch') {
    const acts = (input.actions || []).map((a) => a.name === 'computer' ? COMPUTER_LABELS[a.input?.action] : TOOL_LABELS['mcp__claude-in-chrome__' + a.name]).filter(Boolean);
    return [...new Set(acts)].join(' · ') || 'Ovládá prohlížeč';
  }
  if (name === 'Bash') {
    if (/make_video\.py/.test(input.command || '')) return 'Stříhá video';
    return input.description || 'Spouští příkaz';
  }
  if (name === 'Write' && /\.txt$/.test(input.file_path || '')) return 'Píše popisek';
  return TOOL_LABELS[name] || name.replace(/^mcp__[^_]+__/, '');
}

let running = null; // { job, child }

function startNext() {
  if (running) return;
  const job = db.jobs.find((j) => j.status === 'čeká');
  if (!job) return;
  job.status = 'běží';
  job.started = new Date().toISOString();
  job.events.push(ev('info', job.followUp ? `Pokračuje: ${job.followUp}` : 'Spouštím Claude Code…'));
  save();

  const args = ['-p', '--chrome', '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose'];
  if (job.followUp && job.sessionId) args.push('--resume', job.sessionId, job.followUp);
  else args.push(job.type === 'stats' ? STATS_INSTRUCTION : job.type === 'free' ? FREE_INSTRUCTION(job.prompt) : INSTRUCTION(job.prompt));
  const child = spawn('claude', args, { cwd: REPO, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  running = { job, child };

  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (line.trim()) handleLine(job, line);
    }
  });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c; });
  child.on('close', (code) => {
    if (job.status === 'běží') {
      job.status = code === 0 && !job.isError ? 'hotovo' : 'chyba';
      if (code !== 0 && stderr.trim()) job.events.push(ev('error', stderr.trim().slice(-800)));
    }
    job.finished = new Date().toISOString();
    job.followUp = null;
    running = null;
    save();
    startNext();
  });
}

function handleLine(job, line) {
  let o;
  try { o = JSON.parse(line); } catch { return; }
  if (o.type === 'system' && o.subtype === 'init') job.sessionId = o.session_id;
  if (o.type === 'assistant') {
    for (const c of o.message?.content || []) {
      if (c.type === 'text' && c.text.trim()) job.events.push(ev('text', c.text.trim()));
      if (c.type === 'tool_use') {
        const label = describeTool(c.name, c.input);
        const last = job.events.at(-1);
        if (!label) continue;
        if (last?.kind === 'tool' && last.text === label) last.n = (last.n || 1) + 1;
        else job.events.push(ev('tool', label));
      }
    }
  }
  if (o.type === 'result') {
    job.isError = o.is_error || o.subtype !== 'success';
    job.cost = (job.cost || 0) + (o.total_cost_usd || 0);
    if (o.result) job.result = o.result;
    if (job.isError) job.events.push(ev('error', o.result || o.subtype));
  }
  if (job.events.length > 400) job.events.splice(0, job.events.length - 400);
  save();
}

// ---------- videos ----------
function listVideos() {
  if (!fs.existsSync(VIDEOS)) return [];
  return fs.readdirSync(VIDEOS)
    .filter((f) => f.endsWith('.mp4'))
    .map((f) => {
      const st = fs.statSync(path.join(VIDEOS, f));
      const txt = path.join(VIDEOS, f.replace(/\.mp4$/, '.txt'));
      return {
        name: f,
        title: f.replace(/\.mp4$/, '').replace(/^(\d+)_/, '$1 · ').replace(/_/g, ' '),
        size: st.size,
        mtime: st.mtime.toISOString(),
        caption: fs.existsSync(txt) ? fs.readFileSync(txt, 'utf8').trim() : '',
        posted: db.posted[f] || null,
      };
    })
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
}

function serveVideo(req, res, name) {
  const file = path.join(VIDEOS, path.basename(decodeURIComponent(name)));
  if (!file.endsWith('.mp4') || !fs.existsSync(file)) return json(res, 404, { error: 'not found' });
  const size = fs.statSync(file).size;
  const headers = { 'content-type': 'video/mp4', 'accept-ranges': 'bytes' };
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (!m) { res.writeHead(200, { ...headers, 'content-length': size }); return fs.createReadStream(file).pipe(res); }
  const start = m[1] ? Number(m[1]) : size - Number(m[2]);
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
  fs.createReadStream(file, { start, end }).pipe(res);
}

// ---------- signups (Vercel Blob via `npm run zajemci`) ----------
let signups = { rows: [], fetchedAt: null, error: null, loading: false };
function refreshSignups(force = false) {
  const fresh = signups.fetchedAt && Date.now() - Date.parse(signups.fetchedAt) < 10 * 60 * 1000;
  if (signups.loading || (fresh && !force)) return signups.promise || Promise.resolve();
  signups.loading = true;
  signups.promise = new Promise((resolve) => {
    execFile('npm', ['run', '--silent', 'zajemci'], { cwd: REPO, timeout: 90000 }, (err, stdout, stderr) => {
      if (err) signups.error = (stderr || err.message).trim().split('\n').pop();
      else {
        signups.rows = stdout.trim().split('\n').slice(1).filter(Boolean).map((l) => {
          const i = l.lastIndexOf(',');
          return { email: l.slice(0, i), at: l.slice(i + 1) };
        });
        signups.error = null;
      }
      signups.fetchedAt = new Date().toISOString();
      signups.loading = false;
      resolve();
    });
  });
  return signups.promise;
}
function signupsPublic() {
  refreshSignups();
  return { count: signups.rows.length, rows: signups.rows, fetchedAt: signups.fetchedAt, error: signups.error, loading: signups.loading };
}

// ---------- posting plan ----------
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// Fills the next 14 days' free slots (skipping today's already-passed times) with finished videos that
// are neither posted nor scheduled yet, oldest first.
function autoSchedule() {
  const planned = new Set(Object.values(db.plan.schedule));
  const queue = listVideos().filter((v) => !v.posted && !planned.has(v.name)).reverse();
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  for (let i = 0; i < 14 && queue.length; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const slot = db.plan.slots.find((s) => s.dow === d.getDay());
    if (!slot?.on) continue;
    slot.times.forEach((t, si) => {
      const key = `${isoDate(d)}#${si}`;
      if (queue.length && !db.plan.schedule[key] && !(i === 0 && t <= hhmm)) db.plan.schedule[key] = queue.shift().name;
    });
  }
}

// ---------- cards ----------
const normCard = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function readCards() {
  const raw = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8'));
  return raw.map((c, i) => typeof c === 'string' ? { id: i + 1, type: 'Otázka', text: c } : c);
}
function writeCards(cards) {
  fs.writeFileSync(CARDS_FILE + '.tmp', JSON.stringify(cards, null, 2) + '\n');
  fs.renameSync(CARDS_FILE + '.tmp', CARDS_FILE);
}
// Which finished video used which card: the edit specs (raw/NN_spec.json) name the card and the output file.
function cardVideos() {
  const map = {};
  const dir = path.join(VIDEOS, 'raw');
  if (!fs.existsSync(dir)) return map;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('_spec.json'))) {
    try {
      const spec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const video = path.basename(spec.out || '');
      for (const o of spec.overlays || []) if (o.type === 'card') (map[normCard(o.text)] ||= []).push(video);
    } catch {}
  }
  return map;
}
function cardsPublic() {
  const used = cardVideos();
  const have = new Set(listVideos().map((v) => v.name));
  return readCards().map((c) => ({ ...c, videos: (used[normCard(c.text)] || []).filter((v) => have.has(v)) }));
}

// ---------- http ----------
function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
async function body(req) {
  let s = '';
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : {};
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && p === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return fs.createReadStream(path.join(HERE, 'index.html')).pipe(res);
    }
    if (req.method === 'GET' && p === '/api/state') {
      return json(res, 200, {
        jobs: db.jobs.slice(0, 30), videos: listVideos(), stats: db.stats, plan: db.plan,
        goals: db.goals, checklist: db.checklist, potential: db.potential, signups: signupsPublic(), cards: cardsPublic(),
      });
    }
    if (req.method === 'POST' && p === '/api/signups/refresh') { await refreshSignups(true); return json(res, 200, signupsPublic()); }
    if (req.method === 'POST' && p === '/api/stats') {
      const b = await body(req);
      const videos = (Array.isArray(b.videos) ? b.videos : []).map((v) => ({
        platform: PLATFORMS.includes(v.platform) ? v.platform : 'tiktok',
        title: String(v.title || '').slice(0, 120), date: String(v.date || '').slice(0, 10),
        views: +v.views || 0, likes: +v.likes || 0, comments: +v.comments || 0, shares: +v.shares || 0,
      }));
      // followers: number (= TikTok, older shape) or { tiktok, instagram }
      const f = typeof b.followers === 'object' && b.followers ? b.followers : { tiktok: b.followers };
      const followers = {};
      for (const pl of PLATFORMS) if (f[pl] != null && f[pl] !== '' && isFinite(+f[pl])) followers[pl] = +f[pl];
      const snap = { at: new Date().toISOString(), followers, videos, source: b.source || 'claude' };
      db.stats.snapshots.push(snap);
      db.stats.snapshots = db.stats.snapshots.slice(-200);
      save();
      return json(res, 200, { ok: true, videos: videos.length });
    }
    if (req.method === 'POST' && p === '/api/schedule') {
      const { date, slot = 0, video, auto } = await body(req);
      if (auto) autoSchedule();
      else if (/^\d{4}-\d{2}-\d{2}$/.test(date || '') && [0, 1, 2].includes(+slot)) {
        const key = `${date}#${+slot}`;
        if (video) db.plan.schedule[key] = path.basename(video); else delete db.plan.schedule[key];
      } else return json(res, 400, { error: 'Chybí datum nebo slot.' });
      save();
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/plan') {
      const { slots } = await body(req);
      if (!Array.isArray(slots) || slots.length !== 7) return json(res, 400, { error: 'Čekám 7 slotů.' });
      db.plan.slots = slots.map((s) => {
        const times = (Array.isArray(s.times) ? s.times : []).filter((t) => /^\d{2}:\d{2}$/.test(t)).slice(0, 3).sort();
        return { dow: +s.dow, times: times.length ? times : ['19:00'], on: !!s.on };
      });
      save();
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/goals') {
      const { goals } = await body(req);
      if (!Array.isArray(goals)) return json(res, 400, { error: 'Čekám pole cílů.' });
      db.goals = goals.map((g, i) => ({
        id: String(g.id || 'g' + i), label: String(g.label || 'Cíl').slice(0, 60),
        metric: ['emails', 'followers', 'followers_ig', 'posted', 'views', 'manual'].includes(g.metric) ? g.metric : 'manual',
        target: Math.max(1, +g.target || 1), value: +g.value || 0, deadline: String(g.deadline || '').slice(0, 10),
      }));
      save();
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/checklist') {
      const { id, done } = await body(req);
      const item = db.checklist.find((c) => c.id === +id);
      if (!item) return json(res, 404, { error: 'Položka neexistuje.' });
      item.done = !!done;
      save();
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/cards') {
      const { action, id, type, text } = await body(req);
      const cards = readCards();
      const t = String(text || '').trim().slice(0, 300);
      const ty = CARD_TYPES.includes(type) ? type : 'Otázka';
      if (action === 'add') {
        if (!t) return json(res, 400, { error: 'Karta nemá text.' });
        if (cards.some((c) => normCard(c.text) === normCard(t))) return json(res, 409, { error: 'Taková karta už v balíčku je.' });
        const card = { id: Math.max(0, ...cards.map((c) => c.id)) + 1, type: ty, text: t, added: new Date().toISOString().slice(0, 10) };
        writeCards([...cards, card]);
        return json(res, 200, { ok: true, id: card.id });
      }
      const card = cards.find((c) => c.id === +id);
      if (!card) return json(res, 404, { error: 'Karta neexistuje.' });
      if (action === 'update') {
        if (!t) return json(res, 400, { error: 'Karta nemá text.' });
        Object.assign(card, { text: t, type: ty });
        writeCards(cards);
      } else if (action === 'delete') writeCards(cards.filter((c) => c !== card));
      else return json(res, 400, { error: 'Neznámá akce.' });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/potential') {
      const b = await body(req);
      for (const k of Object.keys(DEFAULTS.potential)) if (b[k] !== undefined && isFinite(+b[k])) db.potential[k] = +b[k];
      save();
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && p.startsWith('/video/')) return serveVideo(req, res, p.slice(7));

    if (req.method === 'POST' && p === '/api/jobs') {
      const { prompt = '', count = 1, type = 'video' } = await body(req);
      if (!['video', 'stats', 'free'].includes(type)) return json(res, 400, { error: 'Neznámý typ úkolu.' });
      if (type === 'free' && !prompt.trim()) return json(res, 400, { error: 'Napiš, co má manažer udělat.' });
      const n = type === 'video' ? Math.max(1, Math.min(5, Number(count) || 1)) : 1;
      for (let i = 0; i < n; i++) {
        db.jobs.unshift({ id: db.nextId++, type, prompt: type === 'stats' ? 'Aktualizovat statistiky z TikToku' : prompt.trim(), status: 'čeká', created: new Date().toISOString(), events: [] });
      }
      save(); startNext();
      return json(res, 200, { ok: true });
    }
    let m = /^\/api\/jobs\/(\d+)\/(cancel|followup|delete)$/.exec(p);
    if (req.method === 'POST' && m) {
      const job = db.jobs.find((j) => j.id === Number(m[1]));
      if (!job) return json(res, 404, { error: 'Úkol neexistuje.' });
      if (m[2] === 'cancel') {
        if (job.status === 'čeká') job.status = 'zrušeno';
        if (running?.job === job) {
          job.status = 'zrušeno';
          try { process.kill(-running.child.pid, 'SIGTERM'); } catch {}
        }
        job.events.push(ev('error', 'Zrušeno.'));
      } else if (m[2] === 'followup') {
        const { message } = await body(req);
        if (!message?.trim()) return json(res, 400, { error: 'Prázdná zpráva.' });
        if (!job.sessionId) return json(res, 400, { error: 'Tenhle úkol nejde navázat.' });
        if (['čeká', 'běží'].includes(job.status)) return json(res, 409, { error: 'Úkol ještě běží.' });
        job.events.push(ev('user', message.trim()));
        Object.assign(job, { followUp: message.trim(), status: 'čeká', isError: false });
        db.jobs = [job, ...db.jobs.filter((j) => j !== job)];
      } else if (m[2] === 'delete') {
        if (running?.job === job) return json(res, 409, { error: 'Nejdřív úkol zruš.' });
        db.jobs = db.jobs.filter((j) => j !== job);
      }
      save(); startNext();
      return json(res, 200, { ok: true });
    }
    m = /^\/api\/videos\/(.+)\/posted$/.exec(p);
    if (req.method === 'POST' && m) {
      const name = path.basename(decodeURIComponent(m[1]));
      const { platform } = await body(req);
      if (!PLATFORMS.includes(platform)) return json(res, 400, { error: 'Neznámá síť.' });
      const cur = db.posted[name] || {};
      if (cur[platform]) delete cur[platform]; else cur[platform] = new Date().toISOString();
      if (Object.keys(cur).length) db.posted[name] = cur; else delete db.posted[name];
      save();
      return json(res, 200, { ok: true });
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: String(e.message || e) });
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Crazy Night dashboard: http://localhost:${PORT}`);
  startNext();
});
