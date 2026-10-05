// 常用分類（只是建議，輸入框也可以自己打新分類）
const ASSET_CATS = ["存款", "台股", "美股", "虛擬幣", "極星", "其他"];
const DEBT_CATS = ["房貸", "車貸", "信貸", "其他負債"];
const CAT_COLORS = {
  存款: "#e2b872", 台股: "#cc3300", 美股: "#8aa68a", 虛擬幣: "#e8895f", 極星: "#7a9bb5", 其他: "#a38a7a",
  房貸: "#8c2400", 車貸: "#c8643c", 信貸: "#d9a08a", 其他負債: "#a38a7a"
};
const FALLBACK = ["#b5838d", "#6d9eb1", "#c9ae5d", "#9a8c98", "#7f9c6c"];
const catColor = (name) => {
  if (CAT_COLORS[name]) return CAT_COLORS[name];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// 金額顯示：一萬以上用「萬」，例如 425.9萬
const fmt = (n) => {
  const a = Math.abs(n), s = n < 0 ? "-" : "";
  if (a >= 10000) return s + (Math.round(a / 1000) / 10).toLocaleString("zh-TW") + "萬";
  return s + "$" + Math.round(a).toLocaleString("zh-TW");
};
const fmtSigned = (n) => (n > 0 ? "+" : "") + fmt(n);
const wan = (n) => (n === null || n === undefined ? "" : String(Math.round(n) / 10000));
const today = () => Storage.localDate();

let state = { version: 2, snapshots: [] };
let selected = null; // 目前檢視的日期
let filter = "all";
let editingDate = null;

const latest = () => state.snapshots[state.snapshots.length - 1] || null;
const snapOf = (date) => state.snapshots.find((s) => s.date === date) || null;
const prevOf = (date) => {
  const i = state.snapshots.findIndex((s) => s.date === date);
  return i > 0 ? state.snapshots[i - 1] : null;
};

function totals(snap) {
  const t = { asset: 0, debt: 0, net: 0, invValue: 0, invCost: 0, hasCost: false };
  if (!snap) return t;
  snap.entries.forEach((e) => {
    if (e.kind === "debt") t.debt += e.value;
    else {
      t.asset += e.value;
      if (e.cost !== null) { t.invValue += e.value; t.invCost += e.cost; t.hasCost = true; }
    }
  });
  t.net = t.asset - t.debt;
  return t;
}

const setStatus = (msg) => { $("status").textContent = msg || ""; $("status").hidden = !msg; };
const errText = (e) => (e && e.message) || String(e);

async function init() {
  bindEvents();
  Storage.init();
  if (await Storage.getUser()) await enterApp();
  else showLogin();
  // 回到這個分頁時，重新讀取，看到家人剛改的內容
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !$("app").hidden && !$("dlg").open) refresh(true);
  });
}

function showLogin() {
  $("app").hidden = $("backup").hidden = $("topActions").hidden = true;
  $("login").hidden = false;
  setStatus("");
}

async function enterApp() {
  $("login").hidden = true;
  setStatus("讀取中…");
  try {
    await refresh(false);
    $("app").hidden = $("backup").hidden = $("topActions").hidden = false;
    setStatus("");
    await autoCatchUp();
  } catch (e) {
    // 登入成功但讀不到資料：多半是這個 Email 不在家人名單
    await Storage.signOut();
    showLogin();
    $("loginError").textContent = "無法讀取資料：請確認這個 Email 已被加入家人名單。（" + errText(e) + "）";
    $("loginError").hidden = false;
    setStatus("");
  }
}

/* ---------- 每月 5 號自動推算貸款剩餘負債 ---------- */
const AUTO_TAG = "【自動】";
const LOAN_DAY = 5;

// 貸款過一個月：先計一個月利息，再扣掉當月還款（本息平均攤還的常見算法）
function nextBalance(e) {
  return Math.max(0, Math.round(e.value * (1 + e.rate / 100 / 12) - e.monthly));
}
const canAmortize = (e) => e.kind === "debt" && e.rate !== null && e.rate !== undefined && e.monthly !== null && e.value > 0;

