# Markets &amp; Headlines

Live multi-asset dashboard: ~190 stocks across all major sectors, all
major crypto, commodities futures, macro indices, and 40+ FX
currencies — with real-time news per asset and an optional
**AI-generated analysis** panel powered by Claude.

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:5173`.

## Deploy

The app deploys to Vercel as-is (Vite + serverless API routes under
`api/`). Push to `main` and Vercel auto-deploys.

## Environment variables

Add these in **Vercel → Project → Settings → Environment Variables**:

| Variable        | Required for       | Notes                                                         |
| --------------- | ------------------ | ------------------------------------------------------------- |
| `GROQ_API_KEY`  | AI analysis panel  | Free, no credit card. Sign up at <https://console.groq.com/>, generate a key, paste it here. The model used is `llama-3.3-70b-versatile`. Without the key, the panel still shows technical signals + headlines (no AI narrative). |

After adding the key, redeploy (the next push to `main` is enough).

## Tabs

- **Overview** — hero stats (Oil / Gold / S&P 500 / BTC), top movers,
  most active by volume, latest headlines. Click any asset to open
  its full chart in Prices.
- **Prices** — full asset table with search (`/` to focus), grouped
  category filters, multi-timeframe chart (1D / 5D / 1M / 3M / 6M /
  1Y / YTD), per-asset detail panel, AI analysis, and asset-specific
  news.
- **Currency** — converter for any of 40+ currencies (incl. SGD,
  HKD, INR, AED, ZAR), live rates against the dashboard currency,
  currency &amp; markets news.
- **Intel** — Google News RSS feed across shipping, energy, metals,
  agri, geopolitical, tech, data, finance, currency, crypto. Plus a
  Breaking filter for high-severity headlines.

The dashboard currency dropdown (top right of nav) re-formats every
convertible price in the app to your chosen currency.
