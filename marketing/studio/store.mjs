// Tiny JSON-file persistence: posts, chat history and Veo spend live in marketing/data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_DIR = path.join(ROOT, 'marketing/data');
export const OUT_DIR = path.join(ROOT, 'marketing/out');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const FILE = path.join(DATA_DIR, 'studio.json');
const CARDS_FILE = path.join(ROOT, 'marketing/cards.json');

export const db = fs.existsSync(FILE)
  ? JSON.parse(fs.readFileSync(FILE, 'utf8'))
  : { posts: [], history: [], chat: [], spend: [], nextId: 1 };

export function save() {
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(db, null, 2));
  fs.renameSync(FILE + '.tmp', FILE);
}

export const cards = {
  all: () => JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8')),
  add(list) {
    const cur = cards.all();
    const fresh = list.map((c) => c.trim()).filter((c) => c && !cur.includes(c));
    fs.writeFileSync(CARDS_FILE, JSON.stringify([...cur, ...fresh], null, 2) + '\n');
    return fresh.length;
  },
};

export function monthSpendUsd() {
  const month = new Date().toISOString().slice(0, 7);
  return db.spend.filter((s) => s.at.startsWith(month)).reduce((a, s) => a + s.usd, 0);
}

// A video still "generating" after a restart was orphaned — mark it so it can be retried.
for (const p of db.posts) {
  if (p.status === 'generuje se') { p.status = 'návrh'; p.error = 'Generování přerušeno restartem studia.'; }
}
