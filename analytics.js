/* -------------------------------------------------------
   ANALYTICS.JS — EV Charging Station Data Analysis
   Reads from Back4App Parse "Fast_Charging_Stations" class.
   Renders Chart.js visualizations for US and California.
------------------------------------------------------- */

const CHART_COLORS = [
  '#2f6f6e', '#f3b29b', '#f2cf63', '#c7e3d9', '#5ba8a7',
  '#e8a585', '#d4b545', '#a0c9bf', '#3c4559', '#8cc5c4',
  '#f0c8b5', '#e8d88a', '#b5d9cf', '#7bc0bf', '#f5dcc0',
  '#e5cc70', '#c4e4de', '#4d9190', '#f2b9a5'
];

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun',
                     'Jul','Aug','Sep','Oct','Nov','Dec'];

const US_STATES = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California',
  CO:'Colorado', CT:'Connecticut', DE:'Delaware', FL:'Florida', GA:'Georgia',
  HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana', IA:'Iowa',
  KS:'Kansas', KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland',
  MA:'Massachusetts', MI:'Michigan', MN:'Minnesota', MS:'Mississippi',
  MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada', NH:'New Hampshire',
  NJ:'New Jersey', NM:'New Mexico', NY:'New York', NC:'North Carolina',
  ND:'North Dakota', OH:'Ohio', OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania',
  RI:'Rhode Island', SC:'South Carolina', SD:'South Dakota', TN:'Tennessee',
  TX:'Texas', UT:'Utah', VT:'Vermont', VA:'Virginia', WA:'Washington',
  WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming'
};

/* Cached chart instances */
let stateChartInst        = null;
let monthlyChartInst      = null; // existing monthly cumulative USA
let monthlyAddedChartInst = null; // new: monthly additions
let topNetworksChartInst  = null; // new: top networks by cumulative (Jun 2026)
let networkChartInst      = null;
let heroChartInst         = null;
let caCityChartInst       = null;
let caMonthlyChartInst   = null; // legacy
let caPlugsMonthlyChartInst = null;
let caStationsMonthlyChartInst = null;

/* County-specific deep-dive charts (driven by map click / dropdown) */
let caCountyPlugsGrowthInst = null;
let caCountyPlugsCumulativeInst = null;
let caCountyStationsGrowthInst = null;
let caCountyStationsCumulativeInst = null;
let caNetworkShareInst = null;
let caTopCountiesStationsInst = null;

/* CA county map state: rendered shapes/labels + selection wiring */
let caCountyShapes = {};   // normalized county name -> <path>
let caCountyLabels = {};   // normalized county name -> <text>
let caCountySelected = []; // currently selected counties (display names)
let caCountyControlsBound = false;
let caCountySeriesCache = {}; // fieldName -> per-county monthly series
const MAX_CA_COMPARE_COUNTIES = 4;

let countyHeroChartInst = null;

/* New: state-specific monthly growth/plugs + stations */
let monthlyStatePlugsGrowthInst  = null;
let monthlyStateStationsInst     = null;

/* US plugs analysis page chart instances */
let usPlugsGrowthInst       = null; // exists earlier in file; kept for clarity
let usPlugsCumulativeInst  = null;
let usStationsGrowthInst   = null;
let usStationsCumulativeInst = null;
let usTopNetworksInst      = null;
let usTopCountiesInst      = null;
const MAX_US_COMPARE_STATES = 4;

/* Cached raw data */
let cachedUSData = null;
let cachedCAData = null;

/* -------------------------------------------------------
   HELPERS
------------------------------------------------------- */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Detect errors that are likely retryable backend/transport failures.
// In this app, the common symptom is Parse returning HTML (502 page)
// which then causes "Unexpected token '<'" JSON parse failures.
function isLikelyRetryableBackendError(err) {
  const msg = String(err && (err.message || err.toString ? err.toString() : err) || err || '');
  const lower = msg.toLowerCase();

  return (
    lower.includes('502') ||
    lower.includes('bad gateway') ||
    lower.includes('unexpected token') && lower.includes('<') ||
    lower.includes('timeout') ||
    lower.includes('network error') ||
    lower.includes('econn') ||
    lower.includes('fetch')
  );
}

async function withRetry(fn, {
  retries = 3,
  baseDelayMs = 400,
  factor = 1.8
} = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = isLikelyRetryableBackendError(err);

      // If not retryable, fail fast.
      if (!retryable) throw err;

      // If this was the last attempt, break.
      if (attempt === retries) break;

      const delay = Math.round(baseDelayMs * Math.pow(factor, attempt));
      await sleep(delay);
    }
  }
  throw lastErr;
}

function parseOpenDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === 'string') {
    let d = new Date(raw);
    if (!isNaN(d.getTime())) return d;
    // Try M/D/YYYY or MM/DD/YYYY
    const parts = raw.split('/');
    if (parts.length === 3) {
      d = new Date(`${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

function getYearMonth(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,'0')}`;
}

async function fetchLatestYearMonth(className, fieldName = 'year_month') {
  const qLatest = new Parse.Query(className);
  qLatest.select([fieldName]);
  qLatest.descending(fieldName);
  qLatest.limit(1);
  const rows = await qLatest.find();
  return rows?.[0]?.get(fieldName) || null;
}

function generateMonthsSince2026() {
  const months = [];
  const start  = new Date(2026, 0, 1);
  const now    = new Date();
  let cur      = new Date(start);
  while (cur <= now) {
    months.push(getYearMonth(cur));
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

function showLoader(wrapId, msg) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const loader = wrap.querySelector('.chart-loader');
  const canvas = wrap.querySelector('canvas');
  if (loader) { loader.style.display = 'flex'; loader.textContent = msg || 'Loading…'; }
  if (canvas)  canvas.style.display = 'none';
}

function hideLoader(wrapId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const loader = wrap.querySelector('.chart-loader');
  const canvas = wrap.querySelector('canvas');
  if (loader) loader.style.display = 'none';
  if (canvas) canvas.style.display = 'block';
}

function setStatVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

/* -------------------------------------------------------
   PARSE DATA FETCHING
------------------------------------------------------- */
async function fetchRecords(fields, equalToField, equalToVal) {
  const query = new Parse.Query('Fast_Charging_Stations');
  query.select(fields);
  if (equalToField) query.equalTo(equalToField, equalToVal);
  query.limit(5000);

  let all  = [];
  let skip = 0;
  while (true) {
    query.skip(skip);
    const batch = await query.find();
    all = all.concat(batch);
    if (batch.length < 5000) break;
    skip += 5000;
  }
  return all;
}

/* -------------------------------------------------------
   US STATE ANALYSIS
------------------------------------------------------- */
async function fetchUSStatsFromSummaries(latestYearMonth = null) {
  // If not provided, use the latest available year_month in State_Summary.
  if (!latestYearMonth) {
    latestYearMonth = await fetchLatestYearMonth('State_Summary', 'year_month');
    if (!latestYearMonth) throw new Error('No State_Summary year_month values found.');
  }
  // Uses pre-aggregated Back4App summary classes.
  // Returns: { totalUSStations, totalNetworks, totalStatesWithStations, totalFastChargingPlugs }
  // NOTE: The UI card labeled “Total Plugs” (id="totalFastChargingPlugs") is expected to reflect
  // total_all_plugs summed across states by year_month.
  const out = {
    totalUSStations: 0,
    totalNetworks: 0,
    totalStatesWithStations: 0,
    totalFastChargingPlugs: 0
  };

  // States + totals
  // - totalUSStations: use `total_stations` to match the “Total US Stations” card.
  // - totalStatesWithStations: count states that have DC fast plugs (total_dc_fast_plugs > 0).
  // - totalFastChargingPlugs: sum `total_all_plugs` across states (matches user expectation).
  const stateQuery = new Parse.Query('State_Summary');
  stateQuery.equalTo('year_month', latestYearMonth);
  stateQuery.select(['state', 'total_stations', 'total_dc_fast_plugs', 'total_all_plugs']);
  stateQuery.limit(5000);

  const stateRows = await stateQuery.find();

  const stationsByState = {};
  const hasDcFastByState = {};
  const totalAllPlugsByState = {};

  stateRows.forEach(r => {
    const st = r.get('state');
    if (!st) return;

    const dcFast = Number(r.get('total_dc_fast_plugs') || 0);
    const stations = Number(r.get('total_stations') || 0);
    const allPlugs = Number(r.get('total_all_plugs') || 0);

    hasDcFastByState[st] = dcFast > 0;
    stationsByState[st] = stations;
    totalAllPlugsByState[st] = allPlugs;
  });

  out.totalStatesWithStations = Object.values(hasDcFastByState).filter(Boolean).length;
  out.totalUSStations = Object.values(stationsByState).reduce((s, n) => s + (Number(n) || 0), 0);
  out.totalFastChargingPlugs = Object.values(totalAllPlugsByState).reduce((s, n) => s + (Number(n) || 0), 0);

  // Networks
  const netQuery = new Parse.Query('EV_Network_Summary');
  netQuery.equalTo('year_month', latestYearMonth);
  netQuery.select(['ev_network', 'total_dc_fast_plugs']);
  netQuery.limit(5000);

  const netRows = await netQuery.find();
  const netSet = new Set();
  netRows.forEach(r => {
    const n = (r.get('ev_network') || '').trim();
    if (n) netSet.add(n);
  });
  out.totalNetworks = netSet.size;

  return out;
}

async function renderTop10StatesByStationsLatest() {
  const wrapId = 'topStatesStationsWrap';
  const wrap = document.getElementById(wrapId);
  const canvas = document.getElementById('topStatesStationsChart');
  if (!wrap || !canvas) return;

  showLoader(wrapId, 'Fetching top states…');

  try {
    // Latest month in State_Summary
    const qLatest = new Parse.Query('State_Summary');
    qLatest.select(['year_month']);
    qLatest.descending('year_month');
    qLatest.limit(1);

    const latestRows = await qLatest.find();
    const ymLatest = latestRows?.[0]?.get('year_month');
    if (!ymLatest) throw new Error('No State_Summary records found.');

    // Top states by cumulative total stations (latest month)
    const q = new Parse.Query('State_Summary');
    q.equalTo('year_month', ymLatest);
    q.select(['state', 'total_stations']);
    q.limit(5000);

    const rows = await q.find();
    const vals = {};
    rows.forEach(r => {
      const code = r.get('state');
      if (!code) return;
      vals[code] = Number(r.get('total_stations') || 0);
    });

    const top10 = Object.entries(vals).sort((a, b) => (b[1] || 0) - (a[1] || 0)).slice(0, 10);
    if (!top10.length) throw new Error('No top states data available.');

    hideLoader(wrapId);

    if (stateChartInst) { try { stateChartInst.destroy(); } catch (_) {} }

    const ctx = canvas.getContext ? canvas : document.getElementById('topStatesStationsChart');
    const labels = top10.map(([code]) => US_STATES[code] || code);
    const data = top10.map(([, v]) => v);

    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: `Top 10 States — Total Stations (${ymLatest})`,
          data,
          borderColor: CHART_COLORS[0],
          backgroundColor: `${CHART_COLORS[0]}55`,
          borderRadius: 6,
          borderWidth: 1.5
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: ctx => ` ${ctx.parsed.x.toLocaleString()} stations` }
          }
        },
        scales: {
          x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk' } } },
          y: { grid: { display: false }, ticks: { font: { family: 'Space Grotesk', size: 12 } } }
        }
      }
    });

    stateChartInst = chart;
  } catch (err) {
    console.error('Top 10 states chart error:', err);
    const msg = /permission denied|acl/i.test(String(err)) ?
      'Back4App permissions denied for State_Summary.' :
      (err && err.message ? err.message : 'Failed to load top states.');
    const loader = document.getElementById(wrapId)?.querySelector('.chart-loader');
    if (loader) loader.textContent = msg;
    hideLoader(wrapId);
  }
}

async function loadUSStateAnalysis() {
  // This module is used on multiple pages.
  // Even if the chart canvas isn't present, we still must populate the 3 US stat cards.
  const wrap = document.getElementById('stateChartWrap');
  const canvas = document.getElementById('stateChart');

  const canRenderChart = !!wrap && !!canvas;

  if (canRenderChart) {
    showLoader('stateChartWrap', 'Fetching station data…');
  }

  try {
    // Use latest available year_month so stat cards match the latest chart bars.
    const ym = null; // let fetchUSStatsFromSummaries auto-detect latest

    let stats = null;
    try {
      stats = await fetchUSStatsFromSummaries(ym);
    } catch (e1) {
      console.warn('loadUSStateAnalysis: first fetchUSStatsFromSummaries failed, retrying…', e1);
      stats = await fetchUSStatsFromSummaries(ym);
    }

    setStatVal('totalUSStations', (stats?.totalUSStations || 0).toLocaleString());
    setStatVal('totalNetworks', (stats?.totalNetworks || 0).toLocaleString());
    setStatVal('totalFastChargingPlugs', (stats?.totalFastChargingPlugs || 0).toLocaleString());

    // Keep existing UI requirement value unless you want it data-driven
    setStatVal('totalStatesWithStations', 50);

    // If the Top-20 chart UI is not present (e.g., index page now only shows US-wide charts),
    // stop here after setting stat cards.
    if (!canRenderChart) return;

    // Top 20 chart (State_Summary already contains total_dc_fast_plugs)
    // Use the latest available State_Summary month from Back4App.
    const ymForTop20 = await fetchLatestYearMonth('State_Summary', 'year_month');

    // Top 20 chart (State_Summary already contains total_dc_fast_plugs)
    let latest06Top20 = [];
    try {
      const stationQuery = new Parse.Query('State_Summary');
      stationQuery.equalTo('year_month', ymForTop20);
      stationQuery.select(['state', 'total_dc_fast_plugs']);
      stationQuery.limit(5000);

      const stationResults = await stationQuery.find();
      const vals = {};
      stationResults.forEach(r => {
        const code = r.get('state');
        const val = r.get('total_dc_fast_plugs');
        if (!code) return;
        vals[code] = Number(val || 0);
      });

      latest06Top20 = Object.entries(vals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20);
    } catch (err) {
      latest06Top20 = [];
      console.warn('State_Summary latest month fetch failed:', err);
    }

    if (!latest06Top20.length) {
      showLoader(
        'stateChartWrap',
        `No “Stations by State (Top 20)” data available (ACL permission denied or missing latest records).`
      );
      if (stateChartInst) { stateChartInst.destroy(); stateChartInst = null; }
      return;
    }

    hideLoader('stateChartWrap');

    const stateCtx = document.getElementById('stateChart');
    if (!stateCtx) {
      throw new Error('Monthly/Top-20 chart canvas not found (id="stateChart").');
    }
    if (stateChartInst) stateChartInst.destroy();
    stateChartInst = new Chart(stateCtx, {
      type: 'bar',
      data: {
        labels: latest06Top20.map(([c]) => US_STATES[c] || c),
        datasets: [{
          label: `EV DC Fast Plugs (${formatYearMonth(ymForTop20)})`,
          data: latest06Top20.map(([, n]) => n),
          backgroundColor: CHART_COLORS[0],
          borderRadius: 6,
          borderSkipped: false
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: ctx => ` ${ctx.parsed.x.toLocaleString()} DC fast plugs` }
          }
        },
        scales: {
          x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk' } } },
          y: { grid: { display: false }, ticks: { font: { family: 'Space Grotesk', size: 12 } } }
        }
      }
    });

    loadMonthlyUSAdded();
  } catch (err) {
    const msg = (err && err.message) ? err.message : 'Failed to load data.';
    const friendly =
      /permission denied/i.test(String(msg)) || /acl/i.test(String(msg)) ?
        'Back4App permissions denied for required classes. Ask your admin to grant read access.' :
        msg;

    if (canRenderChart) showLoader('stateChartWrap', friendly);
    console.error('US state analysis error:', err);
  }
}

/* -------------------------------------------------------
   MONTHLY USA TREND (USA TOTAL)
------------------------------------------------------- */

function formatYearMonth(ym) {
  // Expect "2026_05" -> "May 2026"
  if (!ym) return ym;
  const str = String(ym);
  const [yStr, mStr] = str.split('_');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m || m < 1 || m > 12) return ym;
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function getYearFromYearMonth(ym) {
  if (!ym) return null;
  const str = String(ym);
  const [yStr] = str.split('_');
  const y = Number(yStr);
  return Number.isFinite(y) ? y : null;
}