// 從 base 這筆之後、到 todayStr 為止，每個「5 號」各產生一筆：貸款往前推一個月，其他項目沿用上一筆
function buildAutoSnapshots(base, todayStr) {
  if (!base || !base.entries.some(canAmortize)) return [];
  const out = [];
  let prev = base;
  let [y, m] = base.date.split("-").map(Number);
  m -= 1; // 轉成 0 起算的月份
  for (let i = 0; i < 36; i++, m++) { // 最多補 36 個月，避免久未使用時一次產生太多
    const d = Storage.localDate(new Date(y, m, LOAN_DAY));
    if (d > todayStr) break;
    if (d <= prev.date) continue;
    const snap = {
      date: d,
      note: `${AUTO_TAG}貸款依利率與每月還款推算；其他項目沿用上次數字，請記得更新`,
      entries: prev.entries.map((e) => ({ ...e, id: crypto.randomUUID(), value: canAmortize(e) ? nextBalance(e) : e.value }))
    };
    out.push(snap);
    prev = snap;
  }
  return out;
}

async function autoCatchUp() {
  const added = buildAutoSnapshots(latest(), today());
  if (!added.length) return;
  try {
    await Storage.addIfMissing(added);
    await refresh(true);
    setStatus(`已自動補上 ${added.length} 筆每月 ${LOAN_DAY} 號的貸款更新`);
    setTimeout(() => setStatus(""), 8000);
  } catch (e) {
    console.warn("自動補算失敗（不影響使用）", e);
  }
}

async function refresh(quiet) {
  try {
    state = await Storage.load();
  } catch (e) {
    if (quiet) return; // 背景更新失敗就維持畫面不動
    throw e;
  }
  if (!snapOf(selected)) selected = latest() ? latest().date : null;
  render();
}

async function onLogin(e) {
  e.preventDefault();
  $("loginError").hidden = true;
  $("loginBtn").disabled = true;
  try {
    await Storage.signIn($("loginEmail").value.trim(), $("loginPass").value);
    $("loginPass").value = "";
    await enterApp();
  } catch (err) {
    $("loginError").textContent = "登入失敗：Email 或密碼不正確。";
    $("loginError").hidden = false;
  } finally {
    $("loginBtn").disabled = false;
  }
}

async function onLogout() {
  await Storage.signOut();
  state = { version: 2, snapshots: [] };
  selected = null;
  showLogin();
}

function bindEvents() {
  $("loginForm").onsubmit = onLogin;
  $("logoutBtn").onclick = onLogout;
  $("addBtn").onclick = () => openEditor(null);
  $("snapSelect").onchange = (e) => { selected = e.target.value; render(); };
  $("editBtn").onclick = () => openEditor(selected);
  $("delBtn").onclick = removeSnapshot;
  $("tabs").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    filter = b.dataset.filter;
    [...$("tabs").children].forEach((x) => x.classList.toggle("on", x === b));
    renderList();
  };
  // 點圖表上的點／長條，切換到那一天
  const pick = (e) => { const d = e.target.dataset && e.target.dataset.date; if (d) { selected = d; render(); } };
  $("trend").onclick = pick;
  $("stack").onclick = pick;
  $("exportBtn").onclick = exportBackup;
  $("importBtn").onclick = () => $("importFile").click();
  $("importFile").onchange = importBackup;
  // 編輯視窗
  $("addRowBtn").onclick = () => addRow({});
  $("rows").onclick = (e) => { const b = e.target.closest(".r-del"); if (b) b.closest(".erow").remove(); };
  $("cancelBtn").onclick = () => $("dlg").close();
  $("form").onsubmit = onSubmit;
}

/* ---------- 編輯視窗：新增／修改一份快照 ---------- */
function rowHtml(e) {
  const sel = (k) => (e.kind === k || (!e.kind && k === "asset") ? "selected" : "");
  return `<div class="erow">
    <select class="r-kind" aria-label="類型"><option value="asset" ${sel("asset")}>資產</option><option value="debt" ${sel("debt")}>負債</option></select>
    <input class="r-name" maxlength="30" placeholder="名稱" aria-label="名稱" value="${esc(e.name || "")}">
    <input class="r-cat" list="catList" maxlength="12" placeholder="分類" aria-label="分類" value="${esc(e.category || "")}">
    <input class="r-val" type="number" min="0" step="any" inputmode="decimal" placeholder="現值（萬）" aria-label="現值（萬）" value="${wan(e.value)}">
    <input class="r-cost" type="number" min="0" step="any" inputmode="decimal" placeholder="成本（萬）" aria-label="成本（萬，選填）" value="${wan(e.cost)}">
    <input class="r-rate" type="number" min="0" max="100" step="any" inputmode="decimal" placeholder="年利率（%）" aria-label="貸款年利率（%，選填，填了才會每月5號自動推算）" value="${e.rate === null || e.rate === undefined ? "" : e.rate}">
    <input class="r-mon" type="number" min="0" step="1" inputmode="numeric" placeholder="每月（元）" aria-label="每月投入或還款（元，選填）" value="${e.monthly === null || e.monthly === undefined ? "" : e.monthly}">
    <button type="button" class="icon-btn r-del" aria-label="刪除這一列">✕</button>
  </div>`;
}
const addRow = (e) => $("rows").insertAdjacentHTML("beforeend", rowHtml(e));

