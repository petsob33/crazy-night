// The AI marketing manager: a Gemini chat loop whose tools create posts and start Veo renders.
import { GoogleGenAI, Type } from '@google/genai';
import path from 'node:path';
import { db, save, cards, monthSpendUsd, OUT_DIR } from './store.mjs';
import { MODELS, generateVeo, composeCard } from './video.mjs';

export const TEXT_MODEL = process.env.STUDIO_MODEL || 'gemini-3.8-flash';
export const BUDGET_USD = Number(process.env.VEO_BUDGET_USD || 10);
export const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

const SYSTEM = `Jsi marketingový manažer párty karetní hry Crazy Night (vydavatel SobGame). Mluvíš česky, stručně a k věci, jako kolega z týmu.

O hře: párty karetní hra pro 4–10 hráčů, 18+. Každá karta je otázka „kdo z vás by…“ — hraje se o konkrétní lidi u stolu. Tón je drzý, roast, ale ne urážlivý. Hra zatím není v prodeji: sbíráme e-maily na https://crazynight.vercel.app a každý zapsaný dostane 10% slevu. TikTok: @dyos_app.
Brand: černá karta, růžová/magenta (#E8237F), písmo Russo One.

Tvoje práce: vymýšlet a připravovat obsah na TikTok/Instagram Reels a vyrábět k němu videa přes Google Veo. Hlavní metrika je watch time a počet zapsaných e-mailů.
Formáty, které rotuješ: AI atmosférická scéna + karta (hlavní, dá se udělat celý přes Veo), reakce na kartu (POV), „3 typy lidí na párty“, hook bez odpovědi („komentuj, kdo to je u vás“), tier list nejbrutálnějších karet, UGC výzva.

Jak funguje video: Veo vygeneruje 9:16 klip (4/6/8 s, se zvukem) a studio na něj samo přidá kartu s textem otázky v našem brandu (objeví se po ~1 s). Proto:
- veo_prompt piš ANGLICKY, filmově a konkrétně: scéna, lidé (dospělí 20–30 let), emoce/reakce, světlo (neon, party, růžové tóny), pohyb kamery, zvuk/atmosféra. Scéna má na otázku z karty reagovat nebo ji navodit.
- Ve videu nesmí být žádný text, titulky ani nápisy (kartu přidáme my). Žádné skutečné osobnosti, značky ani loga. Nezobrazuj pití alkoholu ani nic nezletilého — TikTok by to omezil.
- Střed obrazu bude částečně zakrytý kartou, důležitá akce ať je nahoře (obličeje).

Popisek (caption) česky, krátký, s hookem a výzvou („link v biu = −10 % na hru“, „označ kámoše, co to je“). 3–6 hashtagů (#crazynight #party #kdoznasby #pro tebe …).

Pravidla:
- Než vytvoříš post, podívej se na karty (list_cards) a existující posty (list_posts), ať se neopakuješ.
- Nové otázky na karty můžeš navrhovat, ale do balíčku je přidej (add_cards) jen když to uživatel odsouhlasí.
- Video stojí peníze (${Object.entries(MODELS).map(([k, m]) => `${k} $${m.usdPerSec}/s`).join(', ')}). Výchozí je lite a 8 s. Dražší model jen když o to uživatel požádá. Generuj videa, když o ně uživatel požádá nebo odsouhlasí plán; víc než 3 najednou jen na výslovný pokyn.
- Generování trvá pár minut a běží na pozadí — uživatel ho vidí na nástěnce vpravo. Nečekej na něj.
- Zveřejnění dělá uživatel sám (stáhne video, přidá trendy zvuk v TikToku). Ty připravuješ a radíš, kdy a jak postovat.
- Odpovídej krátce; detaily postů patří do nástěnky, ne do chatu.`;

const S = (description, extra = {}) => ({ type: Type.STRING, description, ...extra });