function getMonthsLabelsFromYearMonths(yearMonths) {
  return yearMonths.map(formatYearMonth);
}

function isYearMonthOnOrAfter(ym, minYM) {
  // ym format "YYYY_MM" (or "YYYY-MM" depending on upstream). We handle both lightly.
  if (!ym || !minYM) return true;
  const s = String(ym).replace('-', '_');
  const m = String(minYM).replace('-', '_');
  return String(s).localeCompare(String(m)) >= 0;
}

function filterYearMonths(yearMonths, selectedYear) {
  const yNum = Number(selectedYear);
  if (!yNum) return yearMonths;
  return yearMonths.filter(ym => getYearFromYearMonth(ym) === yNum);
}

// Always drop anything prior to Jan 2026 for all monthly graphs
function filterYearMonthsForGraphs(yearMonths) {
  const minYM = '2026_01';
  return (yearMonths || []).filter(ym => isYearMonthOnOrAfter(ym, minYM));
}

/**
 * Uses State_Summary rows (per-state, per-month) and aggregates to a single USA total per Year_Month.
 * Note: State_Summary is expected to store cumulative totals as of that month, so summing across states
 * yields the cumulative USA total for that month.
 */
function setCanvasEmptyState(canvas, message) {
  if (!canvas) return;
  const parent = canvas.parentElement;
  if (!parent) return;

  parent.querySelectorAll('.chart-empty-state').forEach(n => n.remove());

  const el = document.createElement('div');
  el.className = 'chart-empty-state';
  el.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;'
    + 'background:rgba(255,255,255,0.6);border:1px dashed rgba(29,111,196,0.35);'
    + 'border-radius:10px;font-family:inherit;color:var(--ink-soft);padding:12px;text-align:center;';

  // Ensure parent is positioned so overlay works
  if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';

  el.textContent = message;
  parent.appendChild(el);
}

function clearCanvasEmptyState(canvas) {
  if (!canvas || !canvas.parentElement) return;
  canvas.parentElement.querySelectorAll('.chart-empty-state').forEach(n => n.remove());
}

async function fetchUSMonthlyCumulativeSeries(fieldName, { filterToJan2026 = true } = {}) {
  const query = new Parse.Query('State_Summary');
  query.select(['year_month', fieldName]);
  query.limit(20000); // safety for all months/states

  const results = await query.find();
  const map = {}; // Year_Month -> cumulative total (summed across states)
  results.forEach(r => {
    const ym = r.get('year_month');
    const val = r.get(fieldName);
    if (!ym) return;
    map[ym] = (map[ym] || 0) + (typeof val === 'number' ? val : Number(val || 0));
  });

  const sortedYMs = Object.keys(map).sort((a, b) => String(a).localeCompare(String(b)));
  const yearMonths = filterToJan2026 ? filterYearMonthsForGraphs(sortedYMs) : sortedYMs;
  return { yearMonths, valuesByYearMonth: map };
}

/**
 * Same as fetchUSMonthlyCumulativeSeries, but does NOT filter out pre-2026 months.
 * Used for "growth" calculations so Jan 2026 can be computed relative to Dec 2025,
 * while still only DISPLAYING months >= 2026_01.
 */
async function fetchUSMonthlyCumulativeSeriesUnfiltered(fieldName) {
  const allMonthly = await fetchUSAllMonthlyPlugsAndStations();
  const valuesByYearMonth = fieldName === 'total_stations'
    ? allMonthly.stationsByYearMonth
    : allMonthly.plugsByYearMonth;
  return { yearMonths: allMonthly.yearMonthsAll, valuesByYearMonth };
}

async function fetchUSAllMonthlyPlugsAndStations() {
  if (usAllMonthlyCache) return usAllMonthlyCache;

  const query = new Parse.Query('State_Summary');
  query.select(['year_month', 'total_all_plugs', 'total_stations']);
  query.limit(20000);

  const results = await query.find();
  const plugsByYearMonth = {};
  const stationsByYearMonth = {};
  results.forEach(r => {
    const ym = r.get('year_month');
    if (!ym) return;
    const plugsVal = r.get('total_all_plugs');
    const stationsVal = r.get('total_stations');
    plugsByYearMonth[ym] = (plugsByYearMonth[ym] || 0) + (typeof plugsVal === 'number' ? plugsVal : Number(plugsVal || 0));
    stationsByYearMonth[ym] = (stationsByYearMonth[ym] || 0) + (typeof stationsVal === 'number' ? stationsVal : Number(stationsVal || 0));
  });

  const yearMonthsAll = Array.from(new Set([
    ...Object.keys(plugsByYearMonth),
    ...Object.keys(stationsByYearMonth)
  ])).sort((a, b) => String(a).localeCompare(String(b)));

  usAllMonthlyCache = { yearMonthsAll, plugsByYearMonth, stationsByYearMonth };
  return usAllMonthlyCache;
}

/**
 * State-specific cumulative series from State_Summary.
 * Expects values in State_Summary to be cumulative totals as-of that month.
 */
/* --- Performance caches (avoid repeated Parse calls) --- */
const availableYearsCache = {};
const stateMonthlyCache = {}; // stateCode -> { yearMonthsAll, plugsByYM, stationsByYM }
let usAllMonthlyCache = null;

/**
 * One query to fetch both cumulative series for a state.
 * We still cache results to avoid repeating heavy Parse requests.
 */
async function fetchStateMonthlyCumulativeSeries(stateCode) {
  if (stateMonthlyCache[stateCode]) return stateMonthlyCache[stateCode];

  const query = new Parse.Query('State_Summary');
  query.equalTo('state', stateCode);
  query.select(['year_month', 'total_all_plugs', 'total_stations']);
  query.limit(20000);

  const results = await query.find();
  const plugsByYearMonth = {};
  const stationsByYearMonth = {};

  results.forEach(r => {
    const ym = r.get('year_month');
    if (!ym) return;

    const plugsVal = r.get('total_all_plugs');
    const stationsVal = r.get('total_stations');

    plugsByYearMonth[ym] = (typeof plugsVal === 'number') ? plugsVal : Number(plugsVal || 0);
    stationsByYearMonth[ym] = (typeof stationsVal === 'number') ? stationsVal : Number(stationsVal || 0);
  });

  const yearMonthsAll = Array.from(new Set(Object.keys(plugsByYearMonth))).sort((a, b) => String(a).localeCompare(String(b)));

  stateMonthlyCache[stateCode] = { yearMonthsAll, plugsByYearMonth, stationsByYearMonth };
  return stateMonthlyCache[stateCode];
}

async function fetchAvailableYearsForState(stateCode) {
  if (availableYearsCache[stateCode]) return availableYearsCache[stateCode];

  if (!stateCode || stateCode === 'ALL') {
    const allMonthly = await fetchUSAllMonthlyPlugsAndStations();
    const years = Array.from(new Set(
      allMonthly.yearMonthsAll
        .map(ym => getYearFromYearMonth(ym))
        .filter(Boolean)
        .map(String)
    )).sort((a, b) => Number(b) - Number(a));

    availableYearsCache[stateCode || 'ALL'] = years;
    return years;
  }

  // Fetch only year_months; keep lightweight
  const query = new Parse.Query('State_Summary');
  query.equalTo('state', stateCode);
  query.select(['year_month']);
  query.limit(20000);

  const rows = await query.find();
  const yearsSet = new Set();
  rows.forEach(r => {
    const ym = r.get('year_month');
    const y = getYearFromYearMonth(ym);
    if (y) yearsSet.add(String(y));
  });

  const years = Array.from(yearsSet).sort((a, b) => Number(b) - Number(a));
  availableYearsCache[stateCode] = years;
  return years;
}

async function loadMonthlyUSATotal() {
  const wrapId = 'monthlyChartWrap';
  const wrap = document.getElementById(wrapId);
  const canvas = document.getElementById('monthlyChart');

  if (!wrap || !canvas) {
    return;
  }

  showLoader(wrapId, 'Fetching monthly USA total stations…');

  try {
    const seriesTotalStations = await fetchUSMonthlyCumulativeSeries('total_stations');

    const yearMonths = seriesTotalStations.yearMonths;
    const labels = getMonthsLabelsFromYearMonths(yearMonths);

    hideLoader(wrapId);

    const ctx = document.getElementById('monthlyChart');
    if (!ctx) throw new Error('Monthly chart canvas not found (id="monthlyChart").');
    if (monthlyChartInst) monthlyChartInst.destroy();

    const dataTotalStations = yearMonths.map(m => Number(seriesTotalStations.valuesByYearMonth[m] ?? 0));

    monthlyChartInst = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'USA — Cumulative Total Stations',
          data: dataTotalStations,
          borderColor: CHART_COLORS[0],
          backgroundColor: `${CHART_COLORS[0]}55`,
          borderWidth: 1.5,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ` ${Number(ctx.parsed?.y ?? 0).toLocaleString()} stations`
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: { font: { family: 'Space Grotesk', size: 11 } }
          },
          y: {
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: { font: { family: 'Space Grotesk' } },
            beginAtZero: false
          }
        }
      }
    });
  } catch (err) {
    const msg =
      (err && err.message) ? `Data unavailable: monthly USA total stations (${err.message})` : 'Data unavailable: monthly USA total stations.';
    showLoader(wrapId, msg);
    console.error('Monthly USA total stations error:', err);
  }
}

async function loadMonthlyUSAdded() {
  const wrapId = 'monthlyAddedChartWrap';
  const canvas = document.getElementById('monthlyAddedChart');
  if (!canvas) {
    console.warn('loadMonthlyUSAdded: canvas not found (id="monthlyAddedChart"); skipping.');
    return;
  }

  showLoader(wrapId, 'Fetching monthly USA total station additions…');

  // NOTE: Chart titles/copy are controlled from the DOM (index.html). We keep the chart
  // labels aligned with the actual metric we plot (stations, not plugs).

  try {
    // Jan 2026 additions must be the delta vs Dec 2025,
    // but we should NEVER plot or mention Dec 2025.
    //
    // Approach:
    // 1) fetch unfiltered cumulative series (includes Dec 2025)
    // 2) compute month-over-month additions across the FULL unfiltered series
    // 3) plot only months >= 2026_01 (so Dec 2025 is never shown)
    const { yearMonths: allYearMonths, valuesByYearMonth } =
      await fetchUSMonthlyCumulativeSeries('total_stations', { filterToJan2026: false });

    if (!allYearMonths || !allYearMonths.length) {
      throw new Error('No monthly cumulative data returned for total_stations.');
    }

    const minYM = '2026_01';
    const plotYearMonths = allYearMonths.filter(ym => isYearMonthOnOrAfter(ym, minYM));
    if (!plotYearMonths.length) {
      throw new Error('No monthly data to plot for stations from 2026 onward.');
    }

    // compute additions for full sequence
    const cumulativeAll = allYearMonths.map(ym => Number(valuesByYearMonth[ym] ?? 0));
    const additionsAll = cumulativeAll.map((v, i) => (i === 0 ? v : (v - cumulativeAll[i - 1])));

    // map additions back to year_month
    const additionsByYM = {};
    allYearMonths.forEach((ym, i) => { additionsByYM[ym] = additionsAll[i]; });

    const labels = getMonthsLabelsFromYearMonths(plotYearMonths);
    const additions = plotYearMonths.map(ym => Number(additionsByYM[ym] ?? 0));

    hideLoader(wrapId);

    const ctx = canvas;
    if (monthlyAddedChartInst) monthlyAddedChartInst.destroy();

    monthlyAddedChartInst = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'USA — Total Stations Added',
          data: additions,
          borderColor: CHART_COLORS[1],
          backgroundColor: `${CHART_COLORS[1]}55`,
          borderWidth: 1.5,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: tctx => {
                const y = tctx?.parsed?.y ?? tctx?.raw ?? 0;
                return ` ${Number(y).toLocaleString()} stations`;
              }
            }
          }
        },
        scales: {
          x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk', size: 11 } } },
          y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk' } }, beginAtZero: true }
        }
      }
    });
  } catch (err) {
    const msg =
      (err && err.message) ? `Data unavailable: monthly USA station additions (${err.message})` : 'Data unavailable: monthly USA station additions.';
    showLoader(wrapId, msg);
    console.error('Monthly USA additions error:', err);
  }
}

