// JK Innovations workshop inventory — browser config.
//
// Fill this in after Norma creates her own Supabase project.
// Dashboard → Project Settings → API (or API Keys):
//   SUPABASE_URL      = Project URL (https://<project-ref>.supabase.co)
//   SUPABASE_ANON_KEY = publishable key, also labeled "anon" / "anon public"
//                       (sb_publishable_… or a long eyJ… anon JWT)
//
// The publishable anon key is meant for the browser. Row Level Security in
// schema `inventory` is what actually grants access.
//
// Never put any of these in this file:
//   - service_role key
//   - secret key (sb_secret_…)
//   - database password
//   - JWT secret
//
// Until the two placeholders below are replaced, the app stays on a
// "not configured" screen and does not call Supabase.
window.JKIN_INVENTARIO_CONFIG = {
  SUPABASE_URL: "https://YOUR_PROJECT_REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_PUBLISHABLE_ANON_KEY",
  SCHEMA: "inventory",
  TAX_RATE: 0.1075
};
