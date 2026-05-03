# Pando DAT Calculator implementation

Drop these files into `legalwinner/pando-research-landing`:

```text
dat/index.html
api/company.js
```

## What changed

- Creates a `/dat/` subpage as a self-contained static calculator page.
- Keeps Pando Research brand tokens from the landing page: warm neutral background, deep green accent, Source Serif display type, Inter body type, rounded editorial cards, sticky translucent nav.
- Replaces the old top-to-bottom flow with a two-column desktop workspace:
  - left: company metrics, presets, and assumptions
  - right: sticky executive summary, scenario chart, and value breakdown
  - top: sticky desktop quote strip showing current price, modelled price, implied move, and active-lever impact while sliders change
- Adds mobile-first UX:
  - single-column control flow
  - thumb-safe sliders and card toggles
  - sticky bottom impact bar so users do not lose the result while adjusting assumptions
  - desktop strip automatically hides on mobile to avoid competing sticky UI
  - responsive SVG chart with no external chart dependency
- Keeps the original calculation model but improves confusing copy:
  - the tokenization footer now says `35% of book value · $X` instead of `$35%`
  - the bull chart is described as a macro-overlay scenario instead of contradicting the prose
- Adds a server-side free data route:
  - SEC EDGAR company tickers + company facts for company inputs
  - Stooq CSV quote endpoint for price
  - optional FMP company profile enrichment for employee count when `FMP_API_KEY` is configured
  - deterministic SEC/financial-model employee fallbacks so the calculator never receives a blank employee count
  - no provider API key exposed to the browser
  - static fallbacks remain available client-side for AAPL, MSFT, TSLA, COIN, and MSTR

## Deployment notes

`api/company.js` is written as a Vercel-style Node serverless function. It uses native `fetch`, so deploy on Node 18+.

Set this environment variable for SEC politeness and rate-limit hygiene:

```bash
SEC_USER_AGENT="Pando Research Treasury Impact Engine research@pandoresearch.io"
```

Optionally set this environment variable for Financial Modeling Prep company profile enrichment:

```bash
FMP_API_KEY="..."
```

The API route returns:

```json
{
  "company": {
    "name": "Apple Inc.",
    "ticker": "AAPL",
    "marketCap": 123,
    "cashPosition": 123,
    "headcount": 123,
    "employeeCount": 123,
    "employeeCountRange": "51–200",
    "employeeCountSource": "fmp_profile",
    "employeeCountConfidence": "high",
    "employeeCountLastUpdated": "2026-05-03",
    "employeeCountIsEstimated": false,
    "currentStockPrice": 123,
    "bookValue": 123,
    "live": true,
    "source": "SEC EDGAR + Stooq",
    "asOf": "2026-05-03"
  }
}
```

If the site is deployed as pure GitHub Pages without serverless support, `/api/company` will not run. The calculator still works for the built-in fallback tickers, but arbitrary tickers require deploying the API route on Vercel, Netlify Functions, Cloudflare Workers, or equivalent.

## Employee count enrichment

`/api/company` keeps `headcount` for backwards compatibility and also returns employee metadata. The route tries `FMP_API_KEY` + FMP profile `fullTimeEmployees`, then SEC companyfacts employee concepts, then estimates from annual revenue and sector revenue-per-employee assumptions. If revenue is missing, it estimates revenue from market cap and sector revenue multiples. Successful company responses should always include a positive employee count and a source/confidence label.

## Ticker logos

The floating bars now display company logos without a paid market-data key. The client first tries a direct ticker logo image (`financialmodelingprep.com/image-stock/{TICKER}.png`), then falls back to a domain-based logo (`logo.clearbit.com/{domain}`) for mapped tickers, and finally shows a branded ticker-initials tile if neither image resolves.

This keeps the UI attractive without blocking the calculator. For production traffic, sanity-check the current provider terms and availability; the fallback initials mean the calculator still looks intentional if an external logo service changes behavior.


## Local testing notes for live tickers

The calculator can be opened as static HTML for the curated demo tickers because those records are embedded in the page. Arbitrary tickers need the server route at `/api/company?ticker=...`.

If a non-demo ticker such as `NOW` returns an error saying the live data endpoint is not active, the page is being served without the `api/company.js` function. Run the project with a serverless dev server, for example:

```bash
npm i -g vercel
SEC_USER_AGENT="Pando Research Treasury Impact Engine research@pandoresearch.io" vercel dev
```

The API first tries Stooq for the quote and then falls back to Yahoo Chart. Company fundamentals come from SEC EDGAR.