async function loadTopNetworksUS() {
  const wrapId = 'topNetworksChartWrap';

  showLoader(wrapId, 'Fetching top EV networks…');

  try {
    const latestYM = await fetchLatestYearMonth('EV_Network_Summary', 'year_month');
    if (!latestYM) throw new Error('No EV_Network_Summary records found.');

    const query = new Parse.Query('EV_Network_Summary');
    query.equalTo('year_month', latestYM);
    query.select(['ev_network', 'total_dc_fast_plugs']);
    query.limit(5000);

    const rows = await query.find();

    const counts = {};
    rows.forEach(r => {
      const n = (r.get('ev_network') || '').trim() || 'Unknown';
      const v = Number(r.get('total_dc_fast_plugs') || 0);
      counts[n] = (counts[n] || 0) + v;
    });

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) {
      showLoader(wrapId, 'No EV network summary data available for the latest month.');
      return;
    }

    const top = sorted.slice(0, 10);
    const labels = top.map(([n]) => n);
    const values = top.map(([, v]) => v);

    hideLoader(wrapId);

    const ctx = document.getElementById('topNetworksChart');
    if (!ctx) throw new Error('Top networks chart canvas not found (id="topNetworksChart").');
    if (topNetworksChartInst) topNetworksChartInst.destroy();

    topNetworksChartInst = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'EV DC Fast Plugs',
          data: values,
          borderColor: CHART_COLORS[2],
          backgroundColor: `${CHART_COLORS[2]}55`,
          borderWidth: 1.5,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y.toLocaleString()} plugs` } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { family: 'Space Grotesk', size: 11 } } },
          y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk' } }, beginAtZero: true }
        }
      }
    });
  } catch (err) {
    const msg =
      (err && err.message) ? `Failed to load top networks: ${err.message}` : 'Failed to load top networks.';
    showLoader(wrapId, msg);
    console.error('Top networks error:', err);
  }
}

/* -------------------------------------------------------
   HERO NETWORK DISTRIBUTION (PIE)
------------------------------------------------------- */
/* Prevent duplicate loads */
let heroNetLoading = false;

async function renderHeroNetworkChart() {
  if (heroNetLoading) return;
  heroNetLoading = true;

  showLoader('heroNetworkChartWrap', 'Fetching network summary…');

  try {
    if (typeof Parse === 'undefined' || !Parse.Query) {
      throw new Error('Parse SDK not available (Parse.Query missing).');
    }
    if (typeof Chart === 'undefined') {
      throw new Error('Chart.js not available (Chart missing).');
    }

    const latestYM = await fetchLatestYearMonth('EV_Network_Summary', 'year_month');
    if (!latestYM) throw new Error('No EV_Network_Summary records found.');

    const query = new Parse.Query('EV_Network_Summary');
    query.equalTo('year_month', latestYM);
    query.select(['ev_network', 'total_dc_fast_plugs']);
    query.limit(5000);

    // Hard timeout so we never hang "loading…" forever (fail fast for better UX)
    const timeoutPromise = new Promise((_, rej) => {
      setTimeout(() => rej(new Error('Timeout loading hero network summary.')), 3000);
    });

    const rows = await Promise.race([query.find(), timeoutPromise]);

    // Stations not on a network shouldn't appear in the network breakdown
    const isNonNetwork = n => /^non[-\s]?network/i.test(n);

    const networkCounts = {};
    rows.forEach(r => {
      const n = (r.get('ev_network') || '').trim() || 'Unknown';
      if (isNonNetwork(n)) return;
      const v = Number(r.get('total_dc_fast_plugs') || 0);
      networkCounts[n] = (networkCounts[n] || 0) + v;
    });

    const sorted = Object.entries(networkCounts).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) {
      // Keep loader visible, but avoid "forever": clear legend and stop
      const legend = document.getElementById('heroNetworkLegend');
      if (legend) legend.innerHTML = '';
      throw new Error('No EV network summary data available (empty dataset or ACL denied).');
    }

    const top   = sorted.slice(0, 10);
    const other = sorted.slice(10).reduce((s, [, c]) => s + c, 0);
    if (other > 0) top.push(['Other', other]);

    const total  = top.reduce((s, [, c]) => s + c, 0);
    const labels = top.map(([n]) => n);
    const values = top.map(([, c]) => c);

    const ctx = document.getElementById('heroNetworkChart');
    if (!ctx) throw new Error('Missing canvas: #heroNetworkChart');

    // Clear any previous legend to prevent duplicates
    const legend = document.getElementById('heroNetworkLegend');
    if (legend) legend.innerHTML = '';

    // Render chart (always destroy previous to prevent Chart.js internal state issues)
    if (heroChartInst) {
      try { heroChartInst.destroy(); } catch (_) {}
      heroChartInst = null;
    }

    // Hide loader right before rendering
    hideLoader('heroNetworkChartWrap');

    // Render chart
    heroChartInst = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: CHART_COLORS,
          borderWidth: 2,
          borderColor: '#fff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: tctx => {
                const value = Number(tctx?.parsed ?? tctx?.raw ?? 0);
                const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                return ` ${value.toLocaleString()} stations (${pct}%)`;
              }
            }
          }
        }
      }
    });

    // Custom legend
    if (legend) {
      legend.innerHTML = top.map(([name, count], i) => {
        const pct = total > 0 ? ((Number(count) / total) * 100).toFixed(1) : '0.0';
        return `<div class="legend-item" data-fullname="${name}">
          <span class="legend-dot" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></span>
          <span class="legend-name" aria-label="${name}">${name}</span>
          <span class="legend-count">${Number(count).toLocaleString()} stations <small>(${pct}%)</small></span>
        </div>`;
      }).join('');
    }
  } catch (err) {
    const msg = /permission denied|acl/i.test(String(err)) ?
      'Back4App permissions denied for EV_Network_Summary. Ask your admin to grant read access.' :
      (err && err.message) ? err.message : 'Failed to load EV network summary.';
    showLoader('heroNetworkChartWrap', msg);
    console.error('Hero network summary error:', err);
  } finally {
    // Ensure the UI never stays stuck in "loading…" forever
    hideLoader('heroNetworkChartWrap');
    heroNetLoading = false;
  }
}

/* -------------------------------------------------------
   NETWORK DISTRIBUTION
------------------------------------------------------- */
/* NOTE:
   The "EV Network Distribution" card has been removed from the UI.
   Keep this function as a no-op to prevent stale rendering or reintroduction.
*/
async function renderNetworkChart() {
  return; // no-op
}

/* -------------------------------------------------------
   CALIFORNIA ANALYSIS
------------------------------------------------------- */
async function fetchMaxYearMonthForState(state) {
  const query = new Parse.Query('County_Summary');
  query.equalTo('state', state);
  query.select(['year_month']);
  query.descending('year_month');
  query.limit(1);

  const rows = await query.find();
  if (!rows || !rows.length) return null;
  return rows[0].get('year_month');
}

async function fetchTopCountiesForState(state, fieldName, limit = 10) {
  const ymLatest = await fetchMaxYearMonthForState(state);
  if (!ymLatest) return [];

  const query = new Parse.Query('County_Summary');
  query.equalTo('state', state);
  query.equalTo('year_month', ymLatest);
  query.select(['county', fieldName]);
  query.limit(5000);

  const rows = await query.find();

  const vals = {};
  rows.forEach(r => {
    const c = (r.get('county') || '').trim();
    if (!c) return;
    const v = Number(r.get(fieldName) || 0);
    vals[c] = (vals[c] || 0) + v;
  });

  return Object.entries(vals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

async function renderCATop10CountiesByStations() {
  const wrapId = 'caTopCountiesStationsWrap';
  const canvas = document.getElementById('caTopCountiesStationsChart');
  if (!canvas || !document.getElementById(wrapId)) return;

  showLoader(wrapId, 'Fetching top California counties…');

  try {
    const ymLatest = await fetchMaxYearMonthForState('CA');
    if (!ymLatest) throw new Error('No California county summary records found.');

    const top = await fetchTopCountiesForState('CA', 'total_stations', 10);
    if (!top.length) throw new Error('No California county station totals available.');

    const title = document.getElementById('caTopCountiesStationsTitle');
    const subtitle = document.getElementById('caTopCountiesStationsSubtitle');
    if (title) title.textContent = `Top 10 California Counties (${formatYearMonth(ymLatest)})`;
    if (subtitle) subtitle.textContent = 'Ranked by total charging stations in County_Summary.';

    hideLoader(wrapId);

    if (caTopCountiesStationsInst) {
      try { caTopCountiesStationsInst.destroy(); } catch (_) {}
      caTopCountiesStationsInst = null;
    }

    caTopCountiesStationsInst = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: top.map(([county]) => county),
        datasets: [{
          label: `Total Stations (${formatYearMonth(ymLatest)})`,
          data: top.map(([, value]) => value),
          borderColor: CHART_COLORS[4],
          backgroundColor: `${CHART_COLORS[4]}55`,
          borderWidth: 1.5,
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: tctx => ` ${Number(tctx.raw).toLocaleString()} stations` }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: { font: { family: 'Space Grotesk' } }
          },
          y: {
            grid: { display: false },
            ticks: { font: { family: 'Space Grotesk', size: 11 } }
          }
        }
      }
    });
  } catch (err) {
    console.error('California top counties leaderboard error:', err);
    const loader = document.getElementById(wrapId)?.querySelector('.chart-loader');
    if (loader) {
      loader.style.display = 'flex';
      loader.textContent = err?.message || 'California county leaderboard data unavailable.';
    }
    if (canvas) canvas.style.display = 'none';
  }
}

async function fetchCountyMonthlyCumulativeSeries(state, fieldName) {
  const query = new Parse.Query('County_Summary');
  query.equalTo('state', state);
  query.select(['year_month', fieldName]);
  query.limit(20000);

  const results = await query.find();
  const map = {}; // Year_Month -> cumulative total (summed across counties)

  results.forEach(r => {
    const ym = r.get('year_month');
    const val = r.get(fieldName);
    if (!ym) return;
    map[ym] = (map[ym] || 0) + (typeof val === 'number' ? val : Number(val || 0));
  });

  const sortedYMs = Object.keys(map).sort((a, b) => String(a).localeCompare(String(b)));
  return { yearMonths: sortedYMs, valuesByYearMonth: map };
}

function getLoaderWrapIdsForStatePage(state) {
  if (state === 'CA') {
    return {
      heroWrap: 'heroCountyChartWrap',
      plugsWrap: 'caPlugsMonthlyChartWrap',
      stationsWrap: 'caStationsMonthlyChartWrap'
    };
  }
  if (state === 'TX') {
    return {
      heroWrap: 'heroCountyChartWrap',
      plugsWrap: 'txPlugsMonthlyChartWrap',
      stationsWrap: 'txStationsMonthlyChartWrap'
    };
  }
  return { heroWrap: null, plugsWrap: null, stationsWrap: null };
}

async function renderStateHeroTop10Counties(state, fieldName) {
  const canvas = document.getElementById('heroCountyChart');
  if (!canvas) return;

  const legendWrap = document.getElementById('heroCountyChartWrap');
  if (!legendWrap) return;

  // Ensure the chart uses the full card height (prevents “squished” look)
  canvas.style.width = '100%';
  canvas.style.height = '100%';

  showLoader('heroCountyChartWrap', `Fetching top counties (${state})…`);

  const top = await fetchTopCountiesForState(state, fieldName, 10);
  hideLoader('heroCountyChartWrap');

  if (!top.length) return;

  if (countyHeroChartInst) {
    try { countyHeroChartInst.destroy(); } catch (_) {}
    countyHeroChartInst = null;
  }

  const total = top.reduce((s, [, v]) => s + v, 0);
  const labels = top.map(([county]) => county);
  const values = top.map(([, v]) => v);

  countyHeroChartInst = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: `${state} — ${fieldName === 'total_all_plugs' ? 'Total Plugs' : fieldName === 'total_dc_fast_plugs' ? 'DC Fast Charging Plugs' : 'Total Stations'}`,
        data: values,
        borderColor: CHART_COLORS[1],
        backgroundColor: `${CHART_COLORS[1]}55`,
        borderWidth: 1.5,
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: tctx => {
              const y = tctx?.parsed?.y ?? tctx?.raw ?? 0;
              const pct = total > 0 ? ((Number(y) / total) * 100).toFixed(1) : '0.0';
              return ` ${Number(y).toLocaleString()} (${pct}%)`;
            }
          }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk', size: 10 } } },
        y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk' } }, beginAtZero: true }
      }
    }
  });
}

async function fetchTotalStationsForStateFromSummaryYearMonth(stateCode, yearMonth) {
  // Use State_Summary (pre-aggregated) to get station totals for a specific Year_Month.
  const query = new Parse.Query('State_Summary');
  query.equalTo('state', stateCode);
  query.equalTo('year_month', yearMonth);
  query.select(['year_month', 'total_stations']);
  query.limit(1);

  const rows = await query.find();
  if (!rows || !rows.length) return 0;
  return Number(rows[0].get('total_stations') || 0);
}

async function fetchTotalAllPlugsForStateFromSummaryYearMonth(stateCode, yearMonth) {
  // Use State_Summary (pre-aggregated) to get plugs totals for a specific Year_Month.
  const query = new Parse.Query('State_Summary');
  query.equalTo('state', stateCode);
  query.equalTo('year_month', yearMonth);
  query.select(['year_month', 'total_all_plugs']);
  query.limit(1);

  const rows = await query.find();
  if (!rows || !rows.length) return 0;
  return Number(rows[0].get('total_all_plugs') || 0);
}

function normalizeCaCountyName(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function getCaCountyDisplayName(countyName) {
  if (!countyName) return '';
  if (typeof CA_COUNTY_PATHS === 'undefined') return String(countyName).trim();
  return Object.keys(CA_COUNTY_PATHS)
    .find(n => normalizeCaCountyName(n) === normalizeCaCountyName(countyName)) || String(countyName).trim();
}

function getSelectedCaCountyNames() {
  const sel = document.getElementById('caCountySelect');
  const selected = sel
    ? Array.from(sel.selectedOptions || []).map(opt => opt.value).filter(Boolean)
    : [];

  const source = selected.length ? selected : (Array.isArray(caCountySelected) ? caCountySelected : [caCountySelected].filter(Boolean));
  const seen = new Set();
  return source
    .map(getCaCountyDisplayName)
    .filter(Boolean)
    .filter(name => {
      const norm = normalizeCaCountyName(name);
      if (seen.has(norm)) return false;
      seen.add(norm);
      return true;
    })
    .slice(0, MAX_CA_COMPARE_COUNTIES);
}

function formatCaCountySelectionLabel(counties) {
  if (!counties || !counties.length) return '—';
  return counties.map(name => `${name} County`).join(', ');
}

function formatCaNumber(value) {
  return Number(value || 0).toLocaleString();
}

function getSelectedCaYear() {
  const year = Number(document.getElementById('caYearSelect')?.value);
  return Number.isFinite(year) && year > 0 ? year : null;
}

/* Fill the county dropdown with every California county (from the embedded
   geometry, so all 58 always appear regardless of which counties have data). */
function populateCaCountyDropdown() {
  const sel = document.getElementById('caCountySelect');
  if (!sel || typeof CA_COUNTY_PATHS === 'undefined') return;

  const names = Object.keys(CA_COUNTY_PATHS).sort((a, b) => a.localeCompare(b));
  const prev = getSelectedCaCountyNames();

  sel.innerHTML = '';
  names.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });

  const selectedNorms = new Set(prev.map(normalizeCaCountyName));
  Array.from(sel.options).forEach(opt => {
    opt.selected = selectedNorms.has(normalizeCaCountyName(opt.value));
  });
}

/* Highlight the selected county shapes + labels on the map. */
function highlightCaCounty(countyNames) {
  const selected = new Set((Array.isArray(countyNames) ? countyNames : [countyNames].filter(Boolean)).map(normalizeCaCountyName));
  Object.entries(caCountyShapes).forEach(([norm, path]) => {
    path.classList.toggle('is-selected', selected.has(norm));
  });
  Object.entries(caCountyLabels).forEach(([norm, text]) => {
    text.classList.toggle('is-selected', selected.has(norm));
  });
}

function setCaCountySelection(countyNames) {
  const normalized = [];
  const seen = new Set();
  (Array.isArray(countyNames) ? countyNames : [countyNames].filter(Boolean)).forEach(name => {
    const display = getCaCountyDisplayName(name);
    const norm = normalizeCaCountyName(display);
    if (!display || seen.has(norm)) return;
    seen.add(norm);
    normalized.push(display);
  });

  caCountySelected = normalized.slice(0, MAX_CA_COMPARE_COUNTIES);
  const sel = document.getElementById('caCountySelect');
  if (sel) {
    const selectedNorms = new Set(caCountySelected.map(normalizeCaCountyName));
    Array.from(sel.options).forEach(opt => {
      opt.selected = selectedNorms.has(normalizeCaCountyName(opt.value));
    });
  }

  highlightCaCounty(caCountySelected);
  const note = document.getElementById('caCountySelectedNote');
  if (note) {
    note.textContent = caCountySelected.length
      ? `Comparing ${formatCaCountySelectionLabel(caCountySelected)}.`
      : 'California totals are shown until counties are clicked. Selected counties are shown in orange.';
  }
}

function showCaCountyChartsAwaitingSelection() {
  return renderCountyDeepDiveCharts([]);
}

async function updateCaHeroTotalsForSelection(countyNames = []) {
  const counties = (Array.isArray(countyNames) ? countyNames : [countyNames].filter(Boolean))
    .map(getCaCountyDisplayName)
    .filter(Boolean)
    .slice(0, MAX_CA_COMPARE_COUNTIES);

  try {
    const [plugsSeries, stationsSeries] = await Promise.all([
      fetchCACountyMonthlySeriesAll('total_all_plugs'),
      fetchCACountyMonthlySeriesAll('total_stations')
    ]);

    const selectedYear = getSelectedCaYear();
    const allYearMonths = filterYearMonths(
      Array.from(new Set([
        ...(plugsSeries.yearMonths || []),
        ...(stationsSeries.yearMonths || [])
      ])).sort((a, b) => String(a).localeCompare(String(b))),
      selectedYear
    );
    const latestYM = allYearMonths[allYearMonths.length - 1];
    if (!latestYM) return;

    const countyNorms = counties.map(normalizeCaCountyName);
    const selectedNorms = countyNorms.length
      ? countyNorms
      : Array.from(new Set([
          ...Object.keys(plugsSeries.byCounty || {}),
          ...Object.keys(stationsSeries.byCounty || {})
        ]));

    const totalPlugs = selectedNorms.reduce((sum, norm) => (
      sum + Number(plugsSeries.byCounty?.[norm]?.valuesByYM?.[latestYM] || 0)
    ), 0);
    const totalStations = selectedNorms.reduce((sum, norm) => (
      sum + Number(stationsSeries.byCounty?.[norm]?.valuesByYM?.[latestYM] || 0)
    ), 0);

    setStatVal('totalCAStations', formatCaNumber(totalStations));
    setStatVal('totalCACities', formatCaNumber(totalPlugs));
    const stationsLabel = document.getElementById('totalCAStationsLabel');
    const plugsLabel = document.getElementById('totalCAPlugsLabel');
    const selectedLabel = counties.length > 1 ? 'Selected Counties' : 'Selected County';
    if (stationsLabel) stationsLabel.textContent = counties.length ? `${selectedLabel} Stations` : 'Total CA Stations';
    if (plugsLabel) plugsLabel.textContent = counties.length ? `${selectedLabel} Plugs` : 'Total CA Plugs';
  } catch (err) {
    console.error('CA hero totals update error:', err);
  }
}

/* Select a county: sync the dropdown, highlight the map, render its charts. */
function selectCaCounty(countyName, opts = {}) {
  if (!countyName) return;
  const current = getSelectedCaCountyNames();
  const display = getCaCountyDisplayName(countyName);
  const norm = normalizeCaCountyName(display);
  let next = current.slice();

  if (opts.toggle) {
    if (next.some(name => normalizeCaCountyName(name) === norm)) {
      next = next.filter(name => normalizeCaCountyName(name) !== norm);
    } else if (next.length < MAX_CA_COMPARE_COUNTIES) {
      next.push(display);
    } else {
      const note = document.getElementById('caCountySelectedNote');
      if (note) note.textContent = 'Only four counties can be compared at once.';
      return;
    }
  } else {
    next = current.includes(display) ? current : [...current, display].slice(0, MAX_CA_COMPARE_COUNTIES);
  }

  setCaCountySelection(next);

  startGlobalLoad('Loading county selection…');
  Promise.all([
    updateCaHeroTotalsForSelection(next),
    renderCountyDeepDiveCharts(next)
  ])
    .catch(err => console.error('County deep-dive render failed:', err))
    .finally(finishGlobalLoad);
}

function refreshCaYearSelection() {
  const counties = getSelectedCaCountyNames();
  startGlobalLoad(counties.length ? 'Loading county comparison charts…' : 'Loading California totals…');
  Promise.all([
    updateCaHeroTotalsForSelection(counties),
    renderCountyDeepDiveCharts(counties)
  ])
    .catch(err => console.error('CA year refresh failed:', err))
    .finally(finishGlobalLoad);
}

function resetCaYearSelection() {
  const yearSelect = document.getElementById('caYearSelect');
  if (yearSelect && yearSelect.options.length) {
    yearSelect.selectedIndex = 0;
  }

  setCaCountySelection([]);
  startGlobalLoad('Resetting California totals…');
  Promise.all([
    updateCaHeroTotalsForSelection([]),
    renderCountyDeepDiveCharts([])
  ])
    .catch(err => console.error('CA reset failed:', err))
    .finally(finishGlobalLoad);
}

/* Wire page controls once. County selection is driven by map clicks. */
function bindCaCountyControls() {
  if (caCountyControlsBound) return;
  caCountyControlsBound = true;

  const yearSelect = document.getElementById('caYearSelect');
  const yearApplyBtn = document.getElementById('caYearApplyBtn');
  const yearResetBtn = document.getElementById('caYearResetBtn');

  if (yearSelect) {
    yearSelect.addEventListener('keydown', event => {
      if (event.key === 'Enter') refreshCaYearSelection();
    });
  }

  if (yearApplyBtn) {
    yearApplyBtn.addEventListener('click', refreshCaYearSelection);
  }

  if (yearResetBtn) {
    yearResetBtn.addEventListener('click', resetCaYearSelection);
  }
}

/* Fetch every CA County_Summary row for a field and group it into per-county
   monthly series. Cached per field so repeated county selections are instant. */
async function fetchCACountyMonthlySeriesAll(fieldName) {
  if (caCountySeriesCache[fieldName]) return caCountySeriesCache[fieldName];

  const query = new Parse.Query('County_Summary');
  query.equalTo('state', 'CA');
  query.select(['year_month', 'county', fieldName]);
  query.limit(20000);

  const rows = await query.find();

  const byCounty = {}; // norm -> { displayName, valuesByYM }
  const allYMs = new Set();

  rows.forEach(r => {
    const ym = r.get('year_month');
    const countyRaw = (r.get('county') || '').trim();
    if (!ym || !countyRaw) return;
    const norm = normalizeCaCountyName(countyRaw);
    const val = Number(r.get(fieldName) || 0);

    if (!byCounty[norm]) byCounty[norm] = { displayName: countyRaw, valuesByYM: {} };
    byCounty[norm].valuesByYM[ym] = (byCounty[norm].valuesByYM[ym] || 0) + val;
    allYMs.add(ym);
  });

  const result = {
    yearMonths: Array.from(allYMs).sort((a, b) => String(a).localeCompare(String(b))),
    byCounty
  };
  caCountySeriesCache[fieldName] = result;
  return result;
}

async function populateCaYearDropdownFromCountySummary() {
  const sel = document.getElementById('caYearSelect');
  if (!sel) return;

  const query = new Parse.Query('County_Summary');
  query.equalTo('state', 'CA');
  query.select(['year_month']);
  query.limit(20000);

  const rows = await query.find();
  const years = Array.from(new Set(rows
    .map(r => getYearFromYearMonth(r.get('year_month')))
    .filter(Boolean)))
    .sort((a, b) => b - a);

  if (!years.length) return;
  const previous = sel.value;
  sel.innerHTML = '';
  years.forEach(year => {
    const opt = document.createElement('option');
    opt.value = String(year);
    opt.textContent = String(year);
    sel.appendChild(opt);
  });
  sel.value = years.map(String).includes(previous) ? previous : String(years[0]);
}

/* Render the per-county comparison charts from County_Summary: monthly growth
   and cumulative totals for total plugs and total stations. */
async function renderCountyDeepDiveCharts(countyNames) {
  const counties = (Array.isArray(countyNames) ? countyNames : [countyNames].filter(Boolean))
    .map(getCaCountyDisplayName)
    .filter(Boolean)
    .slice(0, MAX_CA_COMPARE_COUNTIES);
  const isStatewide = !counties.length;
  const growthWrap = 'caCountyPlugsGrowthWrap';
  const cumWrap = 'caCountyPlugsCumulativeWrap';
  const stationsGrowthWrap = 'caCountyStationsGrowthWrap';
  const stationsCumWrap = 'caCountyStationsCumulativeWrap';
  const growthCanvas = document.getElementById('caCountyPlugsGrowthChart');
  const cumCanvas = document.getElementById('caCountyPlugsCumulativeChart');
  const stationsGrowthCanvas = document.getElementById('caCountyStationsGrowthChart');
  const stationsCumCanvas = document.getElementById('caCountyStationsCumulativeChart');
  if (!growthCanvas || !cumCanvas || !stationsGrowthCanvas || !stationsCumCanvas) return;

  if (!isStatewide) setCaCountySelection(counties);
  const scopeLabel = isStatewide ? 'California' : formatCaCountySelectionLabel(counties);
  const selectedYear = getSelectedCaYear();
  const yearLabel = selectedYear ? `, ${selectedYear}` : '';

  const growthTitle = document.getElementById('caCountyMonthlyGrowthTitle');
  const cumTitle = document.getElementById('caCountyPlugsCumulativeTitle');
  const stationsGrowthTitle = document.getElementById('caCountyStationsGrowthTitle');
  const stationsCumTitle = document.getElementById('caCountyStationsCumulativeTitle');
  if (growthTitle) growthTitle.textContent = `Monthly Growth — Total Plugs (${scopeLabel}${yearLabel})`;
  if (cumTitle) cumTitle.textContent = `Total Plugs — Cumulative (${scopeLabel}${yearLabel})`;
  if (stationsGrowthTitle) stationsGrowthTitle.textContent = `Monthly Growth — Stations (${scopeLabel}${yearLabel})`;
  if (stationsCumTitle) stationsCumTitle.textContent = `Total Stations — Cumulative (${scopeLabel}${yearLabel})`;

  showLoader(growthWrap, isStatewide ? 'Loading California plug growth…' : 'Loading county plug growth…');
  showLoader(cumWrap, isStatewide ? 'Loading California plug totals…' : 'Loading county plug totals…');
  showLoader(stationsGrowthWrap, isStatewide ? 'Loading California station growth…' : 'Loading county station growth…');
  showLoader(stationsCumWrap, isStatewide ? 'Loading California station totals…' : 'Loading county station totals…');

  try {
    const [plugsSeries, stationsSeries] = await Promise.all([
      fetchCACountyMonthlySeriesAll('total_all_plugs'),
      fetchCACountyMonthlySeriesAll('total_stations')
    ]);

    // Show the selected year from the County_Summary year_month values.
    const displayYM = filterYearMonths(
      filterYearMonthsForGraphs(Array.from(new Set([
      ...(plugsSeries.yearMonths || []),
      ...(stationsSeries.yearMonths || [])
    ])).sort((a, b) => String(a).localeCompare(String(b)))),
      selectedYear
    );
    if (!displayYM.length) {
      throw new Error(selectedYear ? `No county summary data available for ${selectedYear}.` : 'No county summary data available.');
    }
    const labels = getMonthsLabelsFromYearMonths(displayYM);

    const sumValuesByYM = series => {
      const valuesByYM = {};
      Object.values(series.byCounty || {}).forEach(countySeries => {
        Object.entries(countySeries.valuesByYM || {}).forEach(([ym, value]) => {
          valuesByYM[ym] = (valuesByYM[ym] || 0) + Number(value || 0);
        });
      });
      return valuesByYM;
    };

    const chartScopesForSeries = series => {
      if (!isStatewide) {
        return counties.map(county => ({
          label: county,
          valuesByYM: series.byCounty[normalizeCaCountyName(county)]?.valuesByYM || {}
        }));
      }

      return [{
        label: 'California',
        valuesByYM: sumValuesByYM(series)
      }];
    };

    const makeLineDatasets = (series, metricLabel, colorOffset = 0) => chartScopesForSeries(series).map((scope, idx) => {
      const allYM = series.yearMonths || [];
      const allCumulative = allYM.map(ym => Number(scope.valuesByYM?.[ym] ?? 0));
      const additionsByYM = {};
      allYM.forEach((ym, i) => {
        additionsByYM[ym] = i === 0 ? 0 : Math.max(0, allCumulative[i] - allCumulative[i - 1]);
      });
      const color = CHART_COLORS[(idx + colorOffset) % CHART_COLORS.length];
      return {
        label: `${scope.label} — ${metricLabel} Growth`,
        data: displayYM.map(ym => Number(additionsByYM[ym] ?? 0)),
        borderColor: color,
        backgroundColor: `${color}22`,
        borderWidth: 3,
        pointRadius: 3,
        pointBackgroundColor: color,
        tension: 0.25,
        fill: chartScopesForSeries(series).length === 1
      };
    });

    const makeBarDatasets = (series, metricLabel, colorOffset = 0) => chartScopesForSeries(series).map((scope, idx) => {
      const color = CHART_COLORS[(idx + colorOffset) % CHART_COLORS.length];
      return {
        label: `${scope.label} — Total ${metricLabel}`,
        data: displayYM.map(ym => Number(scope.valuesByYM?.[ym] ?? 0)),
        borderColor: color,
        backgroundColor: `${color}33`,
        borderWidth: 1.5,
        borderRadius: 6
      };
    });

    hideLoader(growthWrap);
    hideLoader(cumWrap);
    hideLoader(stationsGrowthWrap);
    hideLoader(stationsCumWrap);

    if (caCountyPlugsGrowthInst) { try { caCountyPlugsGrowthInst.destroy(); } catch (_) {} caCountyPlugsGrowthInst = null; }
    if (caCountyPlugsCumulativeInst) { try { caCountyPlugsCumulativeInst.destroy(); } catch (_) {} caCountyPlugsCumulativeInst = null; }
    if (caCountyStationsGrowthInst) { try { caCountyStationsGrowthInst.destroy(); } catch (_) {} caCountyStationsGrowthInst = null; }
    if (caCountyStationsCumulativeInst) { try { caCountyStationsCumulativeInst.destroy(); } catch (_) {} caCountyStationsCumulativeInst = null; }

    caCountyPlugsGrowthInst = new Chart(growthCanvas, {
      type: 'line',
      data: {
        labels,
        datasets: makeLineDatasets(plugsSeries, 'Plugs', 1)
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: !isStatewide && counties.length > 1, labels: { font: { family: 'Space Grotesk' } } },
          tooltip: { callbacks: { label: tctx => ` ${Number(tctx.raw).toLocaleString()} new plugs` } }
        },
        scales: {
          x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk', size: 11 } } },
          y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk' } }, beginAtZero: true }
        }
      }
    });

    caCountyPlugsCumulativeInst = new Chart(cumCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: makeBarDatasets(plugsSeries, 'Plugs', 1)
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: !isStatewide && counties.length > 1, labels: { font: { family: 'Space Grotesk' } } },
          tooltip: { callbacks: { label: tctx => ` ${Number(tctx.parsed.y ?? tctx.raw).toLocaleString()} plugs` } }
        },
        scales: {
          x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk', size: 11 } } },
          y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk' } }, beginAtZero: false }
        }
      }
    });

    caCountyStationsGrowthInst = new Chart(stationsGrowthCanvas, {
      type: 'line',
      data: {
        labels,
        datasets: makeLineDatasets(stationsSeries, 'Stations', 5)
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: !isStatewide && counties.length > 1, labels: { font: { family: 'Space Grotesk' } } },
          tooltip: { callbacks: { label: tctx => ` ${Number(tctx.raw).toLocaleString()} new stations` } }
        },
        scales: {
          x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk', size: 11 } } },
          y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk' } }, beginAtZero: true }
        }
      }
    });

    caCountyStationsCumulativeInst = new Chart(stationsCumCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: makeBarDatasets(stationsSeries, 'Stations', 5)
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: !isStatewide && counties.length > 1, labels: { font: { family: 'Space Grotesk' } } },
          tooltip: { callbacks: { label: tctx => ` ${Number(tctx.parsed.y ?? tctx.raw).toLocaleString()} stations` } }
        },
        scales: {
          x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk', size: 11 } } },
          y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk' } }, beginAtZero: false }
        }
      }
    });
  } catch (err) {
    console.error('renderCountyDeepDiveCharts error:', err);
    showLoader(growthWrap, 'County plug data unavailable.');
    showLoader(cumWrap, 'County plug data unavailable.');
    showLoader(stationsGrowthWrap, 'County station data unavailable.');
    showLoader(stationsCumWrap, 'County station data unavailable.');
  }
}

async function renderCANetworkShareDonut() {
  const canvas = document.getElementById('caNetworkShareChart');
  const wrapId = 'caNetworkShareWrap';
  const legend = document.getElementById('caNetworkShareLegend');
  if (!canvas) return;

  showLoader(wrapId, 'Fetching California network share…');
  if (legend) legend.innerHTML = '';

  try {
    const latestQuery = new Parse.Query('EV_Network_State_Summary');
    latestQuery.equalTo('state', 'CA');
    latestQuery.select(['year_month']);
    latestQuery.descending('year_month');
    latestQuery.limit(1);
    const latestRows = await latestQuery.find();
    const latestYM = latestRows?.[0]?.get('year_month');
    if (!latestYM) throw new Error('No California network data available.');

    const query = new Parse.Query('EV_Network_State_Summary');
    query.equalTo('state', 'CA');
    query.equalTo('year_month', latestYM);
    query.select(['ev_network', 'total_all_plugs']);
    query.limit(5000);
    const rows = await query.find();

    const isNonNetwork = n => /^non[-\s]?network/i.test(n);
    const normalizeNetworkName = n => (/^tesla(?:\s+destination)?$/i.test(n) ? 'Tesla' : n);
    const counts = {};
    rows.forEach(r => {
      const rawName = (r.get('ev_network') || '').trim() || 'Unknown';
      if (isNonNetwork(rawName)) return;
      const name = normalizeNetworkName(rawName);
      const value = Number(r.get('total_all_plugs') || 0);
      if (value <= 0) return;
      counts[name] = (counts[name] || 0) + value;
    });

    const sortedAll = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const sorted = sortedAll.slice(0, 10);
    const other = sortedAll.slice(10).reduce((sum, [, value]) => sum + Number(value || 0), 0);
    if (other > 0) sorted.push(['Other', other]);
    if (!sorted.length) throw new Error('No California network plug totals available.');

    hideLoader(wrapId);

    if (caNetworkShareInst) { try { caNetworkShareInst.destroy(); } catch (_) {} caNetworkShareInst = null; }

    const total = sorted.reduce((sum, [, value]) => sum + Number(value || 0), 0);
    const title = document.getElementById('caNetworkShareTitle');
    const subtitle = document.getElementById('caNetworkShareSubtitle');
    if (title) title.textContent = `California EV Network Share (${formatYearMonth(latestYM)})`;
    if (subtitle) subtitle.textContent = 'Filtered by state = CA using the latest month in EV_Network_State_Summary.';

    caNetworkShareInst = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: sorted.map(([name]) => name),
        datasets: [{
          data: sorted.map(([, value]) => value),
          backgroundColor: CHART_COLORS,
          borderColor: '#fff',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: tctx => {
                const value = Number(tctx?.parsed ?? tctx?.raw ?? 0);
                const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                return ` ${value.toLocaleString()} plugs (${pct}%)`;
              }
            }
          }
        }
      }
    });

    if (legend) {
      legend.innerHTML = sorted.map(([name, count], i) => {
        const pct = total > 0 ? ((Number(count) / total) * 100).toFixed(1) : '0.0';
        return `<div class="legend-item" data-fullname="${name}">
          <span class="legend-dot" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></span>
          <span class="legend-name" aria-label="${name}">${name}</span>
          <span class="legend-count">${Number(count).toLocaleString()} plugs <small>(${pct}%)</small></span>
        </div>`;
      }).join('');
    }
  } catch (err) {
    console.error('CA network share error:', err);
    hideLoader(wrapId);
    const loader = document.getElementById(wrapId)?.querySelector('.chart-loader');
    if (loader) loader.textContent = err?.message || 'California network share data unavailable.';
    if (legend) legend.innerHTML = '';
  }
}

async function renderCACountyColorMapByStations(limit = 10) {
  const svg = document.getElementById('caCountyMapSvg');
  if (!svg) return;

  const loaderEl = document.getElementById('caCountyColorMapLoader');
  if (loaderEl) loaderEl.style.display = 'flex';

  const legendEl = document.getElementById('caCountyColorLegend');

  // Populate the dropdown + wire controls up front so all counties are always
  // selectable even if the choropleth data fetch below fails.
  populateCaCountyDropdown();
  bindCaCountyControls();

  // Use the embedded California county geometry viewBox (portrait).
  if (typeof CA_COUNTY_VIEWBOX !== 'undefined') {
    svg.setAttribute('viewBox', CA_COUNTY_VIEWBOX);
  }

  try {
    if (typeof CA_COUNTY_PATHS === 'undefined') {
      throw new Error('CA county geo not loaded: CA_COUNTY_PATHS is undefined. Check js/ca-counties-geo.js (404?).');
    }
    const SVGNS = 'http://www.w3.org/2000/svg';

    // Latest month in County_Summary for CA
    const qLatest = new Parse.Query('County_Summary');
    qLatest.equalTo('state', 'CA');
    qLatest.select(['year_month']);
    qLatest.descending('year_month');
    qLatest.limit(1);
    const latestRows = await qLatest.find();
    const ymLatest = latestRows?.[0]?.get('year_month');
    if (!ymLatest) throw new Error('No latest County_Summary records found for CA.');

    // Fetch all CA counties totals for that month
    const q = new Parse.Query('County_Summary');
    q.equalTo('state', 'CA');
    q.equalTo('year_month', ymLatest);
    q.select(['county', 'total_stations']);
    q.limit(5000);

    const countyRows = await q.find();

    const countyVals = [];
    countyRows.forEach(r => {
      const county = (r.get('county') || '').trim();
      if (!county) return;
      countyVals.push({ county, v: Number(r.get('total_stations') || 0) });
    });

    if (!countyVals.length) throw new Error('No CA county station data available.');

    const values = countyVals.map(x => x.v);

    // Same choropleth as the US states map: a 5-step blue scale with quantile
    // breaks so the colors spread evenly across the (skewed) station counts.
    const breaks = computeQuantileBreaks(values, US_CHORO_BLUES.length);
    const fillForValue = (val) => {
      if (!breaks.length) return US_CHORO_BLUES[0];
      return US_CHORO_BLUES[bucketForValue(val, breaks)];
    };

    const normalizeCountyName = normalizeCaCountyName;

    // Map for quick lookup by county name
    const valueByCountyNorm = {};
    countyVals.forEach(({ county, v }) => { valueByCountyNorm[normalizeCountyName(county)] = v; });

    // Clear SVG and draw every county from the embedded geometry (no fetch).
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const group = document.createElementNS(SVGNS, 'g');
    svg.appendChild(group);

    // Reset stored shapes/labels each render.
    caCountyShapes = {};
    caCountyLabels = {};

    Object.keys(CA_COUNTY_PATHS).forEach(countyName => {
      const d = CA_COUNTY_PATHS[countyName];
      if (!d) return;

      const norm = normalizeCountyName(countyName);
      const v = Number(valueByCountyNorm[norm] ?? 0);

      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'ca-county-path');
      path.setAttribute('data-county', countyName);
      // Drive the fill via the same --choro-fill custom property the US map uses.
      path.style.setProperty('--choro-fill', fillForValue(v));

      // Hover tooltip
      const title = document.createElementNS(SVGNS, 'title');
      title.textContent = `${countyName}: ${v.toLocaleString()} total stations (latest: ${ymLatest})`;
      path.appendChild(title);

      // Click to toggle this county (updates dropdown + comparison charts).
      path.addEventListener('click', () => selectCaCounty(countyName, { toggle: true }));

      group.appendChild(path);
      caCountyShapes[norm] = path;
    });

    // Layer county-name labels at each shape's centroid so the map can be read
    // (and so graphs built from a clicked county are easy to identify).
    const labelLayer = document.createElementNS(SVGNS, 'g');
    Object.keys(CA_COUNTY_PATHS).forEach(countyName => {
      const norm = normalizeCountyName(countyName);
      const path = caCountyShapes[norm];
      if (!path) return;

      let bb;
      try { bb = path.getBBox(); } catch (_) { return; }
      const cx = bb.x + bb.width / 2;
      const cy = bb.y + bb.height / 2;

      // Scale the label to the shape; clamp so dense Bay Area counties stay legible.
      const fs = Math.max(5, Math.min(9, Math.min(bb.width, bb.height) * 0.34));

      const text = document.createElementNS(SVGNS, 'text');
      text.setAttribute('x', cx.toFixed(1));
      text.setAttribute('y', cy.toFixed(1));
      text.setAttribute('class', 'ca-county-label');
      text.setAttribute('font-size', fs.toFixed(1));
      text.textContent = countyName;
      text.addEventListener('click', () => selectCaCounty(countyName, { toggle: true }));
      labelLayer.appendChild(text);
      caCountyLabels[norm] = text;
    });
    group.appendChild(labelLayer);

    // Re-apply the selection highlight after a redraw.
    if (caCountySelected.length) highlightCaCounty(caCountySelected);

    if (loaderEl) loaderEl.style.display = 'none';

    await updateCaHeroTotalsForSelection(caCountySelected);
    if (!caCountySelected.length) showCaCountyChartsAwaitingSelection();

    // Build the same "Total stations" swatch legend as the US states map.
    if (legendEl && breaks.length) buildChoroplethLegend(legendEl, breaks);

  } catch (err) {
    console.error('CA county color map error:', err);
    if (loaderEl) {
      loaderEl.textContent = 'Data unavailable for California county coverage.';
      loaderEl.style.display = 'flex';
    }
    if (svg) while (svg.firstChild) svg.removeChild(svg.firstChild);
  }
}

async function loadStateDeepDive(state) {
  const { heroWrap, plugsWrap, stationsWrap } = getLoaderWrapIdsForStatePage(state);

  // Guards: page may not have these wraps (avoid throwing)
  if (plugsWrap) showLoader(plugsWrap, `Fetching ${state} plugs monthly trends…`);
  if (stationsWrap) showLoader(stationsWrap, `Fetching ${state} stations monthly trends…`);

  try {
    if (state === 'CA') {
      try {
        await populateCaYearDropdownFromCountySummary();
      } catch (e) {
        console.warn('Failed to populate CA years:', e);
      }
    }

    // Stat cards (CA deep dive requires these ids)
    if (state === 'CA') {
      try {
        const ym = await fetchLatestYearMonth('State_Summary', 'year_month');
        if (!ym) throw new Error('No State_Summary year_month values found for CA stats.');
        const [totalStations, totalPlugs] = await Promise.all([
          fetchTotalStationsForStateFromSummaryYearMonth('CA', ym),
          fetchTotalAllPlugsForStateFromSummaryYearMonth('CA', ym),
        ]);

        setStatVal('totalCAStations', Number(totalStations || 0).toLocaleString());
        setStatVal('totalCACities', Number(totalPlugs || 0).toLocaleString());
      } catch (e) {
        console.warn('Failed to fetch CA stat cards:', e);
      }
    }

    // Render hero top-10 counties from County_Summary total plug counts.
    await renderStateHeroTop10Counties(state, 'total_all_plugs');

    // NEW: render California county color map (stations) next to the hero chart
    if (state === 'CA') {
      await renderCACountyColorMapByStations(10);
      await renderCANetworkShareDonut();
      await renderCATop10CountiesByStations();
    }

    // Monthly cumulative plugs
    if (plugsWrap && document.getElementById(plugsWrap) && document.getElementById(
      state === 'CA' ? 'caPlugsMonthlyChart' : 'txPlugsMonthlyChart'
    )) {
      const plugsSeries = await fetchCountyMonthlyCumulativeSeries(state, 'total_all_plugs');
      const ym = plugsSeries.yearMonths;
      const labels = getMonthsLabelsFromYearMonths(ym);
      const data = ym.map(m => Number(plugsSeries.valuesByYearMonth[m] ?? 0));

      hideLoader(plugsWrap);

      const canvasId = state === 'CA' ? 'caPlugsMonthlyChart' : 'txPlugsMonthlyChart';
      const canvas = document.getElementById(canvasId);
      if (canvas) {
        if (state === 'CA' && caPlugsMonthlyChartInst) { try { caPlugsMonthlyChartInst.destroy(); } catch (_) {} }
        if (state === 'CA') {
          caPlugsMonthlyChartInst = new Chart(canvas, {
            type: 'line',
            data: {
              labels,
              datasets: [{
                label: `${state} — Monthly Total Plugs (Cumulative)`,
                data,
                borderColor: CHART_COLORS[1],
                backgroundColor: `${CHART_COLORS[1]}22`,
                borderWidth: 3,
                pointRadius: 3,
                pointBackgroundColor: CHART_COLORS[1],
                fill: true,
                tension: 0.25
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: tctx => {
                      const y = tctx?.parsed?.y ?? tctx?.raw ?? 0;
                      return ` ${Number(y).toLocaleString()} plugs`;
                    }
                  }
                }
              },
              scales: {
                x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk', size: 11 } } },
                y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk' } }, beginAtZero: false }
              }
            }
          });
        } else {
          window.txPlugsMonthlyChartInst = new Chart(canvas, {
            type: 'line',
            data: {
              labels,
              datasets: [{
                label: `${state} — Monthly Total Plugs (Cumulative)`,
                data,
                borderColor: CHART_COLORS[1],
                backgroundColor: `${CHART_COLORS[1]}22`,
                borderWidth: 3,
                pointRadius: 3,
                pointBackgroundColor: CHART_COLORS[1],
                fill: true,
                tension: 0.25
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: tctx => {
                      const y = tctx?.parsed?.y ?? tctx?.raw ?? 0;
                      return ` ${Number(y).toLocaleString()} plugs`;
                    }
                  }
                }
              },
              scales: {
                x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk', size: 11 } } },
                y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk' } }, beginAtZero: false }
              }
            }
          });
        }
      }
    }

    // Monthly cumulative total stations
    if (stationsWrap && document.getElementById(stationsWrap) && document.getElementById(
      state === 'CA' ? 'caStationsMonthlyChart' : 'txStationsMonthlyChart'
    )) {
      const stationsSeries = await fetchCountyMonthlyCumulativeSeries(state, 'total_stations');
      const ym = stationsSeries.yearMonths;
      const labels = getMonthsLabelsFromYearMonths(ym);
      const data = ym.map(m => Number(stationsSeries.valuesByYearMonth[m] ?? 0));

      hideLoader(stationsWrap);

      const canvasId = state === 'CA' ? 'caStationsMonthlyChart' : 'txStationsMonthlyChart';
      const canvas = document.getElementById(canvasId);
      if (canvas) {
        if (state === 'CA' && caStationsMonthlyChartInst) { try { caStationsMonthlyChartInst.destroy(); } catch (_) {} }
        if (state === 'CA') {
          caStationsMonthlyChartInst = new Chart(canvas, {
            type: 'line',
            data: {
              labels,
              datasets: [{
                label: `${state} — Monthly Total Stations (Cumulative)`,
                data,
                borderColor: CHART_COLORS[0],
                backgroundColor: `${CHART_COLORS[0]}22`,
                borderWidth: 3,
                pointRadius: 3,
                pointBackgroundColor: CHART_COLORS[0],
                fill: false,
                tension: 0.25
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: tctx => {
                      const y = tctx?.parsed?.y ?? tctx?.raw ?? 0;
                      return ` ${Number(y).toLocaleString()} total stations`;
                    }
                  }
                }
              },
              scales: {
                x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk', size: 11 } } },
                y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk' } }, beginAtZero: false }
              }
            }
          });
        } else {
          window.txStationsMonthlyChartInst = new Chart(canvas, {
            type: 'line',
            data: {
              labels,
              datasets: [{
                label: `${state} — Monthly Total Stations (Cumulative)`,
                data,
                borderColor: CHART_COLORS[0],
                backgroundColor: `${CHART_COLORS[0]}22`,
                borderWidth: 3,
                pointRadius: 3,
                pointBackgroundColor: CHART_COLORS[0],
                fill: false,
                tension: 0.25
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: tctx => {
                      const y = tctx?.parsed?.y ?? tctx?.raw ?? 0;
                      return ` ${Number(y).toLocaleString()} total stations`;
                    }
                  }
                }
              },
              scales: {
                x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk', size: 11 } } },
                y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk' } }, beginAtZero: false }
              }
            }
          });
        }
      }
    }
  } catch (err) {
    console.error(`${state} deep dive error:`, err);
  } finally {
    if (plugsWrap) hideLoader(plugsWrap);
    if (stationsWrap) hideLoader(stationsWrap);
  }
}

async function loadCaliforniaAnalysis() {
  // Legacy page previously rendered city + network charts, but the deep-dive HTML now includes
  // only hero top counties + 2 monthly charts. Guard against missing legacy canvases.
  await loadStateDeepDive('CA');
}

async function loadTexasAnalysis() {
  await loadStateDeepDive('TX');
}

function renderCAMonthlyChart(results, networkCounts) {
  const months     = generateMonthsSince2026();
  const monthLabels = months.map(ym => {
    const [y, m] = ym.split('-').map(Number);
    return `${MONTH_NAMES[m - 1]} ${y}`;
  });

  /* Top 6 networks in CA */
  const topNetworks = Object.entries(networkCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name]) => name);

  const datasets = topNetworks.map((network, i) => {
    const netRecords = results.filter(r => (r.get('EV_NETWORK') || '').trim() === network);

    const data = months.map(ym => {
      const [year, month] = ym.split('-').map(Number);
      const endOfMonth = new Date(year, month, 0);
      return netRecords.filter(r => {
        const raw = r.get('OPEN_DATE') || r.createdAt;
        const d   = parseOpenDate(raw);
        return d && d <= endOfMonth;
      }).length;
    });

    const hasData   = data.some(v => v > 0);
    const finalData = hasData ? data : months.map(() => netRecords.length);

    return {
      label: network,
      data: finalData,
      borderColor: CHART_COLORS[i % CHART_COLORS.length],
      backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + '22',
      borderWidth: 2,
      pointRadius: 3,
      fill: false,
      tension: 0.3
    };
  });

  hideLoader('caMonthlyChartWrap');

  const ctx = document.getElementById('caMonthlyChart');
  if (caMonthlyChartInst) caMonthlyChartInst.destroy();
  caMonthlyChartInst = new Chart(ctx, {
    type: 'line',
    data: { labels: monthLabels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { font: { family: 'Space Grotesk', size: 12 } } },
        tooltip: {
          callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString()} DC plugs`
          }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk', size: 11 } } },
        y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk' } }, beginAtZero: false }
      }
    }
  });
}

