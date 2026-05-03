const SEC_COMPANY_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const SEC_FACTS_URL = cik => `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
const STOOQ_URL = symbol => `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`;
const YAHOO_CHART_URL = ticker => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(toYahooSymbol(ticker))}?range=5d&interval=1d`;
const FMP_LOGO_URL = ticker => `https://financialmodelingprep.com/image-stock/${encodeURIComponent(ticker)}.png`;
const CLEARBIT_LOGO_URL = domain => `https://logo.clearbit.com/${encodeURIComponent(domain)}`;

const LOGO_DOMAIN_OVERRIDES = {
  AAPL: 'apple.com', MSFT: 'microsoft.com', NVDA: 'nvidia.com', AMZN: 'amazon.com', GOOGL: 'abc.xyz', GOOG: 'abc.xyz', META: 'meta.com', TSLA: 'tesla.com', 'BRK.B': 'berkshirehathaway.com', BRK_A: 'berkshirehathaway.com', JPM: 'jpmorganchase.com', V: 'visa.com', MA: 'mastercard.com', UNH: 'unitedhealthgroup.com', HD: 'homedepot.com', PG: 'pg.com', COST: 'costco.com', NFLX: 'netflix.com', CRM: 'salesforce.com', ORCL: 'oracle.com', AMD: 'amd.com', ADBE: 'adobe.com', CSCO: 'cisco.com', KO: 'coca-cola.com', PEP: 'pepsico.com', DIS: 'disney.com', NKE: 'nike.com', MCD: 'mcdonalds.com', WMT: 'walmart.com', BAC: 'bankofamerica.com', XOM: 'exxonmobil.com', CVX: 'chevron.com', PFE: 'pfizer.com', MRK: 'merck.com', T: 'att.com', VZ: 'verizon.com', IBM: 'ibm.com', INTC: 'intel.com', PYPL: 'paypal.com', SHOP: 'shopify.com', SQ: 'block.xyz', PLTR: 'palantir.com', UBER: 'uber.com', ABNB: 'airbnb.com', SPOT: 'spotify.com', COIN: 'coinbase.com', MSTR: 'microstrategy.com', GDDY: 'godaddy.com'
};

const USER_AGENT = process.env.SEC_USER_AGENT || 'Pando Research Treasury Impact Engine contact@pandoresearch.io';
const CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const cache = new Map();

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 's-maxage=3600, stale-while-revalidate=86400' : 'no-store');
  res.end(JSON.stringify(payload));
}