function openEditor(date) {
  editingDate = date;
  const snap = date ? snapOf(date) : latest();
  const isNew = !date;
  $("dlgTitle").textContent = isNew ? "新增紀錄" : "編輯 " + date;
  $("dlgHint").textContent = isNew && snap
    ? "已帶入上次（" + snap.date + "）的所有項目，只要改有變動的數字就好；沒變的不用動。"
    : isNew ? "第一次使用：新增幾列開始吧。" : "";
  $("snapDate").value = isNew ? today() : date;
  $("snapNote").value = !isNew && snap ? snap.note : "";
  // 分類建議清單：常用 + 資料裡出現過的
  const cats = new Set([...ASSET_CATS, ...DEBT_CATS]);
  state.snapshots.forEach((s) => s.entries.forEach((e) => cats.add(e.category)));
  $("catList").innerHTML = [...cats].map((c) => `<option value="${esc(c)}">`).join("");
  $("rows").innerHTML = "";
  (snap ? snap.entries : [{}]).forEach(addRow);
  $("dlg").showModal();
}

async function onSubmit(e) {
  e.preventDefault();
  const date = $("snapDate").value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return alert("請選擇日期。");
  const MAXW = Storage.MAX_AMOUNT / 10000;
  const entries = [];
  const rows = [...document.querySelectorAll("#rows .erow")];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const q = (c) => r.querySelector(c).value.trim();
    const name = q(".r-name"), valStr = q(".r-val"), costStr = q(".r-cost"), monStr = q(".r-mon");
    if (!name && valStr === "") continue; // 空白列直接略過
    const label = `第 ${i + 1} 列`;
    if (!name) return alert(`${label}：請填名稱。`);
    const v = Number(valStr);
    if (valStr === "" || !Number.isFinite(v) || v < 0 || v > MAXW) return alert(`${label}（${name}）：現值請填 0 到 ${MAXW.toLocaleString("zh-TW")} 萬之間的數字。`);
    const c = costStr === "" ? null : Number(costStr);
    if (c !== null && (!Number.isFinite(c) || c < 0 || c > MAXW)) return alert(`${label}（${name}）：成本填法不正確。`);
    const m = monStr === "" ? null : Number(monStr);
    if (m !== null && (!Number.isFinite(m) || m < 0)) return alert(`${label}（${name}）：每月金額填法不正確。`);
    const rateStr = q(".r-rate");
    const rt = rateStr === "" ? null : Number(rateStr);
    if (rt !== null && (!Number.isFinite(rt) || rt < 0 || rt > 100)) return alert(`${label}（${name}）：年利率請填 0 到 100 之間的數字。`);
    const kind = q(".r-kind");
    entries.push({
      id: crypto.randomUUID(), name, kind,
      category: q(".r-cat") || (kind === "debt" ? "其他負債" : "其他"),
      value: Math.round(v * 10000),
      cost: c === null ? null : Math.round(c * 10000),
      monthly: m === null ? null : Math.round(m),
      rate: rt
    });
  }
  if (!entries.length) return alert("至少要有一列項目。");
  if (date !== editingDate && snapOf(date) && !confirm(`${date} 已經有一筆紀錄，要用這次的內容取代嗎？`)) return;
  const snap = { date, note: $("snapNote").value.trim(), entries };
  $("saveBtn").disabled = true;
  try {
    await Storage.saveSnapshot(snap);
    // 改了日期：舊日期那筆要刪掉（日期是唯一識別）
    if (editingDate && editingDate !== date) await Storage.deleteSnapshot(editingDate);
  } catch (err) {
    return alert("儲存失敗，資料沒有變動：" + errText(err));
  } finally {
    $("saveBtn").disabled = false;
  }
  state.snapshots = state.snapshots.filter((s) => s.date !== editingDate && s.date !== date);
  state.snapshots.push(snap);
  state.snapshots.sort((a, b) => a.date.localeCompare(b.date));
  selected = date;
  $("dlg").close();
  render();
}

