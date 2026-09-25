# Crazy Night Dashboard

Lokální webový dashboard pro marketing Crazy Night: `npm run dashboard` → http://localhost:4321

- **Přehled:** zájemci, sledující, zhlédnutí, cíle s tempem na den, co je na řadě, plán prvního měsíce.
- **Tvorba:** zadáš video nebo volný úkol a dashboard spustí Claude Code (`claude -p --chrome`)
  se skillem `crazynight-video`. Průběh vidíš živě, na hotový úkol můžeš navázat další zprávou.
  Hotová videa z `~/Downloads/crazy_night_videa` jsou v galerii.
- **Plán:** časy postování po dnech a kalendář na 14 dní (ručně, automaticky, nebo přes AI).
- **Statistiky:** zájemci z Vercel Blob (`npm run zajemci`) a čísla z TikToku, která načte Claude
  z TikTok Studia. Sledující jdou zapsat i ručně.
- **Potenciál:** kalkulačka zhlédnutí → web → e-maily → prodeje → obrat, spolu s rámcem z plánu projektu.

Úkoly běží postupně za sebou, protože sdílí jeden Chrome. Chrome s rozšířením Claude musí být zapnutý.
Data jsou v `dashboard/data/db.json` (mimo git).