async function loadMonthlyUSPlugsGrowthAndTotal() {
  // Repurpose the “monthlyState…” charts on the index page to be US-wide plugs charts.
  const plugsWrap = 'monthlyStatePlugsGrowthWrap';
  const stationsWrap = 'monthlyStateStationsWrap';

  const plugsCanvas = document.getElementById('monthlyStatePlugsGrowthChart');
  const stationsCanvas = document.getElementById('monthlyStateStationsChart');
  if (!plugsCanvas || !stationsCanvas) return;

  const wrapMissing = () => !document.getElementById(plugsWrap) || !document.getElementById(stationsWrap);
  if (wrapMissing()) return;

  showLoader(plugsWrap, 'Fetching monthly USA stations growth…');
  showLoader(stationsWrap, 'Fetching monthly USA total stations…');

  try {
    // Fetch unfiltered so Jan 2026 can compute delta vs Dec 2025.
    const series = await fetchUSMonthlyCumulativeSeriesUnfiltered('total_all_plugs');

    const allYM = series.yearMonths;
    const allPlugsCum = allYM.map(ym => Number(series.valuesByYearMonth[ym] ?? 0));

    // Display only months >= Jan 2026
    const displayYM = allYM.filter(ym => isYearMonthOnOrAfter(ym, '2026_01'));
    const labels = displayYM.map(ym => formatYearMonth(ym));

    // For each displayed month, compute delta vs previous month in the FULL unfiltered series.
    const plugsAdditions = displayYM.map(ym => {
      const idx = allYM.indexOf(ym);
      if (idx <= 0) return Number(series.valuesByYearMonth[ym] ?? 0);
      const prev = Number(series.valuesByYearMonth[allYM[idx - 1]] ?? 0);
      const cur = Number(series.valuesByYearMonth[ym] ?? 0);
      return Math.max(0, cur - prev);
    });

    const plugsCumulative = displayYM.map(ym => Number(series.valuesByYearMonth[ym] ?? 0));

    hideLoader(plugsWrap);
    hideLoader(stationsWrap);

    if (monthlyStatePlugsGrowthInst) { try { monthlyStatePlugsGrowthInst.destroy(); } catch (_) {} monthlyStatePlugsGrowthInst = null; }
    if (monthlyStateStationsInst) { try { monthlyStateStationsInst.destroy(); } catch (_) {} monthlyStateStationsInst = null; }

    monthlyStatePlugsGrowthInst = new Chart(plugsCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'USA — Total Stations Growth',
          data: plugsAdditions,
          borderColor: CHART_COLORS[1],
          backgroundColor: `${CHART_COLORS[1]}55`,
          borderWidth: 1.5,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: tctx => ` ${Number(tctx.raw).toLocaleString()} new stations`
            }
          }
        },
        scales: {
          x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk', size: 10 } } },
          y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk' } }, beginAtZero: true }
        }
      }
    });

    monthlyStateStationsInst = new Chart(stationsCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'USA — Total Stations (Cumulative)',
          data: plugsCumulative,
          borderColor: CHART_COLORS[0],
          backgroundColor: `${CHART_COLORS[0]}33`,
          borderWidth: 1.5,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: tctx => ` ${Number(tctx.raw).toLocaleString()} total stations`
            }
          }
        },
        scales: {
          x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk', size: 10 } } },
          y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk' } }, beginAtZero: false }
        }
      }
    });
  } catch (err) {
    hideLoader(plugsWrap);
    hideLoader(stationsWrap);
    console.error('Monthly US plugs chart render error:', err);

    if (monthlyStatePlugsGrowthInst) { try { monthlyStatePlugsGrowthInst.destroy(); } catch (_) {} monthlyStatePlugsGrowthInst = null; }
    if (monthlyStateStationsInst) { try { monthlyStateStationsInst.destroy(); } catch (_) {} monthlyStateStationsInst = null; }

    const msg = /permission denied|acl/i.test(String(err)) ?
      'Back4App permissions denied for State_Summary. Ask your admin to grant read access.' :
      (err && err.message ? err.message : 'Failed to load US monthly stations series.');

    const plugsLoader = document.getElementById(plugsWrap)?.querySelector('.chart-loader');
    const stationsLoader = document.getElementById(stationsWrap)?.querySelector('.chart-loader');
    if (plugsLoader) plugsLoader.textContent = msg;
    if (stationsLoader) stationsLoader.textContent = msg;
  }
}

