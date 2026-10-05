// 儲存層：app.js 只透過 load／save／normalize 存取資料。
// 目前存在瀏覽器 localStorage；之後串雲端（Firebase／Supabase）時，
// 只要把 load／save 改成呼叫雲端 API，其他程式都不用動。
//
// 資料格式 v2：依日期的「快照」，每次記錄一份當天的資產負債。
// { version: 2, snapshots: [ { date, note, entries: [ { id, name, kind, category, value, cost, monthly } ] } ] }
//   value = 現值（元）　cost = 成本（元，可空）　monthly = 每月投入／還款（元，可空）
const Storage = {
  KEY: "piggy-assets-v2",
  OLD_KEY: "piggy-assets-v1",
  MAX_AMOUNT: 1e12, // 單筆金額上限：一兆

  localDate(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  },

  _money(v, allowNull) {
    if (v === null || v === undefined || v === "") return allowNull ? null : 0;
    const n = Number(v);
    if (!Number.isFinite(n)) return allowNull ? null : 0;
    return Math.min(this.MAX_AMOUNT, Math.max(0, Math.round(n)));
  },

  _entry(e) {
    if (!e || typeof e.name !== "string" || !Number.isFinite(Number(e.value))) return null;
    const kind = e.kind === "debt" ? "debt" : "asset";
    return {
      id: typeof e.id === "string" && e.id ? e.id : crypto.randomUUID(),
      name: e.name.slice(0, 30),
      kind,
      category: (typeof e.category === "string" && e.category.trim() ? e.category.trim() : kind === "debt" ? "其他負債" : "其他").slice(0, 12),
      value: this._money(e.value),
      cost: this._money(e.cost, true),
      monthly: this._money(e.monthly, true)
    };
  },

  // 把任何來源的資料（v2、舊版 v1）整理成安全的 v2 格式
  normalize(data) {
    let snaps = [];
    if (data && Array.isArray(data.snapshots)) {
      snaps = data.snapshots;
    } else if (data && Array.isArray(data.items) && data.items.length) {
      // 舊版（單一清單）→ 轉成一筆今天的快照
      snaps = [{ date: this.localDate(), note: "", entries: data.items.map((i) => ({ ...i, value: i.amount })) }];
    }
    const byDate = new Map();
    snaps.forEach((s) => {
      if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s.date) || !Array.isArray(s.entries)) return;
      byDate.set(s.date, {
        date: s.date,
        note: typeof s.note === "string" ? s.note.slice(0, 100) : "",
        entries: s.entries.map((e) => this._entry(e)).filter(Boolean)
      });
    });
    return { version: 2, snapshots: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) };
  },

  async load() {
    let raw = null;
    try {
      raw = localStorage.getItem(this.KEY);
      if (raw) return this.normalize(JSON.parse(raw));
      const old = localStorage.getItem(this.OLD_KEY); // 舊版資料自動搬過來
      if (old) return this.normalize(JSON.parse(old));
    } catch (e) {
      // 資料損毀：先把原始內容另存一份，避免之後被新資料覆蓋而無法搶救
      try { localStorage.setItem(this.KEY + "-corrupt-backup", raw); } catch (_) {}
      alert("偵測到本機資料損毀，已為你保留一份原始備份並重新開始。");
    }
    return { version: 2, snapshots: [] };
  },

  async save(data) {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(data));
    } catch (e) {
      alert("儲存失敗，瀏覽器可能封鎖了本機儲存。");
    }
  }
};
