// 儲存層：app.js 只透過這裡存取資料（登入、讀取、寫入、刪除）。
// 資料存在 Supabase 雲端資料庫，由資料庫的權限規則（RLS）保護，
// 沒登入或不在家人名單的人讀不到任何資料。
//
// 資料格式 v2：依日期的「快照」，每次記錄一份當天的資產負債。
// { version: 2, snapshots: [ { date, note, entries: [ { id, name, kind, category, value, cost, monthly } ] } ] }
//   value = 現值（元）　cost = 成本（元，可空）　monthly = 每月投入／還款（元，可空）
//   rate = 年利率 %（貸款用，可空；有填才會在每月 5 號自動推算剩餘負債）
const Storage = {
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
      monthly: this._money(e.monthly, true),
      rate: this._rate(e.rate)
    };
  },

  // 年利率（%），例如 2.185；沒填或不合理就當作沒有
  _rate(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
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

  /* ---------- 雲端（Supabase）：登入 + 讀寫 ---------- */
  client: null,

  init() {
    this.client = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
    return this.client;
  },

  async getUser() {
    const { data } = await this.client.auth.getSession();
    return data.session ? data.session.user : null;
  },

  async signIn(email, password) {
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },

  async signOut() {
    await this.client.auth.signOut();
  },

  async load() {
    const { data, error } = await this.client.from("snapshots").select("date, note, entries").order("date");
    if (error) throw error;
    return this.normalize({ snapshots: data });
  },

  // 只寫「有變動的那一天」，避免兩個人同時使用時互相覆蓋對方的資料
  async saveSnapshot(snap) {
    const { error } = await this.client.from("snapshots").upsert({ date: snap.date, note: snap.note, entries: snap.entries });
    if (error) throw error;
  },

  async saveMany(snaps) {
    const rows = snaps.map((s) => ({ date: s.date, note: s.note, entries: s.entries }));
    const { error } = await this.client.from("snapshots").upsert(rows);
    if (error) throw error;
  },

  // 自動補算專用：同一天已經有紀錄就略過，絕不覆蓋人工輸入的資料
  async addIfMissing(snaps) {
    const rows = snaps.map((s) => ({ date: s.date, note: s.note, entries: s.entries }));
    const { error } = await this.client.from("snapshots").upsert(rows, { onConflict: "date", ignoreDuplicates: true });
    if (error) throw error;
  },

  async deleteSnapshot(date) {
    const { error } = await this.client.from("snapshots").delete().eq("date", date);
    if (error) throw error;
  }
};
