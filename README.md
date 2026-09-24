# Crazy Night – landing page

Statická stránka (jeden `index.html` + `assets/`), hostovaná zdarma na Vercelu:
https://crazynight.vercel.app

Nasazení: `npx vercel --prod` v této složce.

## Sběr e-mailů

Formulář posílá e-mail na `/api/subscribe` (`api/subscribe.js`, Vercel funkce), která:

1. **uloží zájemce** do soukromého úložiště Vercel Blob `crazynight-zajemci` (region fra1),
2. **pošle upozornění** na pesobusines@gmail.com přes [Resend](https://resend.com).

Zápis projde, když se povede aspoň jedno z toho, takže se žádný zájemce neztratí.

### Seznam zájemců

```
npx vercel blob list --prefix zajemci/          # výpis souborů
npx vercel blob get <pathname>                   # obsah jednoho záznamu
```

Úložiště najdeš i ve Vercelu: projekt crazynight → **Storage** → crazynight-zajemci.

### Proměnné prostředí (Vercel, Production)

- `RESEND_API_KEY`: klíč z resend.com
- `NOTIFY_EMAIL`: kam chodí upozornění (bez vlastní domény jen e-mail účtu na Resendu)
- `BLOB_READ_WRITE_TOKEN`: nastavil Vercel sám při připojení úložiště

Výměna klíče: `npx vercel env rm RESEND_API_KEY production && npx vercel env add RESEND_API_KEY production && npx vercel --prod`