async function removeSnapshot() {
  if (!selected || !confirm(`確定要刪除 ${selected} 這一筆紀錄嗎？家人也會看不到。`)) return;
  try {
    await Storage.deleteSnapshot(selected);
  } catch (err) {
    return alert("刪除失敗，資料沒有變動：" + errText(err));
  }
  state.snapshots = state.snapshots.filter((s) => s.date !== selected);
  selected = latest() ? latest().date : null;
  render();
}

/* ---------- 畫面 ---------- */
function render() {
  const snap = snapOf(selected);
  const has = !!snap;
  $("empty").hidden = has;
  $("snapbar").hidden = !has;
  $("snapSelect").innerHTML = [...state.snapshots].reverse()
    .map((s) => `<option value="${s.date}" ${s.date === selected ? "selected" : ""}>${s.date}</option>`).join("");
  $("snapCount").textContent = `共 ${state.snapshots.length} 筆紀錄`;
  $("snapNote2").textContent = snap && snap.note ? "備註：" + snap.note : "";
  renderCards(snap);
  renderList();
  renderDonut(snap);
  renderTrend();
  renderStack();
}

function delta(cur, prev, goodWhenUp) {
  if (prev === null) return "<small></small>";
  const d = cur - prev;
  if (!d) return "<small>與上次相同</small>";
  const good = goodWhenUp ? d > 0 : d < 0;
  return `<small class="${good ? "up" : "down"}">較上次 ${fmtSigned(d)}</small>`;
}

function renderCards(snap) {
  const t = totals(snap), p = snap && prevOf(snap.date) ? totals(prevOf(snap.date)) : null;
  const pl = t.invValue - t.invCost;
  const plCard = t.hasCost
    ? `<strong class="val ${pl >= 0 ? "asset" : "debt"}">${fmtSigned(pl)}</strong><small>報酬率 ${(t.invCost ? (pl / t.invCost) * 100 : 0).toFixed(1)}%（成本 ${fmt(t.invCost)}）</small>`
    : `<strong class="val">—</strong><small>填入「成本」後才會計算</small>`;
  $("cards").innerHTML = `
    <div class="card"><span>總資產</span><strong class="val asset">${fmt(t.asset)}</strong>${delta(t.asset, p && p.asset, true)}</div>
    <div class="card"><span>總負債</span><strong class="val debt">${fmt(t.debt)}</strong>${delta(t.debt, p && p.debt, false)}</div>
    <div class="card net"><span>淨資產</span><strong class="val">${fmt(t.net)}</strong>${delta(t.net, p && p.net, true)}</div>
    <div class="card"><span>投資損益</span>${plCard}</div>`;
}

function renderList() {
  const snap = snapOf(selected);
  const rows = snap ? snap.entries.filter((e) => filter === "all" || e.kind === filter) : [];
  const sorted = [...rows].sort((a, b) => (a.kind === b.kind ? b.value - a.value : a.kind === "asset" ? -1 : 1));
  $("list").innerHTML = sorted.map((e) => {
    const c = catColor(e.category);
    const bits = [esc(e.category)];
    if (e.cost !== null) {
      const pl = e.value - e.cost;
      bits.push(`成本 ${fmt(e.cost)}`, `<b class="${pl >= 0 ? "up" : "down"}">${e.cost ? ((pl / e.cost) * 100).toFixed(1) : "0.0"}%</b>`);
    }
    if (e.rate !== null && e.rate !== undefined) bits.push(`年利率 ${e.rate}%`);
    if (e.monthly !== null) bits.push(`每月${e.kind === "debt" ? "還" : "+"}${e.monthly.toLocaleString("zh-TW")}`);
    return `<li class="item">
      <div class="dot" style="background:${c}33;color:${c}">${esc(e.category.slice(0, 1))}</div>
      <div class="info"><b>${esc(e.name)}</b><small>${bits.join("・")}</small></div>
      <span class="amt ${e.kind}">${e.kind === "debt" ? "-" : ""}${fmt(e.value)}</span>
    </li>`;
  }).join("");
}

