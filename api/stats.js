// Vercel serverless function: GET /api/stats
// Veřejná čísla pro landing page: sledující a lajky z TikToku (@dyos_app) a počet zapsaných zájemců.
// Odpověď se cachuje na CDN hodinu, TikTok ani Blob se tedy netahají při každé návštěvě.
// Co se nepodaří načíst, vrací se jako null a stránka to prostě nezobrazí.

const { list } = require('@vercel/blob');

const TIKTOK_USER = 'dyos_app';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

module.exports = async (req, res) => {
  const [tiktok, signups] = await Promise.all([tiktokStats(), countSignups()]);
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).json({ tiktok, signups });
};

async function tiktokStats() {
  try {
    const r = await fetch(`https://www.tiktok.com/@${TIKTOK_USER}`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'cs-CZ,cs;q=0.9' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const m = (await r.text()).match(/"stats":\{[^}]*"followerCount":(\d+)[^}]*"heartCount":(\d+)/);
    if (!m) throw new Error('stats not found in page');
    return { followers: Number(m[1]), likes: Number(m[2]) };
  } catch (err) {
    console.error('stats: tiktok', err && err.message);
    return null;
  }
}

async function countSignups() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    let n = 0, cursor;
    do {
      const page = await list({ prefix: 'zajemci/', cursor });
      n += page.blobs.length;
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return n;
  } catch (err) {
    console.error('stats: blob', err && err.message);
    return null;
  }
}
