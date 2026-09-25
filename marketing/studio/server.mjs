// Crazy Night Studio — local web UI for the AI marketing manager. Run: npm run studio
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, save, monthSpendUsd, OUT_DIR } from './store.mjs';
import { ai, chat, startVideo, TEXT_MODEL, BUDGET_USD } from './agent.mjs';

const PORT = Number(process.env.STUDIO_PORT || 4321);
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
let busy = false;

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  let s = '';
  for await (const chunk of req) s += chunk;
  return s ? JSON.parse(s) : {};
}

// Video files with Range support so the <video> element can seek.
function serveVideo(req, res, name) {
  const file = path.join(OUT_DIR, path.basename(name));
  if (!file.endsWith('.mp4') || !fs.existsSync(file)) return json(res, 404, { error: 'not found' });
  const size = fs.statSync(file).size;
  const headers = { 'content-type': 'video/mp4', 'accept-ranges': 'bytes' };
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (!m) {
    res.writeHead(200, { ...headers, 'content-length': size });
    return fs.createReadStream(file).pipe(res);
  }
  const start = m[1] ? Number(m[1]) : size - Number(m[2]);
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
  fs.createReadStream(file, { start, end }).pipe(res);
}

const POST_ACTIONS = {
  approve: (p) => { p.status = 'schváleno'; },
  published: (p) => { p.status = 'zveřejněno'; p.published = new Date().toISOString(); },
  reopen: (p) => { p.status = p.video ? 'video hotové' : 'návrh'; },
  delete: (p) => { db.posts = db.posts.filter((x) => x !== p); },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return fs.createReadStream(path.join(PUBLIC, 'index.html')).pipe(res);
    }
    if (req.method === 'GET' && url.pathname.startsWith('/video/')) return serveVideo(req, res, url.pathname.slice(7));
    if (req.method === 'GET' && url.pathname === '/api/state') {
      return json(res, 200, {
        posts: db.posts, chat: db.chat.slice(-200), busy, hasKey: !!ai, model: TEXT_MODEL,
        budget: { spent: +monthSpendUsd().toFixed(2), limit: BUDGET_USD },
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      if (!ai) return json(res, 400, { error: 'Chybí GEMINI_API_KEY v marketing/.env' });
      if (busy) return json(res, 409, { error: 'Manažer ještě odpovídá.' });
      const { message } = await readBody(req);
      if (!message?.trim()) return json(res, 400, { error: 'Prázdná zpráva.' });
      busy = true;
      try { await chat(message.trim()); }
      catch (e) {
        db.chat.push({ role: 'tool', text: 'Chyba AI', error: String(e.message || e), at: new Date().toISOString() });
        save();
      } finally { busy = false; }
      return json(res, 200, { ok: true });
    }
    const m = /^\/api\/posts\/(\d+)$/.exec(url.pathname);
    if (req.method === 'POST' && m) {
      const post = db.posts.find((p) => p.id === Number(m[1]));
      if (!post) return json(res, 404, { error: 'Post neexistuje.' });
      const body = await readBody(req);
      if (body.action === 'generate') {
        const out = startVideo(post, { model: body.model, duration: Number(body.duration) || 8 });
        return json(res, out.error ? 400 : 200, out);
      }
      const act = POST_ACTIONS[body.action];
      if (!act) return json(res, 400, { error: 'Neznámá akce.' });
      act(post);
      save();
      return json(res, 200, { ok: true });
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Crazy Night Studio běží na http://localhost:${PORT}`);
  if (!ai) console.log('⚠ Chybí GEMINI_API_KEY — vlož ho do marketing/.env (viz marketing/README.md).');
});