async function initializeMonthlyStateDropdowns() {
  const yearSelectEl = document.getElementById('monthlyStateYearSelect');
  const stateSelectEl = document.getElementById('monthlyStateAddSelect');
  if (!yearSelectEl || !stateSelectEl) return;

  // State dropdown
  stateSelectEl.innerHTML = `<option value="">— Choose a State —</option>`;
  Object.keys(US_STATES).sort().forEach(code => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = US_STATES[code] || code;
    stateSelectEl.appendChild(opt);
  });

  // Pick default state
  const defaultState = 'CA';
  stateSelectEl.value = defaultState;

  // Populate years for that default state
  let years = [];
  try {
    years = await fetchAvailableYearsForState(defaultState);
  } catch (e) {
    years = [];
  }

  // Fallback if no years found / ACL denied
  if (!years.length) years = ['2026'];

  yearSelectEl.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
  // Default year (prefer 2026 if present)
  yearSelectEl.value = years.includes('2026') ? '2026' : years[0];
}

/* -------------------------------------------------------
   US PLUGS ANALYSIS PAGE (us-data-analysis.html)
------------------------------------------------------- */

function showUSPlugsLoader(wrapId, msg) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const loader = wrap.querySelector('.chart-loader');
  const canvas = wrap.querySelector('canvas');
  if (loader) { loader.style.display = 'flex'; loader.textContent = msg || 'Loading…'; }
  if (canvas) canvas.style.display = 'none';
}

