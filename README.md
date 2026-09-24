# Crazy Night – landing page

Statická stránka (jeden `index.html` + `assets/`), hostovaná zdarma na Vercelu:
https://crazynight.vercel.app

Nasazení: `npx vercel --prod` v této složce.

## Sběr e-mailů (Resend)

Formulář posílá e-mail na `/api/subscribe` (`api/subscribe.js`, Vercel funkce). Ta ti pošle
upozornění na nového zájemce přes [Resend](https://resend.com), zdarma do 3000 e-mailů měsíčně.

Nastavení (jednou):
1. Založ účet na resend.com → **API Keys** → **Create API Key** (stačí oprávnění Sending access).
2. Ve složce projektu nastav proměnné prostředí a nasaď:
   ```
   npx vercel env add RESEND_API_KEY production
   npx vercel env add NOTIFY_EMAIL production   # e-mail, se kterým máš účet na Resendu
   npx vercel --prod
   ```

Bez vlastní domény posílá Resend jen na e-mail, se kterým je účet založený, což pro upozornění stačí.
Dokud proměnné nejsou nastavené, stránka návštěvníkovi ukáže „Zápis spouštíme za pár dní“.