const TOOLS = [
  { name: 'list_cards', description: 'Vrátí všechny otázky z balíčku karet.' },
  {
    name: 'add_cards', description: 'Přidá nové otázky do balíčku (jen se souhlasem uživatele).',
    parameters: { type: Type.OBJECT, properties: { cards: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ['cards'] },
  },
  {
    name: 'list_posts', description: 'Vrátí posty na nástěnce, volitelně podle stavu.',
    parameters: { type: Type.OBJECT, properties: { status: S('návrh | generuje se | video hotové | schváleno | zveřejněno | chyba') } },
  },
  {
    name: 'create_post', description: 'Vytvoří návrh postu na nástěnce (bez videa).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        card_text: S('Otázka z karty, která se objeví ve videu (česky).'),
        format: S('Formát obsahu, např. "AI scéna + karta", "POV reakce", "hook bez odpovědi".'),
        hook: S('První věta/myšlenka, která udrží diváka (česky).'),
        veo_prompt: S('Anglický prompt pro Veo podle pravidel.'),
        caption: S('Popisek k postu (česky).'),
        hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
        planned_date: S('Plánované datum zveřejnění YYYY-MM-DD, pokud dává smysl.'),
        notes: S('Tipy pro uživatele: jaký trendy zvuk, čas postování apod.'),
      },
      required: ['card_text', 'format', 'veo_prompt', 'caption'],
    },
  },
  {
    name: 'update_post', description: 'Upraví existující post (jen předaná pole).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.INTEGER }, card_text: S(''), format: S(''), hook: S(''), veo_prompt: S(''), caption: S(''),
        hashtags: { type: Type.ARRAY, items: { type: Type.STRING } }, planned_date: S(''), notes: S(''),
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_post', description: 'Smaže post z nástěnky.',
    parameters: { type: Type.OBJECT, properties: { id: { type: Type.INTEGER } }, required: ['id'] },
  },
  {
    name: 'generate_video', description: 'Spustí na pozadí generování videa přes Veo pro daný post a přidá na něj kartu. Stojí peníze.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        post_id: { type: Type.INTEGER },
        model: S('lite | fast | standard', { enum: ['lite', 'fast', 'standard'] }),
        duration_seconds: { type: Type.INTEGER, description: '4, 6 nebo 8' },
      },
      required: ['post_id'],
    },
  },
  { name: 'get_budget', description: 'Kolik se tento měsíc utratilo za Veo a jaký je limit.' },
];

const POST_FIELDS = ['card_text', 'format', 'hook', 'veo_prompt', 'caption', 'hashtags', 'planned_date', 'notes'];
const findPost = (id) => db.posts.find((p) => p.id === Number(id));

export function startVideo(post, { model = 'lite', duration = 8 } = {}) {
  if (!ai) return { error: 'Chybí GEMINI_API_KEY.' };
  if (post.status === 'generuje se') return { error: 'Video pro tenhle post se už generuje.' };
  if (![4, 6, 8].includes(duration)) duration = 8;
  const m = MODELS[model] ? model : 'lite';
  const cost = MODELS[m].usdPerSec * duration;
  if (monthSpendUsd() + cost > BUDGET_USD) {
    return { error: `Překročil by se měsíční limit $${BUDGET_USD} (utraceno $${monthSpendUsd().toFixed(2)}, video by stálo $${cost.toFixed(2)}).` };
  }
  Object.assign(post, { status: 'generuje se', progress: 'Odesílám do Veo…', error: null });
  save();

  const stamp = `${post.id}-${Date.now()}`;
  const raw = path.join(OUT_DIR, `raw-${stamp}.mp4`);
  const final = `post-${stamp}.mp4`;
  (async () => {
    try {
      const { costUsd } = await generateVeo(ai, {
        prompt: post.veo_prompt, model: m, durationSeconds: duration, outFile: raw,
        onStatus: (s) => { post.progress = s; },
      });
      db.spend.push({ at: new Date().toISOString(), usd: costUsd, postId: post.id, model: m });
      post.progress = 'Přidávám kartu…';
      await composeCard({ inFile: raw, outFile: path.join(OUT_DIR, final), text: post.card_text });
      Object.assign(post, { status: 'video hotové', video: final, rawVideo: path.basename(raw), progress: null, model: m });
    } catch (e) {
      Object.assign(post, { status: 'chyba', error: String(e.stderr || e.message || e), progress: null });
    }
    save();
  })();
  return { ok: true, message: `Generování spuštěno (${m}, ${duration} s, ~$${cost.toFixed(2)}).` };
}

