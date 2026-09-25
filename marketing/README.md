# Crazy Night Studio — AI marketing manažer

Lokální webové rozhraní, kde s AI manažerem (Gemini) chatuješ a on za tebe plánuje posty,
píše popisky a generuje videa přes **Google Veo**. Na každé video se automaticky přidá
karta s otázkou v brandu (černá karta, růžové Russo One, logo).

## Spuštění

1. Klíč vytvoř na https://aistudio.google.com/apikey. Veo nemá free tier, takže u projektu
   musí být zapnutý billing.
2. Vlož ho do `marketing/.env`:
   ```
   GEMINI_API_KEY=tvuj-klic
   VEO_BUDGET_USD=10
   ```
3. `npm run studio` → http://localhost:4321

## Jak to funguje

- Vlevo je chat s manažerem, vpravo nástěnka postů (návrh → video hotové → schváleno → zveřejněno).
- Manažer bere otázky z `marketing/cards.json`, nové přidává jen s tvým souhlasem.
- Video: Veo 3.1, 9:16, 720p, se zvukem. Výchozí je Lite (8 s ≈ $0.40), Fast ≈ $0.80, Standard ≈ $3.20.
  Měsíční strop hlídá `VEO_BUDGET_USD`.
- Hotové video stáhneš, v TikToku přidáš trendy zvuk a zveřejníš. Pak klikneš „Zveřejněno“.
- Data jsou v `marketing/data/`, videa v `marketing/out/`. Obojí je mimo git.
- Textový model změníš přes `STUDIO_MODEL` (výchozí `gemini-3.8-flash`).
