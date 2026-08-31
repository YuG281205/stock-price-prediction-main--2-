/*
  predict-widget.js  (v4 — hover preview + click for full detail)
  -------------------------------------------------------------------
  Two ways to see a prediction:
    1. HOVER a row  -> small tooltip near the cursor with quick stats
       (Signal, Predicted Close, Predicted Chg%, Target, Stop-Loss).
       Cached per symbol so hovering the same stock twice is instant
       and doesn't re-fetch.
    2. CLICK a row   -> opens the full panel below the table with
       Short/Medium/Long term tabs, charts, and the full stat grid.

  Requires index.html to already include:
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="predict-widget.js"></script>
    <div id="hoverTooltip" class="hover-tooltip"></div>

  All CSS (.predict-panel, .chart-box, .hover-tooltip, etc.) lives in
  index.html's <style> block already - nothing to add here.
*/

(function () {
  const searchInput = document.getElementById("searchInput");
  const tableBody = document.getElementById("tbody");
  const tooltip = document.getElementById("hoverTooltip");

  const COLOR_UP = "#3fbf7f";
  const COLOR_DOWN = "#ff5c6c";
  const COLOR_ACCENT = "#e0a458";
  const COLOR_GRID = "#232b42";
  const COLOR_TEXT_DIM = "#8993ae";

  const HORIZON_LABELS = {
    short_term: "Short Term (1D)",
    medium_term: "Medium Term (5D)",
    long_term: "Long Term (20D)",
  };

  const panel = document.createElement("div");
  panel.className = "predict-panel";
  panel.id = "predictPanel";
  document.getElementById("errorBanner").insertAdjacentElement("afterend", panel);

  let historyChart = null;
  let compareChart = null;
  let currentData = null;
  let activeHorizon = "short_term";
  let selectedRow = null;

  // ------------------------------------------------------------------
  // Shared fetch + cache (both hover tooltip and click panel use this)
  // ------------------------------------------------------------------
  const predictionCache = new Map();   // symbol -> response data
  const inFlight = new Map();          // symbol -> Promise, avoids duplicate fetches

  function fetchPrediction(symbol) {
    if (predictionCache.has(symbol)) {
      return Promise.resolve(predictionCache.get(symbol));
    }
    if (inFlight.has(symbol)) {
      return inFlight.get(symbol);
    }
    const p = fetch(`/api/predict/${encodeURIComponent(symbol)}`)
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(err.detail || "unknown error");
        }
        return res.json();
      })
      .then((data) => {
        predictionCache.set(symbol, data);
        inFlight.delete(symbol);
        return data;
      })
      .catch((e) => {
        inFlight.delete(symbol);
        throw e;
      });
    inFlight.set(symbol, p);
    return p;
  }

  // ------------------------------------------------------------------
  // HOVER TOOLTIP — quick preview near the cursor
  // ------------------------------------------------------------------
  let hoverTimer = null;
  let hoverSymbol = null;
  const HOVER_DELAY_MS = 350; // dwell time before firing a request

  function positionTooltip(x, y) {
    const pad = 16;
    const vw = window.innerWidth, vh = window.innerHeight;
    const rect = tooltip.getBoundingClientRect();
    let left = x + pad;
    let top = y + pad;
    if (left + rect.width > vw) left = x - rect.width - pad;
    if (top + rect.height > vh) top = y - rect.height - pad;
    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
  }

  function renderTooltipLoading(symbol, x, y) {
    tooltip.innerHTML = `<div class="ht-title">${symbol}</div><div class="ht-row">Loading prediction&hellip;</div>`;
    tooltip.classList.add("show");
    positionTooltip(x, y);
  }

  function renderTooltipError(symbol, x, y, msg) {
    tooltip.innerHTML = `<div class="ht-title">${symbol}</div><div class="ht-row">Unavailable: ${msg}</div>`;
    tooltip.classList.add("show");
    positionTooltip(x, y);
  }

  function renderTooltipData(data, x, y) {
    const h = data.horizons.short_term;
    const dirClass = h.predicted_change_pct >= 0 ? "up" : "down";
    const sign = h.predicted_change_pct >= 0 ? "+" : "";
    tooltip.innerHTML = `
      <div class="ht-title">${data.symbol} &middot; next session</div>
      <div class="ht-row"><span>Signal</span><span class="ht-val signal-${h.signal.toLowerCase()}">${h.signal}</span></div>
      <div class="ht-row"><span>Last Close</span><span class="ht-val">${data.last_close}</span></div>
      <div class="ht-row"><span>Predicted</span><span class="ht-val ${dirClass}" style="color:${dirClass === "up" ? COLOR_UP : COLOR_DOWN}">${h.predicted_close} (${sign}${h.predicted_change_pct}%)</span></div>
      <div class="ht-row"><span>Target</span><span class="ht-val">${h.target_price ?? "&mdash;"}</span></div>
      <div class="ht-row"><span>Stop-Loss</span><span class="ht-val">${h.stop_loss ?? "&mdash;"}</span></div>
      <div class="ht-hint">Click row for full detail + chart</div>
    `;
    tooltip.classList.add("show");
    positionTooltip(x, y);
  }

  function hideTooltip() {
    tooltip.classList.remove("show");
    hoverSymbol = null;
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
  }

  tableBody.addEventListener("mousemove", (e) => {
    const row = e.target.closest("tr");
    if (!row) { hideTooltip(); return; }
    const symEl = row.querySelector(".sym");
    if (!symEl) { hideTooltip(); return; }
    const symbol = symEl.textContent.trim();
    if (!symbol || symbol === "-") { hideTooltip(); return; }

    if (symbol !== hoverSymbol) {
      // moved to a new row - reset the dwell timer
      hideTooltip();
      hoverSymbol = symbol;
      hoverTimer = setTimeout(() => {
        if (predictionCache.has(symbol)) {
          renderTooltipData(predictionCache.get(symbol), e.clientX, e.clientY);
        } else {
          renderTooltipLoading(symbol, e.clientX, e.clientY);
          fetchPrediction(symbol)
            .then((data) => {
              if (hoverSymbol === symbol) renderTooltipData(data, e.clientX, e.clientY);
            })
            .catch((err) => {
              if (hoverSymbol === symbol) renderTooltipError(symbol, e.clientX, e.clientY, err.message);
            });
        }
      }, HOVER_DELAY_MS);
    } else if (tooltip.classList.contains("show")) {
      // same row, tooltip already visible - just follow the cursor
      positionTooltip(e.clientX, e.clientY);
    }
  });

  tableBody.addEventListener("mouseleave", hideTooltip);

  // ------------------------------------------------------------------
  // CLICK PANEL — full detail with tabs + charts (unchanged behavior,
  // now reuses the shared cache so it's instant if you already hovered)
  // ------------------------------------------------------------------
  function renderLoading(symbol) {
    panel.classList.add("show");
    panel.innerHTML = `<div class="predict-loading">Predicting ${symbol}&hellip;</div>`;
  }

  function renderError(symbol, msg) {
    panel.classList.add("show");
    panel.innerHTML = `<div class="predict-loading">Couldn't predict ${symbol}: ${msg}</div>`;
  }

  function destroyCharts() {
    if (historyChart) { historyChart.remove(); historyChart = null; }
    if (compareChart) { compareChart.destroy(); compareChart = null; }
  }

  function renderShell(d) {
    panel.classList.add("show");
    const tabsHtml = Object.keys(HORIZON_LABELS).map(key => `
      <div class="horizon-tab ${key === activeHorizon ? "active" : ""}" data-horizon="${key}">
        ${HORIZON_LABELS[key]}
      </div>
    `).join("");

    panel.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
        <h3 style="margin:0;">${d.symbol} &middot; AI prediction (as of ${d.as_of_date})</h3>
        <button id="closePredictBtn" style="
          background:var(--surface-raised); border:1px solid var(--border); color:var(--text-dim);
          border-radius:5px; padding:5px 11px; font-family:'IBM Plex Mono',monospace;
          font-size:11.5px; cursor:pointer;">
          &times; Close
        </button>
      </div>
      <div class="horizon-tabs">${tabsHtml}</div>
      <div class="predict-charts">
        <div class="chart-box" style="padding:0;">
          <div class="chart-label" style="position:absolute; top:10px; left:10px; z-index:10; pointer-events:none;">Price history + predicted close</div>
          <div id="historyChartContainer" style="width:100%; height:100%;"></div>
        </div>
        <div class="chart-box">
          <div class="chart-label">Current vs predicted</div>
          <div class="chart-legend" id="compareLegend"></div>
          <canvas id="compareChartCanvas"></canvas>
        </div>
      </div>
      <div class="predict-grid" id="predictStatGrid"></div>
      <div class="predict-note" id="predictNote"></div>
    `;

    document.getElementById("closePredictBtn").addEventListener("click", closePanel);

    panel.querySelectorAll(".horizon-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        activeHorizon = tab.dataset.horizon;
        panel.querySelectorAll(".horizon-tab").forEach(t => t.classList.toggle("active", t === tab));
        renderHorizon(currentData);
      });
    });
  }

  function closePanel() {
    destroyCharts();
    panel.classList.remove("show");
    panel.innerHTML = "";
    currentData = null;
    if (selectedRow) {
      selectedRow.classList.remove("row-selected");
      selectedRow = null;
    }
  }

  function renderHorizon(d) {
    const h = d.horizons[activeHorizon];
    const dirUp = h.predicted_change_pct >= 0;
    const dirClass = dirUp ? "up" : "down";
    const dirColor = dirUp ? COLOR_UP : COLOR_DOWN;
    const sign = dirUp ? "+" : "";

    document.getElementById("predictStatGrid").innerHTML = `
      <div class="predict-stat"><div class="label">Signal</div><div class="value signal-${h.signal.toLowerCase()}">${h.signal}</div></div>
      <div class="predict-stat"><div class="label">Last Close</div><div class="value">${d.last_close}</div></div>
      <div class="predict-stat"><div class="label">Predicted Close</div><div class="value ${dirClass}">${h.predicted_close}</div></div>
      <div class="predict-stat"><div class="label">Predicted Chg</div><div class="value ${dirClass}">${sign}${h.predicted_change_pct}%</div></div>
      <div class="predict-stat"><div class="label">Target Price</div><div class="value">${h.target_price ?? "&mdash;"}</div></div>
      <div class="predict-stat"><div class="label">Stop-Loss</div><div class="value">${h.stop_loss ?? "&mdash;"}</div></div>
      <div class="predict-stat"><div class="label">Expected Open</div><div class="value">${d.expected_open}</div></div>
      <div class="predict-stat"><div class="label">95% Range</div><div class="value">${h.expected_range_95.low} &ndash; ${h.expected_range_95.high}</div></div>
      <div class="predict-stat"><div class="label">RSI (14)</div><div class="value">${d.indicators.rsi_14}</div></div>
      <div class="predict-stat"><div class="label">Trend Signal</div><div class="value">${d.indicators.trend_signal}</div></div>
      <div class="predict-stat"><div class="label">10D Volatility</div><div class="value">${d.indicators.volatility_10d_pct}%</div></div>
    `;
    document.getElementById("predictNote").innerHTML = `
      Backtest accuracy for ${HORIZON_LABELS[activeHorizon]} &mdash;
      MAPE: ${h.model_backtest.mape_pct}%, directional accuracy: ${h.model_backtest.directional_accuracy_pct}%.
      Signal is a simple rule (predicted change vs. recent volatility) &mdash; not investment advice.
    `;

    destroyCharts();

    const container = document.getElementById("historyChartContainer");
    historyChart = LightweightCharts.createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: { backgroundColor: 'transparent', textColor: COLOR_TEXT_DIM },
      grid: { vertLines: { color: COLOR_GRID }, horzLines: { color: COLOR_GRID } },
      timeScale: { borderColor: COLOR_GRID, rightOffset: 5 },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
    });

    const candleSeries = historyChart.addCandlestickSeries({
      upColor: COLOR_UP, downColor: COLOR_DOWN, borderVisible: false,
      wickUpColor: COLOR_UP, wickDownColor: COLOR_DOWN
    });
    
    // Map data to lightweight-charts format
    const chartData = d.history.map(x => ({
      time: x.date, open: x.open, high: x.high, low: x.low, close: x.close
    }));
    candleSeries.setData(chartData);

    // Add predicted point as a marker/line
    const lineSeries = historyChart.addLineSeries({
      color: dirColor, lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Dashed, crosshairMarkerVisible: false
    });
    
    // Connect last actual close to predicted close
    const lastPoint = chartData[chartData.length - 1];
    const futureDate = new Date(lastPoint.time);
    futureDate.setDate(futureDate.getDate() + h.horizon_days);
    const futureDateStr = futureDate.toISOString().split('T')[0];

    lineSeries.setData([
      { time: lastPoint.time, value: lastPoint.close },
      { time: futureDateStr, value: h.predicted_close }
    ]);
    
    // Add markers for BUY/SELL
    if (h.signal !== "HOLD") {
      candleSeries.setMarkers([{
        time: futureDateStr,
        position: h.signal === "BUY" ? 'aboveBar' : 'belowBar',
        color: dirColor,
        shape: h.signal === "BUY" ? 'arrowUp' : 'arrowDown',
        text: 'Target: ' + h.predicted_close
      }]);
    }
    
    historyChart.timeScale().fitContent();

    // Handle resize
    new ResizeObserver(entries => {
      if (entries.length === 0 || entries[0].target !== container) return;
      const newRect = entries[0].contentRect;
      historyChart.applyOptions({ height: newRect.height, width: newRect.width });
    }).observe(container);

    const compareCtx = document.getElementById("compareChartCanvas").getContext("2d");
    compareChart = new Chart(compareCtx, {
      type: "bar",
      data: {
        labels: [["\u25CF Current"], [`\u25CF +${h.horizon_days}d`]],
        datasets: [{ data: [d.last_close, h.predicted_close], backgroundColor: [COLOR_ACCENT, dirColor], borderRadius: 4, barPercentage: 0.55 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: {
              color: (ctx) => ctx.index === 0 ? COLOR_ACCENT : dirColor,
              font: { size: 10.5, weight: "600" },
            },
            grid: { display: false },
          },
          y: { ticks: { color: COLOR_TEXT_DIM, font: { size: 9 } }, grid: { color: COLOR_GRID } },
        },
      },
    });
  }

  function renderResult(d) {
    currentData = d;
    activeHorizon = "short_term";
    renderShell(d);
    renderHorizon(d);
  }

  async function runPrediction(symbol) {
    renderLoading(symbol);
    try {
      const data = await fetchPrediction(symbol);
      renderResult(data);
    } catch (e) {
      renderError(symbol, e.message);
    }
  }

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && searchInput.value.trim()) {
      runPrediction(searchInput.value.trim().toUpperCase());
    }
  });

  tableBody.addEventListener("click", (e) => {
    if (e.target.closest(".pin-btn")) return;
    const row = e.target.closest("tr");
    if (!row) return;
    const symEl = row.querySelector(".sym");
    if (!symEl) return;
    const symbol = symEl.textContent.trim();
    if (!symbol || symbol === "-") return;

    hideTooltip();
    if (selectedRow) selectedRow.classList.remove("row-selected");
    row.classList.add("row-selected");
    selectedRow = row;

    runPrediction(symbol);
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
})();