function hideUSPlugsLoader(wrapId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const loader = wrap.querySelector('.chart-loader');
  const canvas = wrap.querySelector('canvas');
  if (loader) loader.style.display = 'none';
  if (canvas) canvas.style.display = 'block';
}

async function fetchStateMonthlyPlugsAndStationsByYearMonth(stateCode) {
  if (stateCode === 'ALL') {
    const [plugsSeries, stationsSeries] = await Promise.all([
      fetchUSMonthlyCumulativeSeriesUnfiltered('total_all_plugs'),
      fetchUSMonthlyCumulativeSeriesUnfiltered('total_stations')
    ]);

    const yearMonthsAll = Array.from(new Set([
      ...(plugsSeries.yearMonths || []),
      ...(stationsSeries.yearMonths || [])
    ])).sort((a, b) => String(a).localeCompare(String(b)));

    return {
      yearMonthsAll,
      plugsByYearMonth: plugsSeries.valuesByYearMonth || {},
      stationsByYearMonth: stationsSeries.valuesByYearMonth || {}
    };
  }

  // Single state query returning both series aligned by year_month.
  const query = new Parse.Query('State_Summary');
  query.equalTo('state', stateCode);
  query.select(['year_month', 'total_all_plugs', 'total_stations']);
  query.limit(20000);

  const results = await query.find();
  const plugsByYearMonth = {};
  const stationsByYearMonth = {};
  const yearMonthsSet = new Set();

  results.forEach(r => {
    const ym = r.get('year_month');
    if (!ym) return;
    yearMonthsSet.add(ym);
    plugsByYearMonth[ym] = Number(r.get('total_all_plugs') || 0);
    stationsByYearMonth[ym] = Number(r.get('total_stations') || 0);
  });

  const yearMonthsAll = Array.from(yearMonthsSet).sort((a, b) => String(a).localeCompare(String(b)));
  return { yearMonthsAll, plugsByYearMonth, stationsByYearMonth };
}

function populateUSPlugsStateOptions() {
  const stateSelectEl = document.getElementById('usPlugsStateSelect');
  if (!stateSelectEl) return;

  stateSelectEl.innerHTML = `<option value="ALL">All</option>`;
  Object.keys(US_STATES)
    .sort((a, b) => US_STATES[a].localeCompare(US_STATES[b]))
    .forEach(code => {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = US_STATES[code] || code;
      stateSelectEl.appendChild(opt);
    });

  stateSelectEl.value = 'ALL';
}

function getSelectedUSStateCodes() {
  const stateSelectEl = document.getElementById('usPlugsStateSelect');
  if (!stateSelectEl) return ['ALL'];

  const selected = Array.from(stateSelectEl.selectedOptions || [])
    .map(opt => opt.value)
    .filter(Boolean);

  if (!selected.length || selected.includes('ALL')) return ['ALL'];
  return selected.filter(code => US_STATES[code]).slice(0, MAX_US_COMPARE_STATES);
}

function setUSStateSelection(codes) {
  const stateSelectEl = document.getElementById('usPlugsStateSelect');
  if (!stateSelectEl) return;

  const normalized = Array.isArray(codes) && codes.length
    ? codes.filter(code => code === 'ALL' || US_STATES[code]).slice(0, MAX_US_COMPARE_STATES)
    : ['ALL'];
  const finalCodes = normalized.includes('ALL') ? ['ALL'] : normalized;
  const selected = new Set(finalCodes);

  Array.from(stateSelectEl.options).forEach(opt => {
    opt.selected = selected.has(opt.value);
  });

  const evt = new CustomEvent('us-state-selection-updated', { detail: { states: finalCodes } });
  stateSelectEl.dispatchEvent(evt);
}

function enforceUSCompareLimit() {
  const stateSelectEl = document.getElementById('usPlugsStateSelect');
  const hintEl = document.getElementById('usCompareHint');
  if (!stateSelectEl) return ['ALL'];

  let selected = Array.from(stateSelectEl.selectedOptions || []).map(opt => opt.value).filter(Boolean);

  if (!selected.length) selected = ['ALL'];
  if (selected.includes('ALL') && selected.length > 1) {
    selected = selected.filter(code => code !== 'ALL');
  }
  if (!selected.length) selected = ['ALL'];

  if (!selected.includes('ALL') && selected.length > MAX_US_COMPARE_STATES) {
    selected = selected.slice(0, MAX_US_COMPARE_STATES);
    if (hintEl) hintEl.textContent = 'Only four states can be compared at once.';
  } else if (hintEl) {
    hintEl.textContent = 'Select up to four states, or choose All for national totals.';
  }

  setUSStateSelection(selected);
  return getSelectedUSStateCodes();
}

async function populateUSPlugsYearDropdown(stateCode) {
  const yearSelectEl = document.getElementById('usPlugsYearSelect');
  if (!yearSelectEl) return;

  let years = [];
  try {
    years = await fetchAvailableYearsForState(stateCode);
  } catch (e) {
    years = [];
  }
  if (!years.length) years = ['2026'];

  yearSelectEl.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
  yearSelectEl.value = years.includes('2026') ? '2026' : years[0];
}

async function fetchLatestYearMonthForStateInYear(stateCode, year) {
  const query = new Parse.Query('State_Summary');
  query.equalTo('state', stateCode);
  query.select(['year_month']);
  query.limit(5000);

  const rows = await query.find();
  const yearMonths = (rows || [])
    .map(r => r.get('year_month'))
    .filter(ym => ym && getYearFromYearMonth(ym) === Number(year));

  if (!yearMonths.length) return null;
  return yearMonths.sort((a, b) => String(a).localeCompare(String(b)))[yearMonths.length - 1];
}

async function renderUSTopNetworksAndCounties(stateCode, selectedYear) {
  const networksCanvas = document.getElementById('usTopNetworksChart');
  const countiesCanvas = document.getElementById('usTopCountiesChart');

  const networksWrapId = 'usTopNetworksWrap';
  const countiesWrapId = 'usTopCountiesWrap';

  const yearNum = Number(selectedYear);
  const isAllStates = stateCode === 'ALL';
  const scopeLabel = isAllStates ? 'All States' : US_STATES[stateCode];
  if (!networksCanvas && !countiesCanvas) return;

  // Networks are NOT state-specific in EV_Network_Summary, so we compute for the latest month in the selected year.
  let latestYM = null;
  try {
    const ymRows = await (async () => {
      const q = new Parse.Query('EV_Network_Summary');
      q.select(['year_month']);
      q.limit(5000);
      const rows = await q.find();
      return rows.map(r => r.get('year_month')).filter(ym => ym && getYearFromYearMonth(ym) === yearNum);
    })();

    if (ymRows && ymRows.length) {
      latestYM = ymRows.sort((a, b) => String(a).localeCompare(String(b)))[ymRows.length - 1];
    }
  } catch (_) {
    latestYM = null;
  }

  // Fetch top networks for latestYM
  if (networksCanvas) {
    showUSPlugsLoader(networksWrapId, 'Fetching top EV networks…');
    try {
      if (!latestYM) throw new Error('No network data available for the selected year.');

      const q = new Parse.Query('EV_Network_Summary');
      q.equalTo('year_month', latestYM);
      q.select(['ev_network', 'total_all_plugs']);
      q.limit(5000);
      const rows = await q.find();

      const isNonNetwork = n => /^non[-\s]?network/i.test(n);
      const normalizeNetworkName = n => (/^tesla(?:\s+destination)?$/i.test(n) ? 'Tesla' : n);
      const counts = {};
      rows.forEach(r => {
        const rawName = (r.get('ev_network') || '').trim() || 'Unknown';
        if (isNonNetwork(rawName)) return;
        const n = normalizeNetworkName(rawName);
        const v = Number(r.get('total_all_plugs') || 0);
        counts[n] = (counts[n] || 0) + v;
      });

      const sortedAll = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const sorted = sortedAll.slice(0, 10);
      const other = sortedAll.slice(10).reduce((sum, [, value]) => sum + Number(value || 0), 0);
      if (other > 0) sorted.push(['Other', other]);
      if (!sorted.length) throw new Error('No EV network summary data available.');

      hideUSPlugsLoader(networksWrapId);

      if (usTopNetworksInst) { try { usTopNetworksInst.destroy(); } catch (_) {} usTopNetworksInst = null; }

      const total = sorted.reduce((sum, [, value]) => sum + Number(value || 0), 0);
      const title = document.getElementById('usTopNetworksTitle');
      if (title) title.textContent = 'EV Network Share for the latest available month';

      usTopNetworksInst = new Chart(networksCanvas, {
        type: 'doughnut',
        data: {
          labels: sorted.map(([n]) => n),
          datasets: [{
            data: sorted.map(([, v]) => v),
            backgroundColor: CHART_COLORS,
            borderColor: '#fff',
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '62%',
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: tctx => {
                  const value = Number(tctx?.parsed ?? tctx?.raw ?? 0);
                  const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                  return ` ${value.toLocaleString()} plugs (${pct}%)`;
                }
              }
            }
          }
        }
      });

      const legend = document.getElementById('usTopNetworksLegend');
      if (legend) {
        legend.innerHTML = sorted.map(([name, count], i) => {
          const pct = total > 0 ? ((Number(count) / total) * 100).toFixed(1) : '0.0';
          return `<div class="legend-item" data-fullname="${name}">
            <span class="legend-dot" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></span>
            <span class="legend-name" aria-label="${name}">${name}</span>
            <span class="legend-count">${Number(count).toLocaleString()} plugs <small>(${pct}%)</small></span>
          </div>`;
        }).join('');
      }
    } catch (err) {
      hideUSPlugsLoader(networksWrapId);
      const loader = document.getElementById(networksWrapId)?.querySelector('.chart-loader');
      if (loader) loader.textContent = err?.message ? err.message : 'Failed to load top networks.';
      const legend = document.getElementById('usTopNetworksLegend');
      if (legend) legend.innerHTML = '';
    }
  }

  // Fetch top counties for the selected state (or nationally for All) + latestYM in selected year.
  if (countiesCanvas) {
    showUSPlugsLoader(countiesWrapId, 'Fetching top counties…');
    try {
      const latestStateYM = isAllStates ? latestYM : await fetchLatestYearMonthForStateInYear(stateCode, selectedYear);
      if (!latestStateYM) throw new Error('No county data available for this state/year.');

      const q = new Parse.Query('County_Summary');
      if (!isAllStates) q.equalTo('state', stateCode);
      q.equalTo('year_month', latestStateYM);
      q.select(['state', 'county', 'total_dc_fast_plugs']);
      q.limit(20000);
      const rows = await q.find();

      const counts = {};
      rows.forEach(r => {
        const c = (r.get('county') || '').trim();
        if (!c) return;
        const label = isAllStates ? `${c}, ${r.get('state') || ''}`.trim() : c;
        const v = Number(r.get('total_dc_fast_plugs') || 0);
        counts[label] = (counts[label] || 0) + v;
      });

      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
      if (!sorted.length) throw new Error('No county summary data available.');

      hideUSPlugsLoader(countiesWrapId);

      if (usTopCountiesInst) { try { usTopCountiesInst.destroy(); } catch (_) {} usTopCountiesInst = null; }

      usTopCountiesInst = new Chart(countiesCanvas, {
        type: 'bar',
        data: {
          labels: sorted.map(([c]) => c),
          datasets: [{
            label: `DC Fast Plugs (${scopeLabel}, ${selectedYear})`,
            data: sorted.map(([, v]) => v),
            borderColor: CHART_COLORS[1],
            backgroundColor: `${CHART_COLORS[1]}55`,
            borderWidth: 1.5,
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: tctx => ` ${Number(tctx.raw).toLocaleString()} plugs` } }
          },
          scales: {
            x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk', size: 10 } } },
            y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk' } }, beginAtZero: true }
          }
        }
      });
    } catch (err) {
      hideUSPlugsLoader(countiesWrapId);
      const loader = document.getElementById(countiesWrapId)?.querySelector('.chart-loader');
      if (loader) loader.textContent = err?.message ? err.message : 'Failed to load top counties.';
    }
  }
}

