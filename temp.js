
  // ---------------------------------------------------------------
  // Auth Check
  // ---------------------------------------------------------------
  const token = localStorage.getItem('token');
  if (!token) {
      window.location.replace('index.html');
  }
  
  const authSection = document.getElementById('authSection');
  const userName = localStorage.getItem('user_name') || 'Trader';
  authSection.innerHTML = \`<span style="color:var(--text-dim);">Welcome, \${userName}</span> &middot; <a href="#" id="logoutBtn" class="auth-link">Logout</a>\`;
  
  document.getElementById('logoutBtn').addEventListener('click', (e) => {
      e.preventDefault();
      localStorage.removeItem('token');
      localStorage.removeItem('user_name');
      window.location.href = 'index.html';
  });

  // ---------------------------------------------------------------
  // State
  // ---------------------------------------------------------------
  let rows = [];              // latest raw rows from server
  let prevPrices = {};        // symbol -> last lastPrice, for flash-on-change
  let pinned = new Set();     // populated from DB
  let sortKey = "pChange";
  let sortDir = -1;           // -1 desc, 1 asc
  let filterMode = null;      // 'pinned' | 'gainers' | 'losers' | null
  let searchTerm = "";
  let lastUpdatedTs = null;

  const tbody = document.getElementById("tbody");
  const connStatus = document.getElementById("connStatus");
  const pulseDot = document.getElementById("pulseDot");
  const lastUpdatedEl = document.getElementById("lastUpdated");
  const indexNameEl = document.getElementById("indexName");
  const errorBanner = document.getElementById("errorBanner");
  const visibleCountEl = document.getElementById("visibleCount");
  const totalCountEl = document.getElementById("totalCount");

  // ---------------------------------------------------------------
  // Field helpers — tolerant of slightly different NSE field shapes
  // ---------------------------------------------------------------
  function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }
  function getSymbol(r) { return r.symbol || r.Symbol || "-"; }
  function getCompany(r) { return (r.meta && r.meta.companyName) || r.companyName || r.symbol || "-"; }
  function getLTP(r) { return num(r.lastPrice ?? r.ltp ?? r.close); }
  function getChange(r) { return num(r.change); }
  function getPChange(r) { return num(r.pChange ?? r.perChange); }
  function getHigh(r) { return num(r.dayHigh); }
  function getLow(r) { return num(r.dayLow); }
  function getVolume(r) { return num(r.totalTradedVolume ?? r.tradedQuantity); }

  function fmtNum(v, digits = 2) {
    if (v === null || v === undefined) return "-";
    return v.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function fmtVol(v) {
    if (v === null || v === undefined) return "-";
    if (v >= 1e7) return (v / 1e7).toFixed(2) + "Cr";
    if (v >= 1e5) return (v / 1e5).toFixed(2) + "L";
    if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
    return String(v);
  }

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------
  function applyFilterAndSort() {
    let out = rows;

    if (filterMode === "pinned") {
      out = out.filter(r => pinned.has(getSymbol(r)));
    } else if (filterMode === "gainers") {
      out = out.filter(r => (getPChange(r) ?? 0) > 0);
    } else if (filterMode === "losers") {
      out = out.filter(r => (getPChange(r) ?? 0) < 0);
    }

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      out = out.filter(r =>
        getSymbol(r).toLowerCase().includes(q) ||
        getCompany(r).toLowerCase().includes(q)
      );
    }

    const keyFn = {
      symbol: getSymbol, companyName: getCompany, lastPrice: getLTP,
      change: getChange, pChange: getPChange, dayHigh: getHigh,
      dayLow: getLow, totalTradedVolume: getVolume,
    }[sortKey] || getPChange;

    out = [...out].sort((a, b) => {
      const va = keyFn(a), vb = keyFn(b);
      if (typeof va === "string") return sortDir * va.localeCompare(vb);
      return sortDir * (((va ?? -Infinity)) - ((vb ?? -Infinity)));
    });

    if (filterMode !== "pinned") {
      out.sort((a, b) => (pinned.has(getSymbol(b)) ? 1 : 0) - (pinned.has(getSymbol(a)) ? 1 : 0));
    }

    return out;
  }

  function render() {
    const list = applyFilterAndSort();
    visibleCountEl.textContent = list.length;
    totalCountEl.textContent = rows.length;

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty-state">No symbols match.</td></tr>`;
      return;
    }

    const frag = document.createDocumentFragment();
    for (const r of list) {
      const sym = getSymbol(r);
      const ltp = getLTP(r);
      const chg = getChange(r);
      const pchg = getPChange(r);
      const dirClass = pchg > 0 ? "up" : pchg < 0 ? "down" : "flat";
      const sign = pchg > 0 ? "+" : "";

      const tr = document.createElement("tr");
      const prev = prevPrices[sym];
      if (prev !== undefined && ltp !== null && prev !== ltp) {
        tr.classList.add("flash");
      }

      tr.innerHTML = `
        <td><button class="pin-btn ${pinned.has(sym) ? "pinned" : ""}" data-sym="${sym}">${pinned.has(sym) ? "&#9733;" : "&#9734;"}</button></td>
        <td class="sym">${sym}</td>
        <td class="company" title="${getCompany(r)}">${getCompany(r)}</td>
        <td>${fmtNum(ltp)}</td>
        <td class="${dirClass}">${chg !== null ? sign + fmtNum(chg) : "-"}</td>
        <td><span class="chg-pill ${dirClass}">${pchg !== null ? sign + fmtNum(pchg) + "%" : "-"}</span></td>
        <td class="flat">${fmtNum(getHigh(r))}</td>
        <td class="flat">${fmtNum(getLow(r))}</td>
        <td class="flat">${fmtVol(getVolume(r))}</td>
      `;
      frag.appendChild(tr);
      if (ltp !== null) prevPrices[sym] = ltp;
    }
    tbody.innerHTML = "";
    tbody.appendChild(frag);
  }

  // ---------------------------------------------------------------
  // Header sort clicks
  // ---------------------------------------------------------------
  document.querySelectorAll("thead th[data-key]").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (key === "pin") return;
      if (sortKey === key) { sortDir *= -1; } else { sortKey = key; sortDir = -1; }
      document.querySelectorAll("thead th").forEach(h => { h.classList.remove("sorted"); h.querySelector(".arrow")?.remove(); });
      th.classList.add("sorted");
      const arrow = document.createElement("span");
      arrow.className = "arrow";
      arrow.textContent = sortDir === 1 ? "&#9650;" : "&#9660;";
      th.appendChild(arrow);
      render();
    });
  });

  // Pin toggle (event delegation)
  tbody.addEventListener("click", async e => {
    const btn = e.target.closest(".pin-btn");
    if (!btn) return;
    const sym = btn.dataset.sym;
    
    // Optimistic update
    const wasPinned = pinned.has(sym);
    if (wasPinned) pinned.delete(sym);
    else pinned.add(sym);
    render();

    try {
      const res = await fetch('/api/auth/watchlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ symbol: sym })
      });
      if (!res.ok) throw new Error("Failed to sync watchlist");
    } catch (err) {
      showToast(err.message, 'error');
      // Revert on failure
      if (wasPinned) pinned.add(sym);
      else pinned.delete(sym);
      render();
    }
  });

  document.getElementById("searchInput").addEventListener("input", e => {
    searchTerm = e.target.value.trim();
    render();
  });

  function setFilter(mode) {
    filterMode = filterMode === mode ? null : mode;
    document.getElementById("chipPinned").classList.toggle("active", filterMode === "pinned");
    document.getElementById("chipGainers").classList.toggle("active", filterMode === "gainers");
    document.getElementById("chipLosers").classList.toggle("active", filterMode === "losers");
    render();
  }
  document.getElementById("chipPinned").addEventListener("click", () => setFilter("pinned"));
  document.getElementById("chipGainers").addEventListener("click", () => setFilter("gainers"));
  document.getElementById("chipLosers").addEventListener("click", () => setFilter("losers"));

  // ---------------------------------------------------------------
  // Connection status / relative time ticker
  // ---------------------------------------------------------------
  function setConnected(ok) {
    pulseDot.className = "pulse-dot " + (ok ? "live" : "down");
    connStatus.textContent = ok ? "live" : "disconnected — retrying";
  }

  function relTime(iso) {
    if (!iso) return "-";
    const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (secs < 2) return "just now";
    if (secs < 60) return secs + "s ago";
    return Math.floor(secs / 60) + "m ago";
  }
  setInterval(() => { lastUpdatedEl.textContent = relTime(lastUpdatedTs); }, 1000);

  // ---------------------------------------------------------------
  // WebSocket with polling fallback
  // ---------------------------------------------------------------
  function handlePayload(msg) {
    if (msg.type === "update") {
      rows = msg.data || [];
      lastUpdatedTs = msg.last_updated;
      if (msg.index) indexNameEl.textContent = msg.index;
      errorBanner.classList.remove("show");
      render();
    } else if (msg.type === "error") {
      errorBanner.textContent = "Feed warning: " + msg.message;
      errorBanner.classList.add("show");
    }
  }

  function connectWS() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.onopen = () => setConnected(true);
    ws.onmessage = (ev) => { try { handlePayload(JSON.parse(ev.data)); } catch (e) { console.error(e); } };
    ws.onclose = () => { setConnected(false); setTimeout(connectWS, 3000); };
    ws.onerror = () => ws.close();
  }

  async function pollFallback() {
    try {
      const res = await fetch("/api/stocks");
      const msg = await res.json();
      handlePayload({ type: "update", data: msg.data, last_updated: msg.last_updated, index: msg.index });
      setConnected(true);
    } catch (e) {
      setConnected(false);
    }
  }

  async function initApp() {
    try {
      const res = await fetch('/api/auth/watchlist', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        pinned = new Set(data.watchlist);
        render();
      }
    } catch (e) {
      console.error("Watchlist fetch failed", e);
    }

    if ("WebSocket" in window) {
      connectWS();
    } else {
      pollFallback();
      setInterval(pollFallback, 5000);
    }
  }

  initApp();
