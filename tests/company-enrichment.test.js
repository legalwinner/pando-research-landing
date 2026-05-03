const assert = require('node:assert/strict');

process.env.FMP_API_KEY = 'test-key';
process.env.SEC_USER_AGENT = 'Pando Research Treasury Impact Engine tests@example.com';

let handler = require('../api/company.js');

const tickerMeta = {
  FMPX: { cik_str: 1, ticker: 'FMPX', title: 'FMP Employee Corp.' },
  SECX: { cik_str: 2, ticker: 'SECX', title: 'SEC Employee Corp.' },
  REVX: { cik_str: 3, ticker: 'REVX', title: 'Revenue Estimate Corp.' },
  MKTX: { cik_str: 4, ticker: 'MKTX', title: 'Market Cap Estimate Corp.' }
};

const cikToTicker = Object.fromEntries(
  Object.values(tickerMeta).map(item => [String(item.cik_str).padStart(10, '0'), item.ticker])
);

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

function textResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(payload),
    text: async () => payload
  };
}

function secFact(value, unit = 'USD') {
  return {
    val: value,
    end: '2025-12-31',
    filed: '2026-02-15',
    form: '10-K',
    unit
  };
}

function baseCompanyFacts(ticker) {
  const usGaap = {
    CashAndCashEquivalentsAtCarryingValue: { units: { USD: [secFact(10_000_000)] } },
    StockholdersEquity: { units: { USD: [secFact(20_000_000)] } }
  };

  const dei = {
    EntityCommonStockSharesOutstanding: { units: { shares: [secFact(1_000_000, 'shares')] } }
  };

  if (ticker === 'SECX') {
    dei.EntityNumberOfEmployees = { units: { pure: [secFact(2500, 'pure')] } };
  }

  if (ticker === 'REVX') {
    usGaap.RevenueFromContractWithCustomerExcludingAssessedTax = {
      units: { USD: [secFact(60_000_000)] }
    };
  }

  return { facts: { dei, 'us-gaap': usGaap } };
}

let fmpFetches = 0;

global.fetch = async url => {
  const target = String(url);

  if (target.includes('company_tickers.json')) {
    return jsonResponse(tickerMeta);
  }

  if (target.includes('data.sec.gov/api/xbrl/companyfacts')) {
    const cik = target.match(/CIK(\d+)\.json/)?.[1];
    return jsonResponse(baseCompanyFacts(cikToTicker[cik]));
  }

  if (target.includes('stooq.com')) {
    return textResponse('Symbol,Date,Time,Open,High,Low,Close,Volume\nTEST,2026-05-03,00:00,100,100,100,100,1000');
  }

  if (target.includes('financialmodelingprep.com/stable/profile')) {
    fmpFetches += 1;
    const symbol = new URL(target).searchParams.get('symbol');
    if (symbol === 'FMPX') {
      return jsonResponse([{ symbol, fullTimeEmployees: '1934', sector: 'Technology' }]);
    }
    return jsonResponse([{ symbol, sector: 'Technology' }]);
  }

  throw new Error(`Unexpected fetch: ${target}`);
};

function callCompany(ticker, activeHandler = handler) {
  return new Promise(resolve => {
    const req = {
      url: `/api/company?ticker=${ticker}`,
      query: { ticker },
      headers: { host: 'example.test' }
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      end(payload) {
        resolve({ status: this.statusCode, payload: JSON.parse(payload) });
      }
    };
    activeHandler(req, res);
  });
}

(async () => {
  const fmp = await callCompany('FMPX');
  assert.equal(fmp.status, 200);
  assert.equal(fmp.payload.company.employeeCount, 1934);
  assert.equal(fmp.payload.company.headcount, 1934);
  assert.equal(fmp.payload.company.employeeCountRange, '1,001–5,000');
  assert.equal(fmp.payload.company.employeeCountSource, 'fmp_profile');
  assert.equal(fmp.payload.company.employeeCountConfidence, 'high');
  assert.equal(fmp.payload.company.employeeCountIsEstimated, false);

  const sec = await callCompany('SECX');
  assert.equal(sec.status, 200);
  assert.equal(sec.payload.company.employeeCount, 2500);
  assert.equal(sec.payload.company.employeeCountSource, 'sec_filing');
  assert.equal(sec.payload.company.employeeCountConfidence, 'high');

  delete process.env.FMP_API_KEY;
  delete require.cache[require.resolve('../api/company.js')];
  const fmpFetchesBeforeDisabledRun = fmpFetches;
  const handlerWithoutFmp = require('../api/company.js');
  const disabledFmp = await callCompany('SECX', handlerWithoutFmp);
  assert.equal(disabledFmp.status, 200);
  assert.equal(disabledFmp.payload.company.employeeCount, 2500);
  assert.equal(disabledFmp.payload.company.employeeCountSource, 'sec_filing');
  assert.equal(fmpFetches, fmpFetchesBeforeDisabledRun);

  const revenue = await callCompany('REVX');
  assert.equal(revenue.status, 200);
  assert.equal(revenue.payload.company.employeeCount, 100);
  assert.equal(revenue.payload.company.employeeCountSource, 'financial_model_estimate');
  assert.equal(revenue.payload.company.employeeCountConfidence, 'low');
  assert.equal(revenue.payload.company.employeeCountIsEstimated, true);

  const marketCap = await callCompany('MKTX');
  assert.equal(marketCap.status, 200);
  assert.equal(marketCap.payload.company.employeeCount, 24);
  assert.equal(marketCap.payload.company.employeeCountSource, 'sector_fallback_estimate');
  assert.equal(marketCap.payload.company.employeeCountConfidence, 'low');
  assert.equal(marketCap.payload.company.employeeCountIsEstimated, true);

  console.log('company enrichment tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
