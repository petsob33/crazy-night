// Vercel serverless function: POST /api/subscribe  { email, website }
// Pošle upozornění na nového zájemce e-mailem přes Resend (https://resend.com).
//
// Proměnné prostředí (Vercel → Project → Settings → Environment Variables):
//   RESEND_API_KEY  – API klíč z resend.com
//   NOTIFY_EMAIL    – kam upozornění posílat (bez vlastní domény musí být stejný
//                     jako e-mail, se kterým je založený účet na Resendu)
//   NOTIFY_FROM     – volitelné, odesílatel; výchozí "Crazy Night <onboarding@resend.dev>"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method' });
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : (req.body || {});
  const email = String(body.email || '').trim().slice(0, 254);

  // honeypot: boti vyplní skryté pole, tváříme se, že je všechno v pořádku
  if (body.website) return res.status(200).json({ ok: true });

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, error: 'email' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL;
  if (!apiKey || !to) {
    console.error('subscribe: RESEND_API_KEY or NOTIFY_EMAIL is not set');
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }

  const when = new Date().toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' });
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.NOTIFY_FROM || 'Crazy Night <onboarding@resend.dev>',
      to: [to],
      reply_to: email,
      subject: `Nový zájemce o Crazy Night: ${email}`,
      text: `Na crazynight.vercel.app se zapsal nový zájemce.\n\nE-mail: ${email}\nČas: ${when}\n\nNa tenhle e-mail můžeš rovnou odpovědět.`,
    }),
  });

  if (!r.ok) {
    console.error('subscribe: Resend error', r.status, await r.text());
    return res.status(502).json({ ok: false, error: 'send' });
  }
  return res.status(200).json({ ok: true });
};

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