function cleanTicker(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 12);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT
    }
  });
  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/csv,text/plain,*/*',
      'User-Agent': USER_AGENT
    }
  });
  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

function toCikString(cik) {
  return String(cik).replace(/\D/g, '').padStart(10, '0');
}

function toStooqSymbols(ticker) {
  const normalized = cleanTicker(ticker).toLowerCase();
  const variants = [normalized, normalized.replace(/\./g, '-')];
  return [...new Set(variants.map(symbol => symbol.endsWith('.us') ? symbol : `${symbol}.us`))];
}

function toYahooSymbol(ticker) {
  return cleanTicker(ticker).replace(/\./g, '-');
}

async function findCompanyByTicker(ticker) {
  const tickerMap = await fetchJson(SEC_COMPANY_TICKERS_URL);
  const company = Object.values(tickerMap).find(item => String(item.ticker || '').toUpperCase() === ticker);
  if (!company) {
    throw new Error(`No SEC company found for ticker "${ticker}"`);
  }
  return {
    ticker,
    cik: toCikString(company.cik_str),
    name: company.title
  };
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values.map(value => value.trim());
}

async function fetchStooqPrice(ticker) {
  const attempts = [];
  for (const symbol of toStooqSymbols(ticker)) {
    try {
      const csv = await fetchText(STOOQ_URL(symbol));
      const lines = csv.trim().split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) {
        throw new Error('no quote row');
      }
      const headers = parseCsvLine(lines[0]).map(header => header.toLowerCase());
      const row = parseCsvLine(lines[1]);
      const data = Object.fromEntries(headers.map((header, index) => [header, row[index]]));
      const close = Number(data.close);
      if (!Number.isFinite(close) || close <= 0) {
        throw new Error('no usable close price');
      }
      return {
        price: close,
        asOf: data.date && data.date !== 'N/D' ? data.date : '',
        provider: 'Stooq'
      };
    } catch (error) {
      attempts.push(`${symbol}: ${error.message}`);
    }
  }
  throw new Error(`Stooq returned no usable quote (${attempts.join('; ')})`);
}

async function fetchYahooChartPrice(ticker) {
  const data = await fetchJson(YAHOO_CHART_URL(ticker));
  const result = data?.chart?.result?.[0];
  const meta = result?.meta || {};
  const quote = result?.indicators?.quote?.[0] || {};
  const closes = Array.isArray(quote.close) ? quote.close.filter(value => Number.isFinite(Number(value)) && Number(value) > 0) : [];
  const lastClose = closes.length ? Number(closes[closes.length - 1]) : 0;
  const price = Number(meta.regularMarketPrice || meta.chartPreviousClose || meta.previousClose || lastClose);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('Yahoo chart returned no usable price');
  }

  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const lastTimestamp = timestamps.length ? Number(timestamps[timestamps.length - 1]) : 0;
  const asOf = lastTimestamp ? new Date(lastTimestamp * 1000).toISOString().slice(0, 10) : '';

  return {
    price,
    asOf,
    provider: 'Yahoo chart'
  };
}

async function fetchLivePrice(ticker) {
  const attempts = [];
  for (const fetcher of [fetchStooqPrice, fetchYahooChartPrice]) {
    try {
      return await fetcher(ticker);
    } catch (error) {
      attempts.push(error.message);
    }
  }
  throw new Error(`No usable quote returned for ticker "${ticker}". Tried Stooq and Yahoo chart. ${attempts.join(' · ')}`);
}

function flattenFacts(facts, taxonomy, conceptNames, preferredUnits) {
  const result = [];
  for (const conceptName of conceptNames) {
    const concept = facts?.[taxonomy]?.[conceptName];
    if (!concept || !concept.units) continue;
    const unitNames = preferredUnits && preferredUnits.length ? preferredUnits : Object.keys(concept.units);
    for (const unit of unitNames) {
      const factsForUnit = concept.units[unit];
      if (!Array.isArray(factsForUnit)) continue;
      for (const fact of factsForUnit) {
        const value = Number(fact.val);
        if (!Number.isFinite(value)) continue;
        result.push({
          value,
          end: fact.end || '',
          filed: fact.filed || '',
          form: fact.form || '',
          concept: conceptName,
          unit
        });
      }
    }
  }
  return result;
}

function chooseLatest(facts, options = {}) {
  const min = options.min ?? 0;
  const max = options.max ?? Number.POSITIVE_INFINITY;
  const allowedForms = options.forms || ['10-K', '10-Q', '20-F', '40-F', '8-K'];
  const filtered = facts
    .filter(fact => fact.value > min && fact.value < max)
    .filter(fact => !allowedForms.length || allowedForms.includes(fact.form));

  const candidates = filtered.length ? filtered : facts.filter(fact => fact.value > min && fact.value < max);
  candidates.sort((a, b) => {
    const aDate = `${a.end || ''}${a.filed || ''}`;
    const bDate = `${b.end || ''}${b.filed || ''}`;
    return bDate.localeCompare(aDate);
  });
  return candidates[0]?.value || 0;
}

function getUsdFact(facts, conceptNames) {
  return chooseLatest(flattenFacts(facts, 'us-gaap', conceptNames, ['USD']), { min: 0 });
}

function getSharesOutstanding(facts) {
  const deiShares = flattenFacts(facts, 'dei', ['EntityCommonStockSharesOutstanding'], ['shares']);
  const usGaapShares = flattenFacts(facts, 'us-gaap', ['CommonStocksIncludingAdditionalPaidInCapitalSharesOutstanding'], ['shares']);
  return chooseLatest([...deiShares, ...usGaapShares], { min: 1, max: 100_000_000_000 });
}

function getPublicFloat(facts) {
  return chooseLatest(flattenFacts(facts, 'dei', ['EntityPublicFloat'], ['USD']), { min: 1_000_000 });
}

function getEmployeeCount(facts) {
  const possible = [
    ...flattenFacts(facts, 'dei', ['EntityNumberOfEmployees'], ['pure']),
    ...flattenFacts(facts, 'us-gaap', ['NumberOfEmployees'], ['pure'])
  ];
  return Math.round(chooseLatest(possible, { min: 1, max: 5_000_000 }));
}

function getBookValue(facts) {
  const direct = getUsdFact(facts, [
    'StockholdersEquity',
    'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
    'PartnersCapital',
    'CommonStocksIncludingAdditionalPaidInCapital'
  ]);
  if (direct) return direct;

  const assets = getUsdFact(facts, ['Assets']);
  const liabilities = getUsdFact(facts, ['Liabilities']);
  return assets && liabilities && assets > liabilities ? assets - liabilities : 0;
}

function getCashPosition(facts) {
  return getUsdFact(facts, [
    'CashAndCashEquivalentsAtCarryingValue',
    'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
    'CashAndDueFromBanks',
    'CashAndCashEquivalentsFairValueDisclosure'
  ]);
}

function buildLogoCandidates(ticker) {
  const candidates = [FMP_LOGO_URL(ticker)];
  const domain = LOGO_DOMAIN_OVERRIDES[ticker] || LOGO_DOMAIN_OVERRIDES[ticker.replace('.', '_')];
  if (domain) candidates.push(CLEARBIT_LOGO_URL(domain));
  return {
    logoUrl: candidates[0],
    logoDomain: domain || '',
    logoCandidates: [...new Set(candidates)]
  };
}

async function buildCompany(ticker) {
  const companyMeta = await findCompanyByTicker(ticker);
  const [facts, quote] = await Promise.all([
    fetchJson(SEC_FACTS_URL(companyMeta.cik)),
    fetchLivePrice(ticker)
  ]);

  const sharesOutstanding = getSharesOutstanding(facts.facts);
  const publicFloat = getPublicFloat(facts.facts);
  const marketCap = sharesOutstanding ? sharesOutstanding * quote.price : publicFloat;
  const cashPosition = getCashPosition(facts.facts);
  const bookValue = getBookValue(facts.facts);
  const headcount = getEmployeeCount(facts.facts);

  if (!marketCap || !quote.price || !cashPosition || !bookValue) {
    throw new Error(`Insufficient company facts for ticker "${ticker}"`);
  }

  return {
    name: companyMeta.name,
    ticker,
    marketCap,
    cashPosition,
    headcount,
    currentStockPrice: quote.price,
    bookValue,
    ...buildLogoCandidates(ticker),
    live: true,
    source: `SEC EDGAR + ${quote.provider || 'live quote'}`,
    asOf: quote.asOf
  };
}

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const ticker = cleanTicker(req.query?.ticker || url.searchParams.get('ticker'));
    if (!ticker) {
      return sendJson(res, 400, { error: 'Missing ticker parameter.' });
    }

    const cached = cache.get(ticker);
    if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
      return sendJson(res, 200, cached.payload);
    }

    const company = await buildCompany(ticker);
    const payload = { company };
    cache.set(ticker, { createdAt: Date.now(), payload });
    return sendJson(res, 200, payload);
  } catch (error) {
    const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const fallbackTicker = cleanTicker(req.query?.ticker || url.searchParams.get('ticker'));
    return sendJson(res, 404, {
      error: error.message || `No data found for ticker "${fallbackTicker}".`,
      ticker: fallbackTicker,
      live: false
    });
  }
};