async function renderUSPlugsCharts() {
  const stateSelectEl = document.getElementById('usPlugsStateSelect');
  const yearSelectEl  = document.getElementById('usPlugsYearSelect');
  const growthCanvas = document.getElementById('usMonthlyPlugsGrowthChart');
  const cumCanvas     = document.getElementById('usMonthlyPlugsCumulativeChart');
  const stationsGrowthCanvas = document.getElementById('usMonthlyStationsGrowthChart');
  const stationsCumCanvas = document.getElementById('usMonthlyStationsCumulativeChart');

  const growthWrapId = 'usMonthlyPlugsGrowthWrap';
  const cumWrapId    = 'usMonthlyPlugsCumulativeWrap';
  const stationsGrowthWrapId = 'usMonthlyStationsGrowthWrap';
  const stationsCumWrapId = 'usMonthlyStationsCumulativeWrap';

  const selectedStates = getSelectedUSStateCodes();
  const selectedYear = yearSelectEl?.value;
  const isAllStates = selectedStates.length === 1 && selectedStates[0] === 'ALL';
  const scopeLabel = isAllStates
    ? 'All States'
    : selectedStates.map(code => US_STATES[code] || code).join(', ');

  if (!selectedStates.length || (!isAllStates && selectedStates.some(code => !US_STATES[code]))) {
    console.warn('renderUSPlugsCharts: invalid/missing selected states:', selectedStates);
    return;
  }
  if (!selectedYear) {
    console.warn('renderUSPlugsCharts: missing selectedYear');
    return;
  }

  const titleGrowth = document.getElementById('usMonthlyGrowthTitle');
  const titleCum    = document.getElementById('usTotalPlugsTitle');
  const titleStationsGrowth = document.getElementById('usMonthlyStationsGrowthTitle');
  const titleStationsCum = document.getElementById('usTotalStationsTitle');

  // Main month-by-month charts
  if (growthCanvas && cumCanvas) {
    showUSPlugsLoader(growthWrapId, 'Fetching monthly plugs growth…');
    showUSPlugsLoader(cumWrapId, 'Fetching monthly cumulative plugs…');
    showUSPlugsLoader(stationsGrowthWrapId, 'Fetching monthly stations growth…');
    showUSPlugsLoader(stationsCumWrapId, 'Fetching monthly cumulative stations…');

    try {
      const seriesByState = await Promise.all(selectedStates.map(async code => ({
        code,
        label: code === 'ALL' ? 'All States' : (US_STATES[code] || code),
        series: await fetchStateMonthlyPlugsAndStationsByYearMonth(code)
      })));

      const hasAnySeries = seriesByState.some(item => item.series?.yearMonthsAll?.length);
      if (!hasAnySeries) {
        console.warn('renderUSPlugsCharts: empty series returned for', { selectedStates, selectedYear });
        const growthWrap = document.getElementById(growthWrapId);
        const cumWrap = document.getElementById(cumWrapId);
        const stationsGrowthWrap = document.getElementById(stationsGrowthWrapId);
        const stationsCumWrap = document.getElementById(stationsCumWrapId);
        if (growthWrap) {
          const loader = growthWrap.querySelector('.chart-loader');
          if (loader) loader.textContent = 'No monthly plugs data for this state/year.';
        }
        if (cumWrap) {
          const loader = cumWrap.querySelector('.chart-loader');
          if (loader) loader.textContent = 'No monthly stations data for this state/year.';
        }
        if (stationsGrowthWrap) {
          const loader = stationsGrowthWrap.querySelector('.chart-loader');
          if (loader) loader.textContent = 'No monthly stations data for this state/year.';
        }
        if (stationsCumWrap) {
          const loader = stationsCumWrap.querySelector('.chart-loader');
          if (loader) loader.textContent = 'No monthly stations data for this state/year.';
        }
        // Hide loaders so UI doesn't look stuck
        hideUSPlugsLoader(growthWrapId);
        hideUSPlugsLoader(cumWrapId);
        hideUSPlugsLoader(stationsGrowthWrapId);
        hideUSPlugsLoader(stationsCumWrapId);
        return;
      }

      const allYearMonths = Array.from(new Set(seriesByState.flatMap(item => item.series?.yearMonthsAll || [])))
        .sort((a, b) => String(a).localeCompare(String(b)));
      const yearMonths = allYearMonths.filter(ym => getYearFromYearMonth(ym) === Number(selectedYear));
      if (!yearMonths.length) throw new Error(`No monthly data for the selected states in ${selectedYear}.`);

      const labels = yearMonths.map(ym => formatYearMonth(ym));

      const growthDatasets = [];
      const cumulativeDatasets = [];
      const stationsGrowthDatasets = [];
      const stationsCumulativeDatasets = [];
      let latestStationsTotal = 0;
      let latestPlugsTotal = 0;

      seriesByState.forEach((item, idx) => {
        const series = item.series || {};
        const allYM = series.yearMonthsAll || [];
        const allPlugsCum = allYM.map(ym => Number(series.plugsByYearMonth?.[ym] ?? 0));
        const additionsByYM = {};
        allYM.forEach((ym, i) => {
          additionsByYM[ym] = i === 0 ? 0 : Math.max(0, allPlugsCum[i] - allPlugsCum[i - 1]);
        });

        const plugsCumulative = yearMonths.map(ym => Number(series.plugsByYearMonth?.[ym] ?? 0));
        const plugsAdditions = yearMonths.map(ym => Number(additionsByYM[ym] ?? 0));
        const allStationsCum = allYM.map(ym => Number(series.stationsByYearMonth?.[ym] ?? 0));
        const stationAdditionsByYM = {};
        allYM.forEach((ym, i) => {
          stationAdditionsByYM[ym] = i === 0 ? 0 : Math.max(0, allStationsCum[i] - allStationsCum[i - 1]);
        });
        const stationsCumulative = yearMonths.map(ym => Number(series.stationsByYearMonth?.[ym] ?? 0));
        const stationsAdditions = yearMonths.map(ym => Number(stationAdditionsByYM[ym] ?? 0));
        const color = CHART_COLORS[(idx + 1) % CHART_COLORS.length];

        latestStationsTotal += stationsCumulative[stationsCumulative.length - 1] || 0;
        latestPlugsTotal += plugsCumulative[plugsCumulative.length - 1] || 0;

        growthDatasets.push({
          label: `${item.label} — Plugs Growth (${selectedYear})`,
          data: plugsAdditions,
          borderColor: color,
          backgroundColor: `${color}22`,
          borderWidth: 3,
          pointRadius: 3,
          pointBackgroundColor: color,
          tension: 0.25,
          fill: isAllStates
        });

        cumulativeDatasets.push({
          label: `${item.label} — Total Plugs Cumulative (${selectedYear})`,
          data: plugsCumulative,
          borderColor: color,
          backgroundColor: `${color}33`,
          borderWidth: 1.5,
          borderRadius: 6
        });

        stationsGrowthDatasets.push({
          label: `${item.label} — Stations Growth (${selectedYear})`,
          data: stationsAdditions,
          borderColor: color,
          backgroundColor: `${color}22`,
          borderWidth: 3,
          pointRadius: 3,
          pointBackgroundColor: color,
          tension: 0.25,
          fill: isAllStates
        });

        stationsCumulativeDatasets.push({
          label: `${item.label} — Total Stations Cumulative (${selectedYear})`,
          data: stationsCumulative,
          borderColor: color,
          backgroundColor: `${color}33`,
          borderWidth: 1.5,
          borderRadius: 6
        });
      });

      const lastIdx = labels.length - 1;
      const latestLabel = labels[lastIdx] || selectedYear;
      setStatVal('usTotalStations', latestStationsTotal.toLocaleString());
      setStatVal('usTotalPlugs', latestPlugsTotal.toLocaleString());
      setStatVal('usTotalStationsSub', `${scopeLabel} · as of ${latestLabel}`);
      setStatVal('usTotalPlugsSub', `${scopeLabel} · as of ${latestLabel}`);

      hideUSPlugsLoader(growthWrapId);
      hideUSPlugsLoader(cumWrapId);
      hideUSPlugsLoader(stationsGrowthWrapId);
      hideUSPlugsLoader(stationsCumWrapId);

      if (usPlugsGrowthInst) { try { usPlugsGrowthInst.destroy(); } catch (_) {} usPlugsGrowthInst = null; }
      if (usPlugsCumulativeInst) { try { usPlugsCumulativeInst.destroy(); } catch (_) {} usPlugsCumulativeInst = null; }
      if (usStationsGrowthInst) { try { usStationsGrowthInst.destroy(); } catch (_) {} usStationsGrowthInst = null; }
      if (usStationsCumulativeInst) { try { usStationsCumulativeInst.destroy(); } catch (_) {} usStationsCumulativeInst = null; }

      if (titleGrowth) titleGrowth.textContent = `Monthly Growth — Total Plugs (${scopeLabel}, ${selectedYear})`;
      if (titleCum) titleCum.textContent = `Total Plugs — Cumulative (${scopeLabel}, ${selectedYear})`;
      if (titleStationsGrowth) titleStationsGrowth.textContent = `Monthly Growth — Total Stations (${scopeLabel}, ${selectedYear})`;
      if (titleStationsCum) titleStationsCum.textContent = `Total Stations — Cumulative (${scopeLabel}, ${selectedYear})`;

      usPlugsGrowthInst = new Chart(growthCanvas, {
        type: 'line',
        data: {
          labels,
          datasets: growthDatasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: !isAllStates, labels: { font: { family: 'Space Grotesk' } } },
            tooltip: { callbacks: { label: tctx => ` ${Number(tctx.raw).toLocaleString()} new plugs` } }
          },
          scales: {
            x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk', size: 10 } } },
            y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk' } }, beginAtZero: true }
          }
        }
      });

      usPlugsCumulativeInst = new Chart(cumCanvas, {
        type: 'bar',
        data: {
          labels,
          datasets: cumulativeDatasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: !isAllStates, labels: { font: { family: 'Space Grotesk' } } },
            tooltip: { callbacks: { label: tctx => ` ${Number(tctx.raw).toLocaleString()} total plugs` } }
          },
          scales: {
            x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk', size: 10 } } },
            y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk' } }, beginAtZero: false }
          }
        }
      });

      if (stationsCumCanvas) {
        usStationsCumulativeInst = new Chart(stationsCumCanvas, {
          type: 'bar',
          data: {
            labels,
            datasets: stationsCumulativeDatasets
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: !isAllStates, labels: { font: { family: 'Space Grotesk' } } },
              tooltip: { callbacks: { label: tctx => ` ${Number(tctx.raw).toLocaleString()} total stations` } }
            },
            scales: {
              x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk', size: 10 } } },
              y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk' } }, beginAtZero: false }
            }
          }
        });
      }

      if (stationsGrowthCanvas) {
        usStationsGrowthInst = new Chart(stationsGrowthCanvas, {
          type: 'line',
          data: {
            labels,
            datasets: stationsGrowthDatasets
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: !isAllStates, labels: { font: { family: 'Space Grotesk' } } },
              tooltip: { callbacks: { label: tctx => ` ${Number(tctx.raw).toLocaleString()} new stations` } }
            },
            scales: {
              x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk', size: 10 } } },
              y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk' } }, beginAtZero: true }
            }
          }
        });
      }
    } catch (err) {
      hideUSPlugsLoader(growthWrapId);
      hideUSPlugsLoader(cumWrapId);
      hideUSPlugsLoader(stationsGrowthWrapId);
      hideUSPlugsLoader(stationsCumWrapId);

      console.error('US plugs render error:', err);

      const msg = /permission denied|acl/i.test(String(err)) ?
        'Back4App permissions denied for State_Summary. Ask your admin to grant read access.' :
        (err && err.message ? err.message : 'Failed to load state plugs series.');

      const growthLoader = document.getElementById(growthWrapId)?.querySelector('.chart-loader');
      const cumLoader = document.getElementById(cumWrapId)?.querySelector('.chart-loader');
      const stationsGrowthLoader = document.getElementById(stationsGrowthWrapId)?.querySelector('.chart-loader');
      const stationsCumLoader = document.getElementById(stationsCumWrapId)?.querySelector('.chart-loader');
      if (growthLoader) growthLoader.textContent = msg;
      if (cumLoader) cumLoader.textContent = msg;
      if (stationsGrowthLoader) stationsGrowthLoader.textContent = msg;
      if (stationsCumLoader) stationsCumLoader.textContent = msg;
    }
  }

  // Network-share card under the monthly charts.
  await renderUSTopNetworksAndCounties(isAllStates ? 'ALL' : selectedStates[0], selectedYear);
}

/* -------------------------------------------------------
   US MAP CHOROPLETH — color states by total station count
   Darker blue = more stations. Drives the --choro-fill CSS
   custom property on each state path + builds the legend.
------------------------------------------------------- */
const US_CHORO_BLUES = ['#eef5fd', '#cfe2f7', '#a7c8ee', '#7aa9e0', '#4f86cf'];

async function fetchStationsByStateLatest() {
  if (typeof Parse === 'undefined' || !Parse.Query) return {};

  // Latest available month in State_Summary.
  const qLatest = new Parse.Query('State_Summary');
  qLatest.select(['year_month']);
  qLatest.descending('year_month');
  qLatest.limit(1);
  const latestRows = await qLatest.find();
  const ymLatest = latestRows?.[0]?.get('year_month');
  if (!ymLatest) return {};

  const q = new Parse.Query('State_Summary');
  q.equalTo('year_month', ymLatest);
  q.select(['state', 'total_stations']);
  q.limit(5000);
  const rows = await q.find();

  const out = {};
  rows.forEach(r => {
    const code = r.get('state');
    if (!code) return;
    out[code] = Number(r.get('total_stations') || 0);
  });
  return out;
}

// Quantile breakpoints so colors spread evenly across the (skewed) station counts.
function computeQuantileBreaks(values, buckets) {
  const sorted = values.filter(v => v > 0).sort((a, b) => a - b);
  if (!sorted.length) return [];
  const quantile = p => {
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };
  const breaks = [];
  for (let i = 1; i < buckets; i++) breaks.push(Math.round(quantile(i / buckets)));
  return breaks;
}

function bucketForValue(v, breaks) {
  let bi = 0;
  for (let i = 0; i < breaks.length; i++) { if (v > breaks[i]) bi = i + 1; }
  return bi;
}

function buildChoroplethLegend(legendEl, breaks) {
  const fmt = n => Number(n).toLocaleString();
  const ranges = [`1–${fmt(breaks[0])}`];
  for (let i = 1; i < breaks.length; i++) ranges.push(`${fmt(breaks[i - 1] + 1)}–${fmt(breaks[i])}`);
  ranges.push(`${fmt(breaks[breaks.length - 1] + 1)}+`);

  const steps = US_CHORO_BLUES.map((c, i) => `
    <div class="legend-step">
      <span class="legend-swatch" style="background:${c}"></span>
      <span class="legend-range">${ranges[i] || ''}</span>
    </div>`).join('');

  legendEl.innerHTML = `
    <span class="legend-title">Total stations</span>
    <div class="legend-steps">${steps}</div>`;
  legendEl.removeAttribute('aria-hidden');
}