function assetCats() {
  const seen = new Set();
  state.snapshots.forEach((s) => s.entries.forEach((e) => e.kind === "asset" && seen.add(e.category)));
  return [...ASSET_CATS.filter((c) => seen.has(c)), ...[...seen].filter((c) => !ASSET_CATS.includes(c))];
}
const byCat = (snap) => {
  const m = {};
  snap.entries.forEach((e) => { if (e.kind === "asset") m[e.category] = (m[e.category] || 0) + e.value; });
  return m;
};

function renderDonut(snap) {
  const m = snap ? byCat(snap) : {};
  const sums = assetCats().map((name) => ({ name, value: m[name] || 0 })).filter((c) => c.value > 0);
  const total = sums.reduce((s, c) => s + c.value, 0);
  if (!total) {
    $("donut").innerHTML = '<div class="hint">新增資產後會出現圖表</div>';
    $("legend").innerHTML = "";
    return;
  }
  const r = 70, C = 2 * Math.PI * r;
  let offset = 0;
  const arcs = sums.map((c) => {
    const len = (c.value / total) * C;
    const s = `<circle r="${r}" cx="100" cy="100" fill="none" stroke="${catColor(c.name)}" stroke-width="34"
      stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 100 100)"/>`;
    offset += len;
    return s;
  }).join("");
  $("donut").innerHTML = `<svg viewBox="0 0 200 200" style="max-width:240px;margin:0 auto" role="img" aria-label="資產分布圖">
    ${arcs}<text x="100" y="96" text-anchor="middle" font-size="11" fill="#6f655f">總資產</text>
    <text x="100" y="116" text-anchor="middle" font-size="15" font-weight="700" fill="#222222">${fmt(total)}</text></svg>`;
  $("legend").innerHTML = sums.map((c) =>
    `<li><i style="background:${catColor(c.name)}"></i>${esc(c.name)}<em>${((c.value / total) * 100).toFixed(1)}%・${fmt(c.value)}</em></li>`).join("");
}

// 圖表共用：y 軸刻度與格線
function yAxis(min, max, W, H, P) {
  let out = "";
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4;
    const y = H - P.b - ((v - min) / (max - min)) * (H - P.t - P.b);
    out += `<line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}" stroke="#e4dcd5" stroke-width="1"/>
      <text x="${P.l - 6}" y="${y + 3}" font-size="13" fill="#6f655f" text-anchor="end">${Math.round(v / 10000)}</text>`;
  }
  return out + `<text x="${P.l - 6}" y="${P.t - 4}" font-size="13" fill="#6f655f" text-anchor="end">萬</text>`;
}
const shortDate = (d) => d.slice(2, 7).replace("-", "/");