function runTool(name, args = {}) {
  switch (name) {
    case 'list_cards': return { cards: cards.all() };
    case 'add_cards': return { added: cards.add(args.cards || []) };
    case 'list_posts': {
      const list = args.status ? db.posts.filter((p) => p.status === args.status) : db.posts;
      return { posts: list.map(({ id, status, card_text, format, caption, planned_date, error }) => ({ id, status, card_text, format, caption, planned_date, error })) };
    }
    case 'create_post': {
      const post = { id: db.nextId++, status: 'návrh', created: new Date().toISOString(), hashtags: [] };
      for (const f of POST_FIELDS) if (args[f] !== undefined) post[f] = args[f];
      db.posts.unshift(post);
      save();
      return { ok: true, id: post.id };
    }
    case 'update_post': {
      const post = findPost(args.id);
      if (!post) return { error: `Post ${args.id} neexistuje.` };
      for (const f of POST_FIELDS) if (args[f] !== undefined) post[f] = args[f];
      save();
      return { ok: true };
    }
    case 'delete_post': {
      const before = db.posts.length;
      db.posts = db.posts.filter((p) => p.id !== Number(args.id));
      save();
      return { ok: db.posts.length < before };
    }
    case 'generate_video': {
      const post = findPost(args.post_id);
      if (!post) return { error: `Post ${args.post_id} neexistuje.` };
      return startVideo(post, { model: args.model, duration: args.duration_seconds });
    }
    case 'get_budget': return { spent_usd: +monthSpendUsd().toFixed(2), limit_usd: BUDGET_USD };
    default: return { error: `Neznámý nástroj ${name}` };
  }
}

const TOOL_LABELS = {
  list_cards: 'Prochází karty', add_cards: 'Přidává karty', list_posts: 'Kouká na nástěnku', create_post: 'Vytváří post',
  update_post: 'Upravuje post', delete_post: 'Maže post', generate_video: 'Spouští Veo', get_budget: 'Kontroluje rozpočet',
};

// Keep the model's context bounded, cutting only at a plain user message so call/response pairs stay intact.
function trimHistory() {
  const MAX = 60;
  if (db.history.length <= MAX) return;
  let cut = db.history.length - MAX;
  while (cut < db.history.length && !(db.history[cut].role === 'user' && db.history[cut].parts?.[0]?.text)) cut++;
  db.history = db.history.slice(cut);
}

export async function chat(message) {
  db.chat.push({ role: 'user', text: message, at: new Date().toISOString() });
  db.history.push({ role: 'user', parts: [{ text: `[${new Date().toLocaleDateString('cs-CZ')}] ${message}` }] });
  save();

  for (let step = 0; step < 12; step++) {
    const res = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: db.history,
      config: { systemInstruction: SYSTEM, tools: [{ functionDeclarations: TOOLS }] },
    });
    const content = res.candidates?.[0]?.content;
    if (!content) throw new Error('Gemini nevrátil odpověď' + (res.promptFeedback?.blockReason ? ` (${res.promptFeedback.blockReason})` : '.'));
    // The full content goes back into history so Gemini 3 thought signatures are preserved.
    db.history.push(content);

    const calls = res.functionCalls || [];
    const text = (content.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
    if (text) db.chat.push({ role: 'ai', text, at: new Date().toISOString() });
    if (!calls.length) break;

    const responses = calls.map((c) => {
      const out = runTool(c.name, c.args);
      db.chat.push({ role: 'tool', text: TOOL_LABELS[c.name] || c.name, error: out.error || null, at: new Date().toISOString() });
      return { functionResponse: { id: c.id, name: c.name, response: out } };
    });
    db.history.push({ role: 'user', parts: responses });
    save();
  }
  trimHistory();
  save();
}
