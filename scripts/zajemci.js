// Vypíše všechny zájemce z Vercel Blob úložiště jako CSV (email,cas).
// Spuštění: `npm run zajemci` (stáhne si token z Vercelu), výstup jde přesměrovat do souboru:
//   npm run --silent zajemci > zajemci.csv
const { list } = require('@vercel/blob');

async function main() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error('Chybí BLOB_READ_WRITE_TOKEN (spouštěj přes `npm run zajemci`).');

  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix: 'zajemci/', cursor, token });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const rows = await Promise.all(blobs.map(async (b) => {
    const r = await fetch(b.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`Nejde stáhnout ${b.pathname}: ${r.status}`);
    return r.json();
  }));

  rows.sort((a, b) => a.at.localeCompare(b.at));
  console.log('email,cas');
  for (const { email, at } of rows) console.log(`${email},${at}`);
  console.error(`Celkem zájemců: ${rows.length}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