// Apply the choropleth to already-drawn state shapes (non-blocking; map stays
// interactive even if this data fetch is slow or fails).
async function colorStatesByStationCount(shapes, labels, legendEl) {
  const stationsByState = await fetchStationsByStateLatest();
  const values = Object.values(stationsByState);
  if (!values.length) return;

  const breaks = computeQuantileBreaks(values, US_CHORO_BLUES.length);
  if (!breaks.length) return;

  Object.entries(shapes).forEach(([code, path]) => {
    const v = Number(stationsByState[code] || 0);
    const bi = bucketForValue(v, breaks);
    path.style.setProperty('--choro-fill', US_CHORO_BLUES[bi]);

    // Keep the abbreviation readable on the darker shades. External labels
    // (tiny NE states) float on the white margin, so leave those dark.
    const lbl = labels[code];
    if (lbl && !lbl.classList.contains('us-state-label-ext')) {
      lbl.style.fill = bi >= 4 ? '#ffffff' : '';
    }
  });

  if (legendEl) buildChoroplethLegend(legendEl, breaks);
}

async function bindUSStateMapSelection() {
  const svg = document.getElementById('usStateMapSvg');
  const stateSelectEl = document.getElementById('usPlugsStateSelect');
  if (!svg || !stateSelectEl) return;

  if (typeof US_STATE_PATHS === 'undefined') {
    console.error('US state geo not loaded: US_STATE_PATHS is undefined. Check js/us-states-geo.js (404?).');
    return;
  }

  const SVGNS = 'http://www.w3.org/2000/svg';

  // react-usa-map geographic paths are drawn on a 959 x 593 canvas.
  // The right edge is padded to 995 so external labels for the tiny
  // north-eastern states have room to sit in the margin.
  svg.setAttribute('viewBox', '0 0 995 593');

  const group = svg.querySelector('#usStateHotspots') || svg;
  group.innerHTML = '';

  const labelLayer = document.createElementNS(SVGNS, 'g');
  const shapes = {}; // code -> path element
  const labels = {}; // code -> text element

  // 1) Draw every state as its real geographic shape.
  Object.keys(US_STATE_PATHS).forEach(code => {
    const path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('d', US_STATE_PATHS[code]);
    path.setAttribute('data-state', code);
    path.setAttribute('class', 'us-state-path');
    const title = document.createElementNS(SVGNS, 'title');
    title.textContent = US_STATES[code] || code;
    path.appendChild(title);
    group.appendChild(path);
    shapes[code] = path;
  });

  // 2) Label each state with its abbreviation.
  //    Large states get a centered label; tiny states (NE corner) are
  //    deferred and given an external label with a leader line so their
  //    two letters stay readable instead of overflowing the shape.
  const smalls = [];
  Object.keys(shapes).forEach(code => {
    const bb = shapes[code].getBBox();
    const cx = bb.x + bb.width / 2;
    const cy = bb.y + bb.height / 2;

    if (bb.width < 22 || bb.height < 16) {
      smalls.push({ code, cx, cy });
      return;
    }

    const fs = Math.max(8, Math.min(15, Math.min(bb.width, bb.height) * 0.42));
    const text = document.createElementNS(SVGNS, 'text');
    text.setAttribute('x', cx.toFixed(1));
    text.setAttribute('y', cy.toFixed(1));
    text.setAttribute('class', 'us-state-label');
    text.setAttribute('font-size', fs.toFixed(1));
    text.textContent = code;
    labelLayer.appendChild(text);
    labels[code] = text;
  });

  // External labels for small states, stacked down the right margin.
  smalls.sort((a, b) => a.cy - b.cy);
  const labelX = 958;
  let prevY = -Infinity;
  smalls.forEach(({ code, cx, cy }) => {
    const ly = Math.max(cy, prevY + 17);
    prevY = ly;

    const line = document.createElementNS(SVGNS, 'line');
    line.setAttribute('x1', cx.toFixed(1));
    line.setAttribute('y1', cy.toFixed(1));
    line.setAttribute('x2', labelX - 20);
    line.setAttribute('y2', ly.toFixed(1));
    line.setAttribute('class', 'us-state-leader');
    labelLayer.appendChild(line);

    const text = document.createElementNS(SVGNS, 'text');
    text.setAttribute('x', labelX);
    text.setAttribute('y', ly.toFixed(1));
    text.setAttribute('class', 'us-state-label us-state-label-ext');
    text.setAttribute('font-size', '12');
    text.textContent = code;
    labelLayer.appendChild(text);
    labels[code] = text;
  });

  group.appendChild(labelLayer);

  const selectedLabelEl = document.getElementById('usMapSelectedLabel');

  const highlight = (stateCodes) => {
    const selectedCodes = new Set(Array.isArray(stateCodes) ? stateCodes : [stateCodes].filter(Boolean));
    Object.entries(shapes).forEach(([code, path]) => {
      path.classList.toggle('is-selected', selectedCodes.has(code));
    });
    Object.entries(labels).forEach(([code, text]) => {
      text.classList.toggle('is-selected', selectedCodes.has(code));
    });
    if (selectedLabelEl) {
      const selected = Array.from(selectedCodes).filter(code => US_STATES[code]);
      selectedLabelEl.textContent = selectedCodes.has('ALL') || !selected.length
        ? 'All'
        : selected.map(code => US_STATES[code] || code).join(', ');
    }
  };

  // Pick a state — update dropdown + re-render charts immediately.
  const onPick = (code) => {
    if (!US_STATES[code]) return;
    const current = getSelectedUSStateCodes();
    let next = current.includes('ALL') ? [] : current.slice();

    if (next.includes(code)) {
      next = next.filter(item => item !== code);
    } else if (next.length < MAX_US_COMPARE_STATES) {
      next.push(code);
    } else {
      const hintEl = document.getElementById('usCompareHint');
      if (hintEl) hintEl.textContent = 'Only four states can be compared at once.';
      return;
    }

    setUSStateSelection(next.length ? next : ['ALL']);
    highlight(getSelectedUSStateCodes());
    const yearVal = document.getElementById('usPlugsYearSelect')?.value;
    if (yearVal) {
      startGlobalLoad('Loading state plugs charts…');
      Promise.resolve(renderUSPlugsCharts()).finally(finishGlobalLoad);
    }
  };

  Object.entries(shapes).forEach(([code, path]) => {
    path.addEventListener('click', () => onPick(code));
  });
  // Only external labels need their own click target (they float in the margin).
  smalls.forEach(({ code }) => {
    labels[code]?.addEventListener('click', () => onPick(code));
  });

  // Keep the map in sync when the dropdown changes elsewhere.
  stateSelectEl.addEventListener('change', () => highlight(enforceUSCompareLimit()));
  stateSelectEl.addEventListener('us-state-selection-updated', (evt) => highlight(evt.detail?.states || getSelectedUSStateCodes()));

  // Initial highlight
  highlight(getSelectedUSStateCodes());

  // Color the map by total stations per state (darker blue = more) + draw the
  // legend. Fire-and-forget so the map stays clickable even while data loads.
  const legendEl = document.getElementById('usMapLegend');
  colorStatesByStationCount(shapes, labels, legendEl)
    .catch(err => console.warn('US map choropleth coloring failed:', err));
}

async function initUSPlugsAnalysisPage() {
  // Only run if required elements exist
  const stateSelectEl = document.getElementById('usPlugsStateSelect');
  const yearSelectEl  = document.getElementById('usPlugsYearSelect');
  if (!stateSelectEl || !yearSelectEl) return;

  // Initialize overlay counter if present on this page
  const overlayEl = document.getElementById('globalLoadingOverlay');
  if (overlayEl) {
    globalLoadingOverlayEl = overlayEl;
  }

  // 1) Build the state selector + clickable map FIRST. Neither depends on
  //    Back4App, so the map selector stays interactive even while (or if) the
  //    data layer is slow or unavailable.
  populateUSPlugsStateOptions();
  await bindUSStateMapSelection();

  // Wire selection handlers now so picking a state always re-renders charts.
  const applyBtn = document.getElementById('usPlugsApplyBtn');
  const resetBtn = document.getElementById('usPlugsResetBtn');
  const schedule = () => {
    enforceUSCompareLimit();
    startGlobalLoad('Loading state plugs charts…');
    Promise.resolve(renderUSPlugsCharts()).finally(finishGlobalLoad);
  };
  if (applyBtn) applyBtn.addEventListener('click', schedule);
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      setUSStateSelection(['ALL']);
      populateUSPlugsYearDropdown('ALL').then(() => {
        startGlobalLoad('Loading state plugs charts…');
        Promise.resolve(renderUSPlugsCharts()).finally(finishGlobalLoad);
      });
    });
  }
  stateSelectEl.addEventListener('change', schedule);
  yearSelectEl.addEventListener('change', schedule);

  // 2) Load the year list + initial charts as soon as the SDK is available.
  // Parse.Query is enough for these read-only summary tables; waiting for
  // installation metadata can add a 12s stall on this page.
  if (typeof Parse === 'undefined' || !Parse || !Parse.Query) {
    console.error('Parse SDK not ready on US plugs page.');
    return;
  }

  // Populate year + render charts immediately. The default "All" option shows national totals.
  const selectedStates = getSelectedUSStateCodes();
  const yearScope = selectedStates.length === 1 ? selectedStates[0] : 'ALL';
  if (yearScope && (yearScope === 'ALL' || US_STATES[yearScope])) {
    await populateUSPlugsYearDropdown(yearScope);

    const year = yearSelectEl.value;
    if (year) {
      startGlobalLoad('Loading state plugs charts…');
      Promise.all([
        renderUSPlugsCharts(),
        renderTop10StatesByStationsLatest()
      ]).finally(finishGlobalLoad);
    }
  }
}

function bindMonthlyStateChartDropdownHandlers() {
  const yearSelectEl = document.getElementById('monthlyStateYearSelect');
  const stateSelectEl = document.getElementById('monthlyStateAddSelect');
  if (!yearSelectEl || !stateSelectEl) return;

  let renderTimer = null;
  const scheduleRender = () => {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderMonthlyStateCharts(stateSelectEl.value, yearSelectEl.value);
    }, 200);
  };

  yearSelectEl.addEventListener('change', scheduleRender);
  stateSelectEl.addEventListener('change', scheduleRender);
}

/* -------------------------------------------------------
   INITIALIZATION — lazy load on scroll
------------------------------------------------------- */
let globalLoadingOverlayEl = document.getElementById('globalLoadingOverlay');
let globalLoadingPending = 0;

function showGlobalLoading() {
  if (!globalLoadingOverlayEl) return;
  globalLoadingOverlayEl.style.display = 'flex';
}

function hideGlobalLoading() {
  if (!globalLoadingOverlayEl) return;
  if (globalLoadingPending <= 0) globalLoadingOverlayEl.style.display = 'none';
}

function startGlobalLoad(taskLabel) {
  globalLoadingPending += 1;
  showGlobalLoading();
  // Optionally update text
  const t = globalLoadingOverlayEl?.querySelector('.global-loading-text');
  if (t && taskLabel) t.textContent = taskLabel;
}

function finishGlobalLoad() {
  globalLoadingPending = Math.max(0, globalLoadingPending - 1);
  hideGlobalLoading();
}

document.addEventListener('DOMContentLoaded', () => {
  // If we're on the dedicated US plugs analysis page, run its initializer and exit early.
  // US page does NOT require Mapbox; avoid any Mapbox-related runtime errors.
  if (document.getElementById('us-plugs-analytics') && document.getElementById('usPlugsStateSelect')) {
    if (typeof mapboxgl === 'undefined') {
      // eslint-disable-next-line no-console
      console.warn('Mapbox not loaded; skipping Mapbox setup on US plugs analysis page.');
    }
    initUSPlugsAnalysisPage();
    return;
  }

  const analyticsSection = document.getElementById('analytics');
  const caSection        = document.getElementById('california-analytics');
  const txSection        = document.getElementById('texas-analytics');

  const heroNetWrap      = document.getElementById('heroNetworkChartWrap');
  const heroStatRow      = document.getElementById('heroStatRow');

  let usLoaded = false;
  let caLoaded = false;
  let txLoaded = false;
  let heroNetLoaded = false;

  const safeRun = (taskLabel, fn) => {
    startGlobalLoad(taskLabel);
    try {
      return Promise.resolve(fn())
        .catch(err => {
          console.error(taskLabel, err);
        })
        .finally(() => {
          finishGlobalLoad();
        });
    } catch (err) {
      console.error(taskLabel, err);
      finishGlobalLoad();
      return Promise.resolve();
    }
  };

  const loadUSCharts = () => {
    if (usLoaded) return;
    usLoaded = true;

    safeRun('Loading US station metrics…', () => loadUSStateAnalysis());
    safeRun('Loading top states…', () => renderTop10StatesByStationsLatest());
    safeRun('Loading monthly USA totals…', () => loadMonthlyUSATotal());
    safeRun('Loading monthly USA plug growth…', () => loadMonthlyUSPlugsGrowthAndTotal());
    safeRun('Loading monthly USA station additions…', () => loadMonthlyUSAdded());
  };

  const loadCACharts = () => {
    if (caLoaded) return;
    caLoaded = true;
    safeRun('Loading California…', () => loadCaliforniaAnalysis());
  };

  const loadTXCharts = () => {
    if (txLoaded) return;
    txLoaded = true;
    safeRun('Loading Texas…', () => loadTexasAnalysis());
  };

  const loadHeroNet = () => {
    if (heroNetLoaded) return;
    heroNetLoaded = true;
    safeRun('Loading network summary…', () => renderHeroNetworkChart());
  };

  // Fallback: some DOM/layout changes can prevent IntersectionObserver triggers.
  // Ensure charts still load rapidly by firing once on DOMContentLoaded.
  // This keeps previous lazy-loading behavior, but guarantees correctness.
  const triggerInitialLoads = () => {
    // Critical-path fix: detect by actual page canvases/wraps, not by section ids
    // (prevents regressions where section markup changes stop loaders from running).
    const hasUS =
      document.getElementById('topStatesStationsWrap') ||
      document.getElementById('monthlyChartWrap') ||
      document.getElementById('monthlyStatePlugsGrowthWrap') ||
      document.getElementById('monthlyAddedChartWrap') ||
      document.getElementById('monthlyStateStationsWrap');

    const hasCA =
      document.getElementById('heroCountyChartWrap') ||
      document.getElementById('caPlugsMonthlyChartWrap') ||
      document.getElementById('caStationsMonthlyChartWrap') ||
      document.getElementById('caCountyColorMapWrap') ||
      document.getElementById('caCountyPlugsGrowthWrap') ||
      document.getElementById('caCountyPlugsCumulativeWrap') ||
      document.getElementById('caCountyStationsGrowthWrap') ||
      document.getElementById('caCountyStationsCumulativeWrap');

    const hasTX =
      document.getElementById('heroCountyChartWrap') ||
      document.getElementById('txPlugsMonthlyChartWrap') ||
      document.getElementById('txStationsMonthlyChartWrap');

    const hasHeroNet = !!heroNetWrap || !!document.getElementById('heroNetworkChart');

    if (hasUS) loadUSCharts();
    if (hasCA) loadCACharts();
    if (hasTX) loadTXCharts();
    if (hasHeroNet) loadHeroNet();
  };

  triggerInitialLoads();

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;

      if ((entry.target === analyticsSection || entry.target === heroStatRow) && !usLoaded) {
        loadUSCharts();
      }

      if (entry.target === caSection && !caLoaded) {
        loadCACharts();
      }

      if (entry.target === txSection && !txLoaded) {
        loadTXCharts();
      }

      if (entry.target === heroNetWrap && !heroNetLoaded) {
        loadHeroNet();
      }
    });
  }, { threshold: 0.08 });

  if (analyticsSection) observer.observe(analyticsSection);
  if (caSection)        observer.observe(caSection);
  if (txSection)        observer.observe(txSection);
  if (heroNetWrap)      observer.observe(heroNetWrap);
  if (heroStatRow)      observer.observe(heroStatRow);
});