function renderTrend() {
  const snaps = state.snapshots;
  if (snaps.length < 2) {
    $("trend").innerHTML = '<div class="hint">至少要有兩筆紀錄，才畫得出趨勢</div>';
    $("trendLegend").innerHTML = "";
    return;
  }
  const W = 560, H = 250, P = { l: 52, r: 14, t: 20, b: 30 };
  const data = snaps.map((s) => ({ date: s.date, t: Date.parse(s.date), ...totals(s) }));
  const t0 = data[0].t, t1 = data[data.length - 1].t;
  const all = data.flatMap((d) => [d.asset, d.debt, d.net, 0]);
  const min = Math.min(...all), max = Math.max(...all);
  const x = (t) => P.l + ((t - t0) / (t1 - t0 || 1)) * (W - P.l - P.r);
  const y = (v) => H - P.b - ((v - min) / (max - min || 1)) * (H - P.t - P.b);
  const series = [["asset", "#5f8a63", "總資產"], ["debt", "#cc3300", "總負債"], ["net", "#222222", "淨資產"]];
  const r = data.length > 30 ? 2 : 3;
  const lines = series.map(([k, col]) =>
    `<polyline points="${data.map((d) => `${x(d.t)},${y(d[k])}`).join(" ")}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`).join("");
  const dots = series.map(([k, col, label]) => data.map((d) =>
    `<circle cx="${x(d.t)}" cy="${y(d[k])}" r="${r}" fill="${col}"/>
     <circle cx="${x(d.t)}" cy="${y(d[k])}" r="9" fill="transparent" data-date="${d.date}" style="cursor:pointer"><title>${d.date}｜${label} ${fmt(d[k])}</title></circle>`).join("")).join("");
  const sel = data.find((d) => d.date === selected);
  const marker = sel ? `<line x1="${x(sel.t)}" x2="${x(sel.t)}" y1="${P.t}" y2="${H - P.b}" stroke="#cc3300" stroke-dasharray="4 3" stroke-width="1.2"/>` : "";
  const ticks = [0, 1 / 3, 2 / 3, 1].map((f) => {
    const t = t0 + (t1 - t0) * f, nearest = data.reduce((a, d) => (Math.abs(d.t - t) < Math.abs(a.t - t) ? d : a));
    return `<text x="${x(nearest.t)}" y="${H - 9}" font-size="13" fill="#6f655f" text-anchor="${f === 0 ? "start" : f === 1 ? "end" : "middle"}">${shortDate(nearest.date)}</text>`;
  }).join("");
  $("trend").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="資產負債趨勢圖">${yAxis(min, max, W, H, P)}${marker}${lines}${dots}${ticks}</svg>`;
  $("trendLegend").innerHTML = series.map(([, col, label]) => `<li><i style="background:${col}"></i>${label}</li>`).join("");
}

function renderStack() {
  const snaps = state.snapshots.slice(-40);
  const cats = assetCats();
  if (!snaps.length || !cats.length) {
    $("stack").innerHTML = '<div class="hint">新增資產後會出現圖表</div>';
    $("stackLegend").innerHTML = "";
    return;
  }
  const W = 560, H = 250, P = { l: 52, r: 14, t: 20, b: 30 };
  const max = Math.max(...snaps.map((s) => totals(s).asset)) || 1;
  const slot = (W - P.l - P.r) / snaps.length, bw = Math.min(26, slot * 0.7);
  const y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
  const bars = snaps.map((s, i) => {
    const m = byCat(s), cx = P.l + slot * (i + 0.5);
    let acc = 0;
    const segs = cats.map((c) => {
      const v = m[c] || 0;
      if (!v) return "";
      const rect = `<rect x="${cx - bw / 2}" y="${y(acc + v)}" width="${bw}" height="${y(acc) - y(acc + v)}" fill="${catColor(c)}" data-date="${s.date}" style="cursor:pointer"><title>${s.date}｜${esc(c)} ${fmt(v)}（${((v / totals(s).asset) * 100).toFixed(1)}%）</title></rect>`;
      acc += v;
      return rect;
    }).join("");
    const outline = s.date === selected ? `<rect x="${cx - bw / 2 - 2}" y="${y(acc) - 2}" width="${bw + 4}" height="${y(0) - y(acc) + 4}" fill="none" stroke="#cc3300" stroke-width="1.5" rx="2" pointer-events="none"/>` : "";
    return segs + outline;
  }).join("");
  const ticks = [0, 1 / 3, 2 / 3, 1].map((f) => {
    const i = Math.round((snaps.length - 1) * f);
    return `<text x="${P.l + slot * (i + 0.5)}" y="${H - 9}" font-size="13" fill="#6f655f" text-anchor="${f === 0 ? "start" : f === 1 ? "end" : "middle"}">${shortDate(snaps[i].date)}</text>`;
  }).join("");
  $("stack").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="資產分布變化圖">${yAxis(0, max, W, H, P)}${bars}${ticks}</svg>`;
  $("stackLegend").innerHTML = cats.map((c) => `<li><i style="background:${catColor(c)}"></i>${esc(c)}</li>`).join("");
}

/* ---------- 備份 ---------- */
function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `暖暖家計簿備份-${today()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importBackup(e) {
  const file = e.target.files[0];
  e.target.value = ""; // 讓同一個檔案可以再選一次
  if (!file) return;
  try {
    const data = Storage.normalize(JSON.parse(await file.text()));
    if (!data.snapshots.length) throw new Error("empty");
    if (!confirm(`備份檔內有 ${data.snapshots.length} 筆紀錄。要匯入到雲端嗎？同一天的紀錄會被備份檔取代，其他天不受影響，家人也會看到。`)) return;
    await Storage.saveMany(data.snapshots);
    await refresh(false);
    selected = data.snapshots[data.snapshots.length - 1].date;
    render();
  } catch (err) {
    alert("匯入失敗，資料沒有被更動：" + (err && err.message === "empty" ? "這不是有效的備份檔。" : errText(err)));
  }
}

init();

