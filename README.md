# Crazy Night – landing page

Statická stránka (jeden `index.html` + `assets/`), připravená pro hostování zdarma na GitHub Pages.

## Sběr e-mailů (Google Form)

Stránka posílá e-maily do Google Formu. Nastavení:

1. Vytvoř Google Form s jednou otázkou typu **Krátká odpověď** s názvem „E-mail“ a klikni na **Publikovat**.
2. Vpravo nahoře „⋮“ → **Získat předvyplněný odkaz**, do pole napiš třeba `test@test.cz` → **Získat odkaz** → zkopíruj ho.
3. Z odkazu vezmi:
   - ID formuláře: `https://docs.google.com/forms/d/e/<ID>/viewform?...`
   - název pole: `entry.123456789=test@test.cz` → `entry.123456789`
4. V `index.html` vyplň:
   ```js
   var GOOGLE_FORM_ACTION = "https://docs.google.com/forms/d/e/<ID>/formResponse";
   var GOOGLE_FORM_EMAIL_FIELD = "entry.123456789";
   ```
5. Commitni a pushni.

Odpovědi najdeš ve formuláři v záložce **Odpovědi**, odkud je jde propojit s Google tabulkou.

Dokud hodnoty nejsou vyplněné, formulář na stránce nic neodešle a návštěvníkovi ukáže „Zápis spouštíme za pár dní“.
