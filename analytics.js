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
let stateChartInst    = null;
let monthlyChartInst  = null;
let networkChartInst  = null;
let caCityChartInst   = null;
let caMonthlyChartInst = null;

/* Cached raw data */
let cachedUSData = null;
let cachedCAData = null;

/* -------------------------------------------------------
   HELPERS
------------------------------------------------------- */
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
async function fetchUSStatsFromSummaries(latestYearMonth = '2026_06') {
  // Uses pre-aggregated Back4App summary classes.
  // Returns: { totalUSStations, totalNetworks, totalStatesWithStations }
  const out = { totalUSStations: 0, totalNetworks: 0, totalStatesWithStations: 0 };

  // States + total
  const stateQuery = new Parse.Query('State_Summary');
  stateQuery.equalTo('Year_Month', latestYearMonth);
  stateQuery.select(['state', 'total_dc_fast_plugs']);
  stateQuery.limit(5000);

  const stateRows = await stateQuery.find();
  const valsByState = {};
  stateRows.forEach(r => {
    const st = r.get('state');
    if (!st) return;
    valsByState[st] = Number(r.get('total_dc_fast_plugs') || 0);
  });

  out.totalStatesWithStations = Object.keys(valsByState).length;
  out.totalUSStations = Object.values(valsByState).reduce((s, n) => s + (Number(n) || 0), 0);

  // Networks
  const netQuery = new Parse.Query('EV_Network_Summary');
  netQuery.equalTo('Year_Month', latestYearMonth);
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

async function loadUSStateAnalysis() {
  showLoader('stateChartWrap', 'Fetching station data…');

  try {
    const results = await fetchRecords(['STATE', 'OPEN_DATE', 'EV_NETWORK']);
    cachedUSData  = results || [];

    /* Aggregate */
    const stateCounts   = {};
    const networkSet    = new Set();

    cachedUSData.forEach(r => {
      const state   = r.get('STATE');
      const network = (r.get('EV_NETWORK') || '').trim();
      if (state)   stateCounts[state] = (stateCounts[state] || 0) + 1;
      if (network) networkSet.add(network);
    });

    const statesWithDataCount = Object.keys(stateCounts).length;

    // Stat cards (prefer raw rows)
    setStatVal(
      'totalUSStations',
      (cachedUSData && cachedUSData.length ? cachedUSData.length : 0).toLocaleString()
    );
    setStatVal('totalNetworks', networkSet.size);
    setStatVal('totalStatesWithStations', statesWithDataCount);

    // If Fast_Charging_Stations is ACL-blocked, totals above will be 0.
    // In that case, compute totals from the summary classes.
    if (!cachedUSData.length && statesWithDataCount === 0) {
      try {
        const stats = await fetchUSStatsFromSummaries('2026_06');
        setStatVal('totalUSStations', (stats.totalUSStations || 0).toLocaleString());
        setStatVal('totalNetworks', (stats.totalNetworks || 0).toLocaleString());
        setStatVal('totalStatesWithStations', (stats.totalStatesWithStations || 0).toLocaleString());
      } catch (e) {
        // keep the zeroes; chart section will show user-friendly placeholder elsewhere
      }
    }

    // Always try State_Summary first for the Top 20 chart.
    // Fast_Charging_Stations can be blocked by ACL; we must not hard-fail.
    let latest06Top20 = [];
    try {
      const stationQuery = new Parse.Query('State_Summary');
      stationQuery.equalTo('Year_Month', '2026_06');
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

      // If State_Summary has no rows for 2026_06, fallback to Fast_Charging_Stations aggregation.
      if (!latest06Top20.length && statesWithDataCount > 0) {
        latest06Top20 = Object.entries(stateCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20);
      }
    } catch (err) {
      console.warn('State_Summary latest 2026_06 fetch failed:', err);

      // Fallback only if we actually aggregated something from Fast_Charging_Stations
      if (statesWithDataCount > 0) {
        latest06Top20 = Object.entries(stateCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20);
      } else {
        latest06Top20 = [];
      }
    }

    // If we still have no data after fallbacks, show a placeholder instead of creating an empty chart
    if (!latest06Top20.length) {
      showLoader(
        'stateChartWrap',
        'No “Stations by State (Top 20)” data available (ACL permission denied or missing 2026_06 records).'
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
          label: 'EV DC Fast Plugs (Jun 2026)',
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

    /* Populate state dropdown for monthly chart (state add-select)
       Use static US_STATES so the dropdown isn't empty even if Back4App fetch fails. */
    const sel = document.getElementById('monthlyStateAddSelect');
    if (sel) {
      sel.innerHTML = `<option value="">— Choose a State —</option>`;
      Object.keys(US_STATES).sort().forEach(code => {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = US_STATES[code] || code;
        sel.appendChild(opt);
      });
    }

    /* Network distribution */
    renderNetworkChart(results);

  } catch (err) {
    const msg = (err && err.message) ? err.message : 'Failed to load data.';
    // If the failure is due to Back4App ACL, show a clearer hint
    const friendly =
      /permission denied/i.test(String(msg)) || /acl/i.test(String(msg)) ? 
        'Back4App permissions denied for required classes. Ask your admin to grant read access.' :
        msg;

    showLoader('stateChartWrap', friendly);
    console.error('US state analysis error:', err);
  }
}

/* -------------------------------------------------------
   MONTHLY STATE TREND (MULTI-STATE COMPARISON)
------------------------------------------------------- */
let monthlySelectedCodes = []; // up to 5 selected state codes for the monthly combo chart

function renderMonthlySelectedStates() {
  const wrap = document.getElementById('monthlySelectedStates');
  if (!wrap) return;

  if (!monthlySelectedCodes.length) {
    wrap.innerHTML = `<span style="color:rgba(0,0,0,0.55); font-size:12px;">No states selected.</span>`;
    return;
  }

  wrap.innerHTML = monthlySelectedCodes.map(code => {
    const name = US_STATES[code] || code;
    return `
      <span class="monthly-selected-pill" style="display:inline-flex; align-items:center; gap:8px; padding:6px 10px; margin:6px 6px 0 0; background:rgba(47,111,110,0.08); border:1px solid rgba(47,111,110,0.25); border-radius:999px; font-size:12px;">
        <span>${name}</span>
        <button
          type="button"
          class="monthly-pill-remove"
          data-statecode="${code}"
          aria-label="Remove ${name}"
          style="border:none; background:transparent; cursor:pointer; font-size:14px; line-height:1; padding:0 2px;">
          ×
        </button>
      </span>
    `;
  }).join('');
}

function updateMonthlySelectedAndChart() {
  renderMonthlySelectedStates();
  loadMonthlyForStates(monthlySelectedCodes);
}

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

function getMonthsLabelsFromYearMonths(yearMonths) {
  // yearMonths should already be sorted ascending
  return yearMonths.map(formatYearMonth);
}

async function fetchStateSummarySeries(stateCode) {
  const query = new Parse.Query('State_Summary');
  query.equalTo('state', stateCode);
  query.select(['state', 'Year_Month', 'total_dc_fast_plugs']);
  query.ascending('Year_Month');
  query.limit(2000);

  const results = await query.find();
  const map = {};
  results.forEach(r => {
    const ym = r.get('Year_Month');
    const val = r.get('total_dc_fast_plugs');
    if (ym) map[ym] = typeof val === 'number' ? val : Number(val || 0);
  });

  // Return both the sorted keys and the per-month mapping
  const sortedYMs = Object.keys(map).sort((a, b) => String(a).localeCompare(String(b)));
  return { yearMonths: sortedYMs, valuesByYearMonth: map };
}

async function loadMonthlyForStates(stateCodes) {
  const uniqueCodes = Array.from(new Set(stateCodes || [])).filter(Boolean);
  const wrapId = 'monthlyChartWrap';

  if (!uniqueCodes.length) {
    showLoader(wrapId, 'Select state(s) to load monthly data…');
    if (monthlyChartInst) { monthlyChartInst.destroy(); monthlyChartInst = null; }
    return;
  }

  showLoader(wrapId, 'Fetching monthly state summary…');

  try {
    // Fetch series for each state in parallel
    const seriesArr = await Promise.all(uniqueCodes.map(code => fetchStateSummarySeries(code)));

    // Determine canonical month set from first state series (or union fallback)
    let yearMonths = seriesArr[0]?.yearMonths || [];

    if (!yearMonths.length) {
      // Union fallback if first state has no data
      const union = new Set();
      seriesArr.forEach(s => (s.yearMonths || []).forEach(ym => union.add(ym)));
      yearMonths = Array.from(union).sort((a, b) => String(a).localeCompare(String(b)));
    }

    const labels = getMonthsLabelsFromYearMonths(yearMonths);

    hideLoader(wrapId);

    const ctx = document.getElementById('monthlyChart');
    if (monthlyChartInst) monthlyChartInst.destroy();

    const datasets = uniqueCodes.slice(0, 5).map((stateCode, i) => {
      const stateName = US_STATES[stateCode] || stateCode;

      const idx = uniqueCodes.indexOf(stateCode);
      const series = seriesArr[idx];

      const valuesByYearMonth = series?.valuesByYearMonth || {};
      const data = yearMonths.map(ym => Number(valuesByYearMonth[ym] ?? 0));

      const color = CHART_COLORS[i % CHART_COLORS.length];

      return {
        label: `${stateName} — Cumulative EV Fast Chargers`,
        data,
        borderColor: color,
        backgroundColor: `${color}55`, // less see-through fill
        borderWidth: 2.5,
        pointRadius: 3.5,
        pointBackgroundColor: color,
        fill: true,
        tension: 0.3
      };
    });

    monthlyChartInst = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { font: { family: 'Space Grotesk' } } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y.toLocaleString()} stations` } }
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
      (err && err.message) ? `Failed to load monthly data: ${err.message}` : 'Failed to load monthly data. Please refresh.';
    showLoader(wrapId, msg);
    console.error('Monthly state summary error:', err);
  }
}

/* -------------------------------------------------------
   NETWORK DISTRIBUTION
------------------------------------------------------- */
async function renderNetworkChart() {
  showLoader('networkChartWrap', 'Fetching network summary…');

  try {
    const query = new Parse.Query('EV_Network_Summary');
    query.equalTo('Year_Month', '2026_06');
    query.select(['ev_network', 'total_dc_fast_plugs']);
    query.limit(5000);

    const rows = await query.find();

    const networkCounts = {};
    rows.forEach(r => {
      const n = (r.get('ev_network') || '').trim() || 'Unknown';
      const v = Number(r.get('total_dc_fast_plugs') || 0);
      networkCounts[n] = (networkCounts[n] || 0) + v;
    });

    const sorted = Object.entries(networkCounts).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) {
      showLoader(
        'networkChartWrap',
        'No EV network summary data available for 2026_06 (ACL permission denied or empty dataset).'
      );
      return;
    }

    const top    = sorted.slice(0, 10);
    const other  = sorted.slice(10).reduce((s, [, c]) => s + c, 0);
    if (other > 0) top.push(['Other', other]);

    const total  = top.reduce((s, [, c]) => s + c, 0);
    const labels = top.map(([n]) => n);
    const values = top.map(([, c]) => c);

    hideLoader('networkChartWrap');

    const ctx = document.getElementById('networkChart');
    if (networkChartInst) networkChartInst.destroy();
    networkChartInst = new Chart(ctx, {
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
              label: ctx => {
                const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0.0';
                return ` ${ctx.parsed.toLocaleString()} stations (${pct}%)`;
              }
            }
          }
        }
      }
    });

    /* Custom legend */
    const legend = document.getElementById('networkLegend');
    if (legend) {
      legend.innerHTML = top.map(([name, count], i) => {
        const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
        return `<div class="legend-item">
        <span class="legend-dot" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></span>
        <span class="legend-name">${name}</span>
        <span class="legend-count">${count.toLocaleString()} <small>(${pct}%)</small></span>
      </div>`;
      }).join('');
    }
  } catch (err) {
    const msg = /permission denied|acl/i.test(String(err)) ?
      'Back4App permissions denied for EV_Network_Summary. Ask your admin to grant read access.' :
      'Failed to load EV network summary.';
    showLoader('networkChartWrap', msg);
    console.error('Network summary error:', err);
  }
}

/* -------------------------------------------------------
   CALIFORNIA ANALYSIS
------------------------------------------------------- */
async function loadCaliforniaAnalysis() {
  showLoader('caCityChartWrap',    'Fetching California station data…');
  showLoader('caMonthlyChartWrap', 'Fetching California monthly data…');

  try {
    const results = await fetchRecords(['CITY', 'EV_NETWORK', 'OPEN_DATE'], 'STATE', 'CA');
    cachedCAData  = results;

    const cityCounts    = {};
    const networkCounts = {};

    results.forEach(r => {
      const city    = (r.get('CITY')       || '').trim();
      const network = (r.get('EV_NETWORK') || '').trim();
      if (city)    cityCounts[city]       = (cityCounts[city]       || 0) + 1;
      if (network) networkCounts[network] = (networkCounts[network] || 0) + 1;
    });

    /* Stat cards */
    const topNetwork = Object.entries(networkCounts).sort((a, b) => b[1] - a[1])[0];
    setStatVal('totalCAStations', results.length.toLocaleString());
    setStatVal('totalCACities',   Object.keys(cityCounts).length);
    setStatVal('topCANetwork',    topNetwork ? topNetwork[0] : '—');

    /* Top 20 CA cities */
    const topCities = Object.entries(cityCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    hideLoader('caCityChartWrap');

    const cityCtx = document.getElementById('caCityChart');
    if (caCityChartInst) caCityChartInst.destroy();
    caCityChartInst = new Chart(cityCtx, {
      type: 'bar',
      data: {
        labels: topCities.map(([city]) => city),
        datasets: [{
          label: 'EV Fast Charging Stations',
          data:   topCities.map(([, cnt]) => cnt),
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
          tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x.toLocaleString()} stations` } }
        },
        scales: {
          x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Space Grotesk' } } },
          y: { grid: { display: false },             ticks: { font: { family: 'Space Grotesk', size: 12 } } }
        }
      }
    });

    /* CA monthly network growth */
    renderCAMonthlyChart(results, networkCounts);

  } catch (err) {
    showLoader('caCityChartWrap',    'Failed to load California data.');
    showLoader('caMonthlyChartWrap', 'Failed to load California data.');
    console.error('CA analysis error:', err);
  }
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
      label:           network,
      data:            finalData,
      borderColor:     CHART_COLORS[i % CHART_COLORS.length],
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
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString()} stations`
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

/* -------------------------------------------------------
   INITIALIZATION — lazy load on scroll
------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  const monthlyAddSelect = document.getElementById('monthlyStateAddSelect');
  const monthlyAddBtn    = document.getElementById('monthlyStateAddBtn');
  const monthlyClearBtn  = document.getElementById('monthlyStatesClearBtn');

  renderMonthlySelectedStates();

  const addStateFromUI = () => {
    if (!monthlyAddSelect) return;
    const code = monthlyAddSelect.value;
    if (!code) return;

    if (monthlySelectedCodes.includes(code)) {
      // prevent duplicates
      monthlyAddSelect.value = '';
      return;
    }

    if (monthlySelectedCodes.length >= 5) {
      alert('Please select up to 5 states for comparison.');
      monthlyAddSelect.value = '';
      return;
    }

    monthlySelectedCodes.push(code);
    monthlyAddSelect.value = '';

    updateMonthlySelectedAndChart();
  };

  if (monthlyAddBtn) {
    monthlyAddBtn.addEventListener('click', addStateFromUI);
  }
  if (monthlyAddSelect) {
    monthlyAddSelect.addEventListener('change', () => {
      // auto-add on selection for clarity
      addStateFromUI();
    });
  }

  // Delegate remove buttons (rendered dynamically)
  const selectedWrap = document.getElementById('monthlySelectedStates');
  if (selectedWrap) {
    selectedWrap.addEventListener('click', (e) => {
      const btn = e.target.closest('.monthly-pill-remove');
      if (!btn) return;

      const code = btn.getAttribute('data-statecode');
      if (!code) return;

      monthlySelectedCodes = monthlySelectedCodes.filter(c => c !== code);
      updateMonthlySelectedAndChart();
    });
  }

  if (monthlyClearBtn) {
    monthlyClearBtn.addEventListener('click', () => {
      monthlySelectedCodes = [];
      renderMonthlySelectedStates();

      if (monthlyChartInst) { monthlyChartInst.destroy(); monthlyChartInst = null; }
      showLoader('monthlyChartWrap', 'Select state(s) to load monthly data…');
    });
  }

  const analyticsSection = document.getElementById('analytics');
  const caSection        = document.getElementById('california-analytics');

  let usLoaded = false;
  let caLoaded = false;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      if (entry.target === analyticsSection && !usLoaded) {
        usLoaded = true;
        loadUSStateAnalysis();
      }
      if (entry.target === caSection && !caLoaded) {
        caLoaded = true;
        loadCaliforniaAnalysis();
      }
    });
  }, { threshold: 0.08 });

  if (analyticsSection) observer.observe(analyticsSection);
  if (caSection)        observer.observe(caSection);
});
