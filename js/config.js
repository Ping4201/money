// Supabase 連線設定。這兩個值是「公開用」的，放在網頁裡是正常的：
// 真正的保護來自資料庫的權限規則（沒登入、或不在家人名單的人，什麼都讀不到）。
// 注意：絕對不要把 service_role 金鑰或資料庫密碼貼到這裡。
const CONFIG = {
  SUPABASE_URL: "https://jptodrjjhvgexzbzlald.supabase.co",
  SUPABASE_KEY: "sb_publishable_0ef_Um3SY35sJqPAEkY-Lw_7h-87LsB"
};
