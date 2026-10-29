// Lumen Builder runtime backend config (Phase 22).
// Loaded before the bundle; wins over build-time env so one dist serves
// any Supabase backend without a rebuild. Leave values empty for offline.
window.__LUMEN_BACKEND__ = {
  supabaseUrl: 'https://bgqkqcvebizjnkjcbedf.supabase.co',
  supabaseAnonKey: 'PASTE_YOUR_ANON_KEY_HERE',
};